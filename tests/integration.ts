import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { SignJWT } from "jose";
import { createApp } from "../apps/api/dist/app.js";
import { migrate } from "../scripts/migrate.js";
import { NodeSqliteDriver } from "./sqlite-driver.js";
import {
  Outbox,
  Synchronizer,
  httpTransport,
} from "../packages/mobile/src/outbox.js";
import type { OrderDraft } from "@playita/shared";
import { io } from "socket.io-client";
const databaseUrl = process.env.TEST_DATABASE_URL;
test(
  "PostgreSQL real + Nest HTTP + SQLite real: offline a sync, repetición, permisos y no sobreventa",
  {
    skip: !databaseUrl
      ? "TEST_DATABASE_URL no configurado; no se simula PostgreSQL"
      : false,
  },
  async () => {
    const admin = new Pool({ connectionString: databaseUrl }),
      schema = "it_" + crypto.randomUUID().replace(/-/g, ""),
      url = new URL(databaseUrl!);
    await admin.query(`CREATE SCHEMA ${schema}`);
    url.searchParams.set("options", "-c search_path=" + schema);
    const secret = "test-only-secret-not-for-deployment-000001";
    let server: Awaited<ReturnType<typeof createApp>> | undefined;
    try {
      await migrate(url.toString());
      server = await createApp({ databaseUrl: url.toString(), secret });
      await server.app.listen(0, "127.0.0.1");
      const address = server.app.getHttpServer().address(),
        base = "http://127.0.0.1:" + address.port;
      const token = await new SignJWT({ role: "buyer" })
        .setProtectedHeader({ alg: "HS256" })
        .setSubject("buyer-a")
        .setIssuer("playita-local")
        .setAudience("playita-api")
        .setExpirationTime("10m")
        .sign(new TextEncoder().encode(secret));
      const seller = await new SignJWT({ role: "seller" })
        .setProtectedHeader({ alg: "HS256" })
        .setSubject("seller-a")
        .setIssuer("playita-local")
        .setAudience("playita-api")
        .setExpirationTime("10m")
        .sign(new TextEncoder().encode(secret));
      const headers = {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      };
      assert.equal((await fetch(base + "/inventory")).status, 401);
      const inventory = await (
        await fetch(base + "/inventory", { headers })
      ).json();
      assert.equal("costCop" in inventory[0], false);
      const draft: OrderDraft = {
        paymentMethod: "cash",
        lines: [
          {
            productId: "11111111-1111-4111-8111-111111111111",
            presentationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
            quantity: 1,
            expectedPriceCop: 17000,
          },
        ],
      };
      const db = new NodeSqliteDriver(":memory:"),
        box = new Outbox(db, "buyer-a");
      await box.init();
      const key = await box.enqueue(draft);
      assert.equal((await box.list())[0]!.status, "pending_sync");
      const socket = io(base, { auth: { token }, transports: ["websocket"] });
      await new Promise<void>((resolve, reject) => {
        socket.once("connect", () => resolve());
        socket.once("connect_error", reject);
      });
      const changes: unknown[] = [];
      socket.on("change", (e) => changes.push(e));
      const worker = new Synchronizer(
        box,
        httpTransport(base, () => token),
      );
      await worker.sync();
      const response = JSON.parse((await box.list())[0]!.response!);
      assert.equal(response.totalCop, 17000);
      const replay = await fetch(base + "/orders", {
        method: "POST",
        headers: { ...headers, "Idempotency-Key": key },
        body: JSON.stringify(draft),
      });
      assert.equal((await replay.json()).id, response.id);
      assert.equal(replay.headers.get("Idempotency-Replayed"), "true");
      assert.equal(
        (await server.pool.query("SELECT COUNT(*)::int AS n FROM orders"))
          .rows[0].n,
        1,
      );
      assert.equal(
        (
          await server.pool.query(
            "SELECT reserved FROM products WHERE kind=$1",
            ["unit"],
          )
        ).rows[0].reserved,
        30,
      );
      const forbidden = await fetch(base + `/orders/${response.id}/actions`, {
        method: "POST",
        headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ action: "accept" }),
      });
      assert.equal(forbidden.status, 403);
      for (const action of ["accept", "ready", "pay_cash", "deliver"]) {
        const r = await fetch(base + `/orders/${response.id}/actions`, {
          method: "POST",
          headers: {
            Authorization: "Bearer " + seller,
            "Content-Type": "application/json",
            "Idempotency-Key": crypto.randomUUID(),
          },
          body: JSON.stringify({ action }),
        });
        assert.equal(r.status, 201);
      }
      const values = (
        await server.pool.query(
          "SELECT stock,reserved FROM products WHERE kind=$1",
          ["unit"],
        )
      ).rows[0];
      assert.deepEqual(values, { stock: 60, reserved: 0 });
      const tooMany = {
        ...draft,
        lines: [{ ...draft.lines[0]!, quantity: 2 }],
      };
      const results = await Promise.all(
        [1, 2].map(() =>
          fetch(base + "/orders", {
            method: "POST",
            headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
            body: JSON.stringify(tooMany),
          }),
        ),
      );
      assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
      const replayEvents = await (
        await fetch(base + "/events?after=0", { headers })
      ).json();
      assert.ok(replayEvents.some((e: any) => e.kind === "inventory.changed"));
      await new Promise((r) => setTimeout(r, 30));
      assert.ok(changes.length > 0);
      socket.disconnect();
      db.close();
    } finally {
      if (server) await server.close();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  },
);
