import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { Pool } from "pg";
import { createApp } from "../apps/api/dist/app.js";
import { bootstrapAdmin } from "../apps/api/src/auth.js";
import { migrate } from "../scripts/migrate.js";
import { bogotaDate } from "@playita/shared";
const databaseUrl = process.env.TEST_DATABASE_URL;
test(
  "PostgreSQL + proveedor HTTP simulado: push por rol, cola transaccional, caída, reintento, logout y cambio de cuenta",
  { skip: !databaseUrl },
  async () => {
    const root = new Pool({ connectionString: databaseUrl }),
      schema = "push_" + crypto.randomUUID().replace(/-/g, ""),
      url = new URL(databaseUrl!);
    url.searchParams.set("options", "-c search_path=" + schema);
    await root.query(`CREATE SCHEMA ${schema}`);
    let server: Awaited<ReturnType<typeof createApp>> | undefined;
    let providerMode = "down";
    const deliveries: any[] = [];
    const provider = createServer(async (req, res) => {
      let body = "";
      for await (const chunk of req) body += chunk;
      deliveries.push(JSON.parse(body));
      res.setHeader("Content-Type", "application/json");
      if (providerMode === "down") {
        res.statusCode = 503;
        res.end(
          JSON.stringify({ error: { code: "messaging/server-unavailable" } }),
        );
      } else if (providerMode === "invalid") {
        res.statusCode = 400;
        res.end(
          JSON.stringify({
            error: { code: "messaging/registration-token-not-registered" },
          }),
        );
      } else
        res.end(JSON.stringify({ name: "projects/test/messages/test-only" }));
    });
    await new Promise<void>((resolve) =>
      provider.listen(0, "127.0.0.1", resolve),
    );
    const providerUrl =
      "http://127.0.0.1:" +
      (provider.address() as any).port +
      "/v1/projects/test/messages:send";
    try {
      await migrate(url.toString());
      server = await createApp({
        databaseUrl: url.toString(),
        autoPush: false,
        googleVerifier: {
          clientId: "test.apps.googleusercontent.com",
          verify: async (token: string) => ({
            subject: token,
            email: token.startsWith("second")
              ? "other@example.invalid"
              : "buyer@example.invalid",
            emailAuthoritative: true,
          }),
        },
        pushSender: async (token, message) => {
          const response = await fetch(providerUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              message: {
                token,
                notification: { title: message.title, body: message.body },
                data: message.data,
              },
            }),
            signal: AbortSignal.timeout(1000),
          });
          if (!response.ok) throw (await response.json()).error;
        },
      });
      const pass = "synthetic-push-" + crypto.randomUUID();
      await bootstrapAdmin(server.pool, "admin@example.invalid", pass);
      await server.app.listen(0, "127.0.0.1");
      const base =
        "http://127.0.0.1:" + server.app.getHttpServer().address().port;
      async function req(
        path: string,
        token = "",
        method = "GET",
        body?: unknown,
        key = crypto.randomUUID(),
      ) {
        const r = await fetch(base + path, {
          method,
          headers: {
            "Content-Type": "application/json",
            "X-Playita-Client": "native",
            ...(token ? { Authorization: "Bearer " + token } : {}),
            "Idempotency-Key": key,
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        return { status: r.status, data: await r.json() };
      }
      async function login(email: string) {
        return (await req("/auth/login", "", "POST", { email, password: pass }))
          .data;
      }
      const admin = await login("admin@example.invalid");
      await req("/auth/users", admin.accessToken, "POST", {
        email: "seller@example.invalid",
        password: pass,
        role: "seller",
      });
      async function googleLogin(credential: string) {
        const challenge = (await req("/auth/google/challenge", "", "POST", {}))
          .data;
        const reply = await req("/auth/google/verify", "", "POST", {
          challengeId: challenge.challengeId,
          proof: challenge.proof,
          credential,
        });
        assert.equal(reply.status, 200);
        return reply.data;
      }
      const seller = await login("seller@example.invalid"),
        buyer = await googleLogin("first-credential-test-only-xxxxxxxxx"),
        other = await googleLogin("second-credential-test-only-xxxxxxxxx");
      const firstId = buyer.actor.id,
        secondId = other.actor.id;
      const guest = (await req("/auth/guest", "", "POST", {})).data;
      const ids = [
        crypto.randomUUID(),
        crypto.randomUUID(),
        crypto.randomUUID(),
        crypto.randomUUID(),
      ];
      const tokens = [
        "admin-token-test-only-xxxxxxxxxx",
        "seller-token-test-only-xxxxxxxx",
        "buyer-token-test-only-xxxxxxxxx",
        "other-token-test-only-xxxxxxxxx",
      ];
      assert.equal(
        (await req("/push/options", buyer.accessToken)).data.available,
        true,
      );
      assert.equal(
        (
          await req("/push/devices", guest.accessToken, "POST", {
            installationId: ids[0],
            token: tokens[0],
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await req("/push/devices", buyer.accessToken, "POST", {
            installationId: ids[0],
            token: tokens[0],
            userId: secondId,
          })
        ).status,
        400,
      );
      for (const [i, account] of [admin, seller, buyer, other].entries())
        assert.equal(
          (
            await req("/push/devices", account.accessToken, "POST", {
              installationId: ids[i],
              token: tokens[i],
            })
          ).status,
          200,
        );
      const settings = (await req("/settings", admin.accessToken)).data;
      settings.override = "open";
      settings.overrideDate = bogotaDate();
      await req("/settings", admin.accessToken, "PUT", settings);
      const p = (await req("/inventory", admin.accessToken)).data.find(
          (p: any) => p.kind === "unit",
        ),
        presentation = p.presentations.find((v: any) => v.factor === 1);
      const draft = {
        paymentMethod: "cash",
        lines: [
          {
            productId: p.id,
            presentationId: presentation.id,
            quantity: 1,
            expectedPriceCop: presentation.priceCop,
          },
        ],
      };
      const key = crypto.randomUUID(),
        created = await req("/orders", buyer.accessToken, "POST", draft, key);
      assert.equal(created.status, 201);
      const orderId = created.data.id;
      assert.equal(
        (await req("/orders", buyer.accessToken, "POST", draft, key)).status,
        201,
      );
      assert.equal(
        (await server.pool.query("SELECT count(*)::int n FROM push_deliveries"))
          .rows[0].n,
        2,
      );
      assert.equal(deliveries.length, 0);
      await server.push.flush();
      assert.equal(deliveries.length, 2);
      assert.equal(
        (
          await server.pool.query(
            "SELECT count(*)::int n FROM push_deliveries WHERE status='pending' AND attempts=1",
          )
        ).rows[0].n,
        2,
      );
      assert.equal(
        (await server.pool.query("SELECT count(*)::int n FROM orders")).rows[0]
          .n,
        1,
      );
      const afterStock = (
        await server.pool.query(
          "SELECT stock,reserved FROM products WHERE id=$1",
          [p.id],
        )
      ).rows[0];
      assert.equal(afterStock.stock, p.stock);
      assert.equal(afterStock.reserved, 1);
      providerMode = "ok";
      await server.pool.query(
        "UPDATE push_deliveries SET next_attempt_at=now()",
      );
      await server.push.flush();
      assert.equal(
        (
          await server.pool.query(
            "SELECT count(*)::int n FROM push_deliveries WHERE status='sent'",
          )
        ).rows[0].n,
        2,
      );
      assert.deepEqual(
        deliveries
          .slice(2)
          .map((d) => d.message.token)
          .sort(),
        tokens.slice(0, 2).sort(),
      );
      const action = async (action: string) =>
        req("/orders/" + orderId + "/actions", admin.accessToken, "POST", {
          action,
        });
      assert.equal((await action("accept")).status, 201);
      await server.push.flush();
      assert.equal(deliveries.at(-1).message.token, tokens[2]);
      assert.ok(!deliveries.some((d) => d.message.token === tokens[3]));
      const beforeSwitch = deliveries.length;
      assert.equal((await action("ready")).status, 201);
      await req("/push/devices", other.accessToken, "POST", {
        installationId: ids[2],
        token: tokens[2],
      });
      await req("/push/devices/unregister", buyer.accessToken, "POST", {
        installationId: ids[2],
      });
      const binding = (
        await server.pool.query(
          "SELECT user_id,enabled FROM push_devices WHERE installation_id=$1",
          [ids[2]],
        )
      ).rows[0];
      assert.equal(binding.user_id, secondId);
      assert.equal(binding.enabled, true);
      await server.push.flush();
      assert.equal(deliveries.length, beforeSwitch);
      assert.equal(
        (
          await server.pool.query(
            "SELECT count(*)::int n FROM push_deliveries WHERE status='cancelled'",
          )
        ).rows[0].n,
        1,
      );
      // An explicitly assigned cash customer receives their receipt, never the cashier.
      const beforeReceipt = deliveries.length;
      const paid = await req("/credit/checkout", admin.accessToken, "POST", {
        mode: "auto",
        clientId: secondId,
        lines: draft.lines,
        cashReceived: presentation.priceCop,
        expectedTotalCop: presentation.priceCop,
        expectedBalanceCop: 0,
        expectedCreditEnabled: false,
      });
      assert.equal(paid.status, 201);
      await server.push.flush();
      assert.equal(deliveries.length, beforeReceipt + 2);
      assert.deepEqual(
        deliveries
          .slice(beforeReceipt)
          .map((d) => d.message.token)
          .sort(),
        [tokens[2], tokens[3]].sort(),
      );
      const ownNotices = (await req("/notifications", other.accessToken)).data;
      const receipt = ownNotices.find(
        (n: any) => n.payload.orderId === paid.data.id,
      );
      assert.ok(receipt);
      await req(
        "/notifications/" + receipt.id + "/read",
        other.accessToken,
        "POST",
        {},
      );
      assert.equal(
        (await req("/notifications", other.accessToken)).data.find(
          (n: any) => n.id === receipt.id,
        ).read,
        true,
      );
      await req(
        "/notifications/" + receipt.id + "/read",
        buyer.accessToken,
        "POST",
        {},
      );
      assert.equal(
        (
          await server.pool.query(
            "SELECT count(*)::int n FROM notification_reads WHERE user_id=$1 AND event_id=$2",
            [firstId, receipt.id],
          )
        ).rows[0].n,
        0,
      );
      await req("/orders", buyer.accessToken, "POST", draft);
      await req("/auth/logout", "", "POST", {
        refreshToken: admin.refreshToken,
      });
      const lastStart = deliveries.length;
      providerMode = "invalid";
      await server.push.flush();
      assert.equal(deliveries.length, lastStart + 1);
      assert.equal(deliveries.at(-1).message.token, tokens[1]);
      assert.equal(
        (
          await server.pool.query(
            "SELECT enabled FROM push_devices WHERE installation_id=$1",
            [ids[1]],
          )
        ).rows[0].enabled,
        false,
      );
      assert.ok(
        deliveries.every(
          (d) => !JSON.stringify(d.message.notification).includes("@"),
        ),
      );
    } finally {
      await server?.close();
      await new Promise<void>((resolve) => provider.close(() => resolve()));
      await root.query(`DROP SCHEMA ${schema} CASCADE`);
      await root.end();
    }
  },
);
