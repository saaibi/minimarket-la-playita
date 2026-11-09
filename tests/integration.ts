import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { bootstrapAdmin } from "../apps/api/src/auth.js";
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
    const password = "test-only-" + crypto.randomUUID();
    let server: Awaited<ReturnType<typeof createApp>> | undefined;
    try {
      await migrate(url.toString());
      server = await createApp({ databaseUrl: url.toString() });
      await bootstrapAdmin(server.pool, "admin@example.invalid", password);
      await server.app.listen(0, "127.0.0.1");
      const address = server.app.getHttpServer().address(),
        base = "http://127.0.0.1:" + address.port;
      const nativeHeaders = {
        "Content-Type": "application/json",
        "X-Playita-Client": "native",
      };
      const login = await (
        await fetch(base + "/auth/login", {
          method: "POST",
          headers: nativeHeaders,
          body: JSON.stringify({ email: "admin@example.invalid", password }),
        })
      ).json();
      await fetch(base + "/auth/users", {
        method: "POST",
        headers: {
          ...nativeHeaders,
          Authorization: "Bearer " + login.accessToken,
        },
        body: JSON.stringify({
          email: "seller@example.invalid",
          password,
          role: "seller",
        }),
      });
      const sellerLogin = await (
        await fetch(base + "/auth/login", {
          method: "POST",
          headers: nativeHeaders,
          body: JSON.stringify({ email: "seller@example.invalid", password }),
        })
      ).json();
      const buyer = await (
        await fetch(base + "/auth/guest", {
          method: "POST",
          headers: nativeHeaders,
          body: "{}",
        })
      ).json();
      const token = buyer.accessToken,
        seller = sellerLogin.accessToken;
      const headers = {
        ...nativeHeaders,
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
        box = new Outbox(db, buyer.actor.id);
      await box.init();
      const key = await box.enqueue(draft, crypto.randomUUID(), 0);
      assert.equal((await box.list())[0]!.status, "pending_sync");
      const socket = io(base, {
        auth: { accessToken: token },
        transports: ["websocket"],
      });
      await new Promise<void>((resolve, reject) => {
        socket.once("connect", () => resolve());
        socket.once("connect_error", reject);
      });
      const staffSocket = io(base, {
        auth: { accessToken: seller },
        transports: ["websocket"],
      });
      await new Promise<void>((resolve, reject) => {
        staffSocket.once("connect", () => resolve());
        staffSocket.once("connect_error", reject);
      });
      const staffChanges: Array<{ kind: string }> = [];
      staffSocket.on("change", (e) => staffChanges.push(e));
      const changes: unknown[] = [];
      socket.on("change", (e) => changes.push(e));
      const transport = httpTransport(base, () => token);
      const claim = (await box.claim(0))!;
      const initial = await transport(claim.request_key, draft);
      assert.equal(initial.status, 201);
      // Simulate process death before SQLite ack. Real HTTP replay after lease recovery.
      const worker = new Synchronizer(box, transport, () => 60001);
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
      const mismatch = await fetch(base + "/orders", {
        method: "POST",
        headers: { ...headers, "Idempotency-Key": key },
        body: JSON.stringify({
          ...draft,
          lines: [{ ...draft.lines[0]!, quantity: 2 }],
        }),
      });
      assert.equal(mismatch.status, 409);
      assert.equal((await mismatch.json()).code, "IDEMPOTENCY_MISMATCH");
      const priceConflict = await fetch(base + "/orders", {
        method: "POST",
        headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({
          ...draft,
          lines: [{ ...draft.lines[0]!, expectedPriceCop: 16999 }],
        }),
      });
      assert.equal(priceConflict.status, 409);
      assert.equal((await priceConflict.json()).code, "PRICE_CHANGED");
      const other = await (
        await fetch(base + "/auth/guest", {
          method: "POST",
          headers: nativeHeaders,
          body: "{}",
        })
      ).json();
      const otherToken = other.accessToken;
      assert.equal(
        (
          await fetch(base + `/orders/${response.id}`, {
            headers: {
              ...nativeHeaders,
              Authorization: "Bearer " + otherToken,
            },
          })
        ).status,
        404,
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
            ...nativeHeaders,
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
      assert.ok(staffChanges.some((e) => e.kind === "order.confirmed"));
      staffSocket.disconnect();
      socket.disconnect();
      db.close();
    } finally {
      if (server) await server.close();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  },
);
