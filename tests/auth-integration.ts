import test from "node:test";
import { bogotaDate } from "@playita/shared";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { randomInt } from "node:crypto";
import { createApp } from "../apps/api/dist/app.js";
import { bootstrapAdmin } from "../apps/api/src/auth.js";
import { migrate } from "../scripts/migrate.js";
import type { VerificationProvider } from "../apps/api/src/verification.js";
class TestVerification implements VerificationProvider {
  values = new Map<string, { code: string; used: boolean }>();
  async start(_phone: string) {
    const id = crypto.randomUUID();
    this.values.set(id, {
      code: String(randomInt(100000, 999999)),
      used: false,
    });
    return id;
  }
  async check(ref: string, code: string) {
    const v = this.values.get(ref);
    if (!v || v.used || v.code !== code) return false;
    v.used = true;
    return true;
  }
}
const databaseUrl = process.env.TEST_DATABASE_URL;
test(
  "PostgreSQL real: auth staff/invitado, rotación/reuso/logout, CSRF, alta/desactivación y OTP solo con proveedor de test",
  { skip: !databaseUrl ? "TEST_DATABASE_URL no configurado" : false },
  async () => {
    const root = new Pool({ connectionString: databaseUrl }),
      schema = "auth_" + crypto.randomUUID().replace(/-/g, ""),
      url = new URL(databaseUrl!);
    await root.query(`CREATE SCHEMA ${schema}`);
    url.searchParams.set("options", "-c search_path=" + schema);
    let server: Awaited<ReturnType<typeof createApp>> | undefined;
    try {
      await migrate(url.toString());
      const settingsPool = new Pool({ connectionString: url.toString() });
      await settingsPool.query(
        "UPDATE store_settings SET schedule=schedule || $1::jsonb",
        [JSON.stringify({ override: "open", overrideDate: bogotaDate() })],
      );
      await settingsPool.end();
      const provider = new TestVerification();
      server = await createApp({
        databaseUrl: url.toString(),
        verificationProvider: provider,
      });
      const pass = "only-tests-" + crypto.randomUUID();
      const failedBootstrap = spawnSync(
        process.execPath,
        ["--import", "tsx", "scripts/bootstrap-render.ts"],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            DATABASE_URL: url.toString(),
            PLAYITA_BOOTSTRAP_ADMIN: "once",
            PLAYITA_ADMIN_EMAIL: "owner@example.invalid",
            PLAYITA_ADMIN_PASSWORD: "short",
          },
        },
      );
      assert.equal(
        failedBootstrap.status,
        0,
        "optional bootstrap must not stop healthy API startup",
      );
      assert.match(failedBootstrap.stderr, /ADMIN_PASSWORD_TOO_SHORT/);
      assert.ok(!failedBootstrap.stderr.includes("short"));

      await assert.rejects(
        bootstrapAdmin(server.pool, "owner@example.invalid", "short"),
      );
      assert.equal(
        (
          await server.pool.query(
            "SELECT count(*)::int AS count FROM app_users WHERE role='admin'",
          )
        ).rows[0].count,
        0,
      );
      await bootstrapAdmin(server.pool, "owner@example.invalid", pass);
      await assert.rejects(
        bootstrapAdmin(server.pool, "another@example.invalid", pass),
      );
      assert.equal(
        await bootstrapAdmin(server.pool, "another@example.invalid", pass, {
          onlyIfMissing: true,
        }),
        false,
      );
      assert.equal(
        (
          await server.pool.query(
            "SELECT count(*)::int AS count FROM app_users WHERE role='admin'",
          )
        ).rows[0].count,
        1,
      );
      await server.app.listen(0, "127.0.0.1");
      assert.equal(
        await bootstrapAdmin(server.pool, "invalid", "short", {
          onlyIfMissing: true,
        }),
        false,
      );
      const base =
        "http://127.0.0.1:" + server.app.getHttpServer().address().port;
      const native = {
          "Content-Type": "application/json",
          "X-Playita-Client": "native",
        },
        web = {
          "Content-Type": "application/json",
          "X-Playita-Client": "web",
          Origin: "http://127.0.0.1:5173",
        };
      const post = (
        path: string,
        body: unknown,
        headers: Record<string, string> = native,
      ) =>
        fetch(base + path, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        });
      const login = async () => {
        const r = await post("/auth/login", {
          email: "owner@example.invalid",
          password: pass,
        });
        assert.equal(r.status, 200);
        return await r.json();
      };
      const wrong = await post("/auth/login", {
          email: "owner@example.invalid",
          password: "wrong",
        }),
        missing = await post("/auth/login", {
          email: "missing@example.invalid",
          password: "wrong",
        });
      assert.equal(wrong.status, 401);
      assert.deepEqual(await wrong.json(), await missing.json());
      const owner = await login(),
        ownerHeaders = {
          ...native,
          Authorization: "Bearer " + owner.accessToken,
        };
      assert.equal(
        (await fetch(base + "/inventory", { headers: ownerHeaders })).status,
        200,
      );
      assert.equal(
        (
          await fetch(base + "/auth/me", {
            headers: {
              ...native,
              Authorization: "Bearer fake-or-old-demo-jwt",
            },
          })
        ).status,
        401,
      );
      const stored = (
        await server.pool.query(
          "SELECT u.password_hash,s.refresh_hash FROM app_users u JOIN auth_sessions s ON u.id=s.user_id WHERE u.email=$1",
          ["owner@example.invalid"],
        )
      ).rows[0];
      assert.equal(stored.password_hash.includes(pass), false);
      assert.notEqual(stored.refresh_hash, owner.refreshToken);
      const refreshed = await (
        await post("/auth/refresh", { refreshToken: owner.refreshToken })
      ).json();
      assert.notEqual(refreshed.refreshToken, owner.refreshToken);
      assert.equal(
        (await fetch(base + "/inventory", { headers: ownerHeaders })).status,
        401,
      );
      const reused = await post("/auth/refresh", {
        refreshToken: owner.refreshToken,
      });
      assert.equal(reused.status, 401);
      assert.equal((await reused.json()).code, "SESSION_REUSED");
      assert.equal(
        (
          await fetch(base + "/inventory", {
            headers: {
              ...native,
              Authorization: "Bearer " + refreshed.accessToken,
            },
          })
        ).status,
        401,
      );
      const current = await login();
      assert.equal(
        (await post("/auth/logout", { refreshToken: current.refreshToken }))
          .status,
        200,
      );
      assert.equal(
        (
          await fetch(base + "/inventory", {
            headers: {
              ...native,
              Authorization: "Bearer " + current.accessToken,
            },
          })
        ).status,
        401,
      );
      const expired = await login();
      await server.pool.query(
        "UPDATE auth_sessions SET absolute_expires_at=now()-interval '1 second' WHERE access_hash=encode(sha256($1::bytea),'hex')",
        [Buffer.from(expired.accessToken)],
      );
      assert.equal(
        (await post("/auth/refresh", { refreshToken: expired.refreshToken }))
          .status,
        401,
      );
      const cookieLogin = await post(
        "/auth/login",
        { email: "owner@example.invalid", password: pass },
        web,
      );
      assert.equal(cookieLogin.status, 200);
      const body = await cookieLogin.json();
      assert.equal(body.refreshToken, undefined);
      assert.equal(body.accessToken, undefined);
      const cookies = cookieLogin.headers.getSetCookie(),
        jar = cookies.map((c) => c.split(";")[0]).join("; "),
        csrf = cookies
          .find((c) => c.startsWith("playita_csrf="))!
          .split(";")[0]!
          .split("=")[1]!;
      assert.ok(
        cookies
          .find((c) => c.startsWith("playita_refresh="))!
          .includes("HttpOnly"),
      );
      const webHeaders = { ...web, Cookie: jar };
      assert.equal((await post("/auth/refresh", {}, webHeaders)).status, 403);
      assert.equal(
        (
          await post(
            "/auth/refresh",
            {},
            {
              ...webHeaders,
              "X-CSRF-Token": csrf,
              Origin: "https://evil.example.invalid",
            },
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await post(
            "/orders",
            {},
            { ...webHeaders, "Idempotency-Key": crypto.randomUUID() },
          )
        ).status,
        403,
      );
      const webRefresh = await post(
        "/auth/refresh",
        {},
        { ...webHeaders, "X-CSRF-Token": csrf },
      );
      assert.equal(webRefresh.status, 200);
      const admin = await login(),
        adminHeaders = {
          ...native,
          Authorization: "Bearer " + admin.accessToken,
        };
      assert.equal(
        (
          await post(
            "/auth/users",
            { email: "staff@example.invalid", password: pass, role: "seller" },
            adminHeaders,
          )
        ).status,
        201,
      );
      const staffLogin = await (
          await post("/auth/login", {
            email: "staff@example.invalid",
            password: pass,
          })
        ).json(),
        staffHeaders = {
          ...native,
          Authorization: "Bearer " + staffLogin.accessToken,
        };
      assert.equal(
        (
          await post(
            "/auth/users",
            {
              email: "elevated@example.invalid",
              password: pass,
              role: "admin",
            },
            staffHeaders,
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await post("/auth/users", {
            email: "public@example.invalid",
            password: pass,
            role: "admin",
          })
        ).status,
        401,
      );
      assert.equal((await post("/auth/guest", { role: "admin" })).status, 400);
      const guest = await (await post("/auth/guest", {})).json(),
        other = await (await post("/auth/guest", {})).json();
      assert.notEqual(guest.actor.id, other.actor.id);
      assert.equal(guest.actor.role, "buyer");
      assert.equal(guest.actor.guest, true);
      assert.equal(
        (
          await fetch(base + "/auth/users", {
            headers: {
              ...native,
              Authorization: "Bearer " + guest.accessToken,
            },
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await post(
            "/auth/users/" + admin.actor.id + "/disable",
            {},
            adminHeaders,
          )
        ).status,
        409,
      );
      const userList = await (
        await fetch(base + "/auth/users", { headers: adminHeaders })
      ).json();
      const staffId = userList.find(
        (u: any) => u.email === "staff@example.invalid",
      ).id;
      assert.equal(
        (await post("/auth/users/" + staffId + "/disable", {}, adminHeaders))
          .status,
        200,
      );
      assert.equal(
        (await fetch(base + "/inventory", { headers: staffHeaders })).status,
        401,
      );
      const start = await (
        await post("/auth/whatsapp/request", { phone: "+573000000001" })
      ).json();
      const reference = (
        await server.pool.query(
          "SELECT provider_reference FROM otp_challenges WHERE id=$1",
          [start.challengeId],
        )
      ).rows[0].provider_reference;
      assert.equal(
        (
          await post("/auth/whatsapp/verify", {
            challengeId: start.challengeId,
            code: "000000",
          })
        ).status,
        401,
      );
      const verified = await post("/auth/whatsapp/verify", {
        challengeId: start.challengeId,
        code: provider.values.get(reference)!.code,
      });
      assert.equal(verified.status, 200);
      assert.equal((await verified.json()).actor.role, "buyer");
      assert.equal(
        (
          await post("/auth/whatsapp/verify", {
            challengeId: start.challengeId,
            code: provider.values.get(reference)!.code,
          })
        ).status,
        401,
      );
      let limited = false;
      // Fixed windows can roll during this test. Two budgets still cap 22 attempts.
      for (let i = 0; i < 22; i++) {
        const response = await post("/auth/login", {
          email: "limited@example.invalid",
          password: "wrong",
        });
        if (response.status === 429) {
          limited = true;
          break;
        }
        assert.equal(response.status, 401);
      }
      assert.equal(
        limited,
        true,
        "Login must be limited even if the 15-minute window rolls",
      );
    } finally {
      if (server) await server.close();
      await root.query(`DROP SCHEMA ${schema} CASCADE`);
      await root.end();
    }
  },
);
