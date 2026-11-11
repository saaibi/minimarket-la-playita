import test from "node:test";
import assert from "node:assert/strict";
import {
  SessionClient,
  SessionError,
} from "../packages/mobile/src/session-client.js";
import type { SecretVault } from "../packages/mobile/src/vault.js";
class TestVault implements SecretVault {
  values = new Map<string, string>();
  async get(k: string) {
    return this.values.get(k) || null;
  }
  async set(k: string, v: string) {
    this.values.set(k, v);
  }
  async remove(k: string) {
    this.values.delete(k);
  }
}
const actor = (id: string) => ({
  id,
  role: "buyer" as const,
  label: "Invitado",
  guest: true,
});
test("cliente nativo: refresh solo en vault, access en memoria y mismatch nunca envía cola ajena", async () => {
  const vault = new TestVault(),
    calls: string[] = [];
  let id = "a";
  const request: typeof fetch = async (input, init) => {
    const path = String(input);
    calls.push(path);
    if (path.endsWith("/auth/guest"))
      return Response.json({
        actor: actor(id),
        accessToken: "access-" + id,
        refreshToken: "refresh-" + id,
        accessExpiresAt: Date.now() + 300000,
      });
    if (path.endsWith("/orders")) return Response.json({ id: "order" });
    return Response.json({ ok: true });
  };
  const client = new SessionClient({
    base: "http://test",
    mode: "native",
    vault,
    fetch: request,
  });
  await client.guest();
  assert.equal(vault.values.get("session")!.includes("access-a"), false);
  assert.equal(vault.values.get("session")!.includes("refresh-a"), true);
  id = "b";
  await client.guest();
  const before = calls.length;
  const response = await client.transport("a")("key", {
    paymentMethod: "cash",
    lines: [],
  });
  assert.equal(response.status, 401);
  assert.equal(calls.length, before);
  await client.logout();
  assert.equal(client.current, null);
  assert.equal(await vault.get("session"), null);
});
test("nativo: reinicio sin red conserva identidad como offline, no autenticada ni capaz de enviar", async () => {
  const vault = new TestVault();
  await vault.set(
    "session",
    JSON.stringify({ actor: actor("a"), refreshToken: "stored-secret" }),
  );
  const client = new SessionClient({
    base: "http://test",
    mode: "native",
    vault,
    fetch: async () => {
      throw Error("offline");
    },
  });
  const restored = await client.restore();
  assert.equal(restored!.mode, "offline");
  assert.equal(restored!.actor.id, "a");
  await assert.rejects(client.request("/orders", { method: "POST" }, "a"));
  assert.ok(await vault.get("session"));
  await client.logout();
  assert.equal(client.current, null);
  assert.ok((await vault.get("logout_pending"))!.includes("stored-secret"));
});
test("web: cookies include + CSRF, no refresh/access en storage y 401 retira sesión protegida", async () => {
  let reject = false;
  const records: RequestInit[] = [];
  const client = new SessionClient({
    base: "http://test",
    mode: "web",
    csrf: () => "csrf-value",
    fetch: async (_input, init) => {
      records.push(init!);
      return reject
        ? Response.json({ code: "SESSION_EXPIRED" }, { status: 401 })
        : Response.json({
            actor: actor("web-a"),
            accessExpiresAt: Date.now() + 300000,
          });
    },
  });
  await client.guest();
  await client.request("/orders", { method: "POST", body: "{}" });
  assert.equal(records[1]!.credentials, "include");
  assert.equal(
    (records[1]!.headers as Record<string, string>)["X-CSRF-Token"],
    "csrf-value",
  );
  assert.equal(
    (records[1]!.headers as Record<string, string>).Authorization,
    undefined,
  );
  reject = true;
  await assert.rejects(client.refresh(), SessionError);
  assert.equal(client.current, null);
});
test("refresh concurrente cliente es single-flight", async () => {
  const vault = new TestVault();
  await vault.set(
    "session",
    JSON.stringify({ actor: actor("a"), refreshToken: "saved-refresh" }),
  );
  let calls = 0;
  const client = new SessionClient({
    base: "http://test",
    mode: "native",
    vault,
    fetch: async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 5));
      return Response.json({
        actor: actor("a"),
        accessToken: "next-access",
        refreshToken: "next-refresh",
        accessExpiresAt: Date.now() + 300000,
      });
    },
  });
  await Promise.all([client.refresh(), client.refresh()]);
  assert.equal(calls, 1);
});

test("logout durante refresh no restaura una sesión ni token después del cierre", async () => {
  const vault = new TestVault();
  await vault.set(
    "session",
    JSON.stringify({ actor: actor("a"), refreshToken: "old" }),
  );
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  const client = new SessionClient({
    base: "http://test",
    mode: "native",
    vault,
    fetch: async (input) => {
      if (String(input).endsWith("/auth/refresh")) {
        await gate;
        return Response.json({
          actor: actor("a"),
          accessToken: "late-access",
          refreshToken: "late-refresh",
          accessExpiresAt: Date.now() + 300000,
        });
      }
      return Response.json({ ok: true });
    },
  });
  const pending = client.refresh();
  await new Promise((r) => setTimeout(r, 1));
  await client.logout();
  release();
  await assert.rejects(pending);
  assert.equal(client.current, null);
  assert.equal(await vault.get("session"), null);
});

test("restauración bloqueada vence sin borrar vault y una respuesta tardía no restaura sesión", async () => {
  const { SessionClient } =
    await import("../packages/mobile/src/session-client.js");
  let release: (value: string | null) => void = () => {};
  let removed = 0;
  const stuck = new SessionClient({
    base: "https://api.example",
    mode: "native",
    restoreTimeoutMs: 20,
    vault: {
      get: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
      set: async () => {},
      remove: async () => {
        removed++;
      },
    },
  });
  await assert.rejects(
    stuck.restore(),
    (e: any) => e.code === "RESTORE_TIMEOUT",
  );
  release(null);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(stuck.current, null);
  assert.equal(removed, 0);
});
test("Google nativo: challenge, token solo al servidor y sesión en vault; cancelación no autentica", async () => {
  const vault = new TestVault();
  const calls: Array<{ path: string; body: any }> = [];
  const client = new SessionClient({
    base: "https://api.example.invalid",
    mode: "native",
    vault,
    fetch: async (input, init) => {
      const path = String(input),
        body = init?.body ? JSON.parse(String(init.body)) : null;
      calls.push({ path, body });
      if (path.endsWith("/challenge"))
        return Response.json({
          challengeId: "challenge-test",
          nonce: "nonce-test",
          clientId: "test.apps.googleusercontent.com",
          proof: "proof-test",
        });
      if (path.endsWith("/verify"))
        return Response.json({
          actor: { ...actor("google-buyer"), guest: false },
          accessExpiresAt: Date.now() + 300000,
          accessToken: "access-test",
          refreshToken: "refresh-test",
        });
      throw Error("unexpected path");
    },
  });
  await assert.rejects(
    client.google(async () => {
      throw Error("cancelled");
    }),
  );
  assert.equal(client.current, null);
  assert.equal(
    calls.some((c) => c.path.endsWith("/verify")),
    false,
  );
  await client.google(async (challenge) => {
    assert.equal(challenge.nonce, "nonce-test");
    return "google-id-token-test";
  });
  assert.equal(client.current!.actor.id, "google-buyer");
  assert.equal(calls.at(-1)!.body.proof, "proof-test");
  assert.equal(calls.at(-1)!.body.credential, "google-id-token-test");
  const saved = await vault.get("session");
  assert.ok(saved?.includes("refresh-test"));
  assert.equal(saved?.includes("google-id-token-test"), false);
});
test("Google preparado: no permite completar un challenge después de cambiar sesión", async () => {
  const requests: string[] = [];
  const client = new SessionClient({
    base: "https://api.example.invalid",
    mode: "web",
    fetch: async (input) => {
      const path = String(input);
      requests.push(path);
      if (path.endsWith("/challenge"))
        return Response.json({
          challengeId: "test",
          nonce: "nonce",
          clientId: "test.apps.googleusercontent.com",
        });
      if (path.endsWith("/auth/guest"))
        return Response.json({
          actor: actor("different-owner"),
          accessExpiresAt: Date.now() + 300000,
        });
      throw Error("unexpected path");
    },
  });
  const challenge = await client.prepareGoogle();
  await client.guest();
  await assert.rejects(
    client.completeGoogle(challenge, "synthetic-token"),
    (e: unknown) => e instanceof SessionError && e.code === "SESSION_CHANGED",
  );
  assert.equal(
    requests.some((p) => p.endsWith("/verify")),
    false,
  );
  assert.equal(client.current!.actor.id, "different-owner");
});
