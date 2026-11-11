import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from "jose";
import { createApp } from "../apps/api/dist/app.js";
import { GoogleIdVerifier } from "../apps/api/src/google.js";
import { bootstrapAdmin } from "../apps/api/src/auth.js";
import { migrate } from "../scripts/migrate.js";
const databaseUrl = process.env.TEST_DATABASE_URL;
test(
  "PostgreSQL: Google challenge privado, replay, nonce, cuenta buyer, conflictos y aislamiento web/native",
  { skip: !databaseUrl },
  async () => {
    const root = new Pool({ connectionString: databaseUrl }),
      schema = "google_" + crypto.randomUUID().replace(/-/g, "");
    await root.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(databaseUrl!);
    url.searchParams.set("options", "-c search_path=" + schema);
    let server: Awaited<ReturnType<typeof createApp>> | undefined;
    try {
      await migrate(url.toString());
      const { publicKey, privateKey } = await generateKeyPair("RS256");
      const verifier = new GoogleIdVerifier(
        "test.apps.googleusercontent.com",
        createLocalJWKSet({
          keys: [{ ...(await exportJWK(publicKey)), kid: "test" }],
        }),
      );
      server = await createApp({
        databaseUrl: url.toString(),
        googleVerifier: verifier,
      });
      await bootstrapAdmin(
        server.pool,
        "owner@example.invalid",
        "integration-only-" + crypto.randomUUID(),
      );
      await server.app.listen(0, "127.0.0.1");
      const base =
        "http://127.0.0.1:" + server.app.getHttpServer().address().port;
      async function req(
        path: string,
        body?: unknown,
        headers: Record<string, string> = {},
      ) {
        const r = await fetch(base + path, {
          method: body === undefined ? "GET" : "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Playita-Client": "native",
            ...headers,
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        return {
          status: r.status,
          data: await r.json(),
          cookies: r.headers.getSetCookie(),
        };
      }
      async function jwt(
        nonce: string,
        subject = "subject-a",
        email = "buyer@example.invalid",
      ) {
        return new SignJWT({ sub: subject, email, email_verified: true, nonce })
          .setProtectedHeader({ alg: "RS256", kid: "test" })
          .setIssuer("https://accounts.google.com")
          .setAudience(verifier.clientId)
          .setIssuedAt()
          .setExpirationTime("5m")
          .sign(privateKey);
      }
      const options = await req("/auth/options");
      assert.equal(options.data.google.available, true);
      const c = (await req("/auth/google/challenge", {})).data;
      const payload = {
        challengeId: c.challengeId,
        proof: c.proof,
        credential: await jwt(c.nonce),
      };
      assert.equal(
        (
          await req("/auth/google/verify", {
            ...payload,
            proof: "wrong".repeat(10),
          })
        ).status,
        401,
      );
      assert.equal(
        (
          await req("/auth/google/verify", {
            ...payload,
            credential: await jwt("wrong"),
          })
        ).status,
        401,
      );
      const first = await req("/auth/google/verify", payload);
      assert.equal(first.status, 200);
      assert.equal(first.data.actor.role, "buyer");
      assert.equal(first.data.actor.guest, false);
      assert.equal((await req("/auth/google/verify", payload)).status, 401);
      const next = (await req("/auth/google/challenge", {})).data;
      const again = await req("/auth/google/verify", {
        challengeId: next.challengeId,
        proof: next.proof,
        credential: await jwt(next.nonce),
      });
      assert.equal(again.data.actor.id, first.data.actor.id);
      const collision = (await req("/auth/google/challenge", {})).data;
      assert.equal(
        (
          await req("/auth/google/verify", {
            challengeId: collision.challengeId,
            proof: collision.proof,
            credential: await jwt(
              collision.nonce,
              "different-sub",
              "owner@example.invalid",
            ),
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await server.pool.query(
            "SELECT role FROM app_users WHERE email='owner@example.invalid'",
          )
        ).rows[0].role,
        "admin",
      );
      const expired = (await req("/auth/google/challenge", {})).data;
      await server.pool.query(
        "UPDATE google_challenges SET expires_at=now()-interval '1 minute' WHERE id=$1",
        [expired.challengeId],
      );
      assert.equal(
        (
          await req("/auth/google/verify", {
            challengeId: expired.challengeId,
            proof: expired.proof,
            credential: await jwt(expired.nonce),
          })
        ).status,
        401,
      );
      const web = {
        "X-Playita-Client": "web",
        Origin: "http://127.0.0.1:5173",
      };
      assert.equal(
        (
          await req(
            "/auth/google/challenge",
            {},
            { ...web, Origin: "https://evil.invalid" },
          )
        ).status,
        403,
      );
      const w = await req("/auth/google/challenge", {}, web);
      assert.equal(w.status, 200);
      assert.equal(w.data.proof, undefined);
      assert.match(w.cookies[0]!, /HttpOnly/);
      const webPayload = {
        challengeId: w.data.challengeId,
        credential: await jwt(w.data.nonce, "web-sub", "web@example.invalid"),
      };
      assert.equal(
        (await req("/auth/google/verify", webPayload, web)).status,
        401,
      );
      const webLogin = await req("/auth/google/verify", webPayload, {
        ...web,
        Cookie: w.cookies[0]!.split(";")[0]!,
      });
      assert.equal(webLogin.status, 200);
      assert.equal(webLogin.data.accessToken, undefined);
      assert.ok(webLogin.cookies.some((c) => c.startsWith("playita_access=")));
      assert.equal(
        (await req("/auth/google/verify", { ...webPayload, proof: c.proof }))
          .status,
        401,
      );
      await server.pool.query("UPDATE app_users SET active=false WHERE id=$1", [
        first.data.actor.id,
      ]);
      const disabled = (await req("/auth/google/challenge", {})).data;
      assert.equal(
        (
          await req("/auth/google/verify", {
            challengeId: disabled.challengeId,
            proof: disabled.proof,
            credential: await jwt(disabled.nonce),
          })
        ).status,
        403,
      );
    } finally {
      await server?.close();
      await root.query(`DROP SCHEMA ${schema} CASCADE`);
      await root.end();
    }
  },
);
