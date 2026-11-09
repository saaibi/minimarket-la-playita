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
