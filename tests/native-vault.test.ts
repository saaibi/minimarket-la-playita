import test from "node:test";
import assert from "node:assert/strict";
import { SecureStorageWeb } from "../node_modules/@aparajita/capacitor-secure-storage/dist/esm/web.js";
import { createNativeVault } from "../packages/mobile/src/vault.js";
import {
  SessionClient,
  SessionError,
} from "../packages/mobile/src/session-client.js";

test("codec real SecureStorage: sesión y logout legados se recuperan sin borrar datos", async () => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => values.get(k) ?? null,
      setItem: (k: string, v: string) => values.set(k, v),
      removeItem: (k: string) => values.delete(k),
    },
  });
  const storage = new SecureStorageWeb();
  const actor = {
    id: "native-owner",
    role: "buyer" as const,
    label: "Test",
    guest: false,
  };
  const record = JSON.stringify({ actor, refreshToken: "legacy-refresh" });
  await storage.set("playita_auth_session", record, false, false);
  await storage.set(
    "playita_auth_logout_pending",
    JSON.stringify(["old-refresh"]),
    false,
    false,
  );
  // Previous adapter read this encoded representation without decoding it.
  assert.equal(
    typeof JSON.parse((await storage.getItem("playita_auth_session"))!),
    "string",
  );
  const vault = createNativeVault(storage, () => true);
  assert.equal(await vault.get("session"), record);
  const calls: Array<{ path: string; body: any }> = [];
  const request: typeof fetch = async (input, init) => {
    const path = String(input),
      body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ path, body });
    if (path.endsWith("/auth/logout")) return Response.json({ ok: true });
    if (path.endsWith("/auth/refresh") || path.endsWith("/auth/login"))
      return Response.json({
        actor,
        accessToken: "new-access",
        refreshToken: "new-refresh",
        accessExpiresAt: Date.now() + 300000,
      });
    throw Error("unexpected path");
  };
  const client = new SessionClient({
    base: "https://api.example.invalid",
    mode: "native",
    vault,
    fetch: request,
  });
  await client.restore();
  assert.equal(client.current!.mode, "authenticated");
  assert.equal(client.current!.actor.id, actor.id);
  assert.ok(
    calls.some(
      (c) =>
        c.path.endsWith("/auth/logout") &&
        c.body.refreshToken === "old-refresh",
    ),
  );
  assert.ok(
    calls.some(
      (c) =>
        c.path.endsWith("/auth/refresh") &&
        c.body.refreshToken === "legacy-refresh",
    ),
  );
  assert.deepEqual(JSON.parse((await vault.get("logout_pending"))!), []);
  await client.logout();
  assert.equal(await vault.get("session"), null);
  await client.login("test@example.invalid", "synthetic-only");
  assert.equal(client.current!.actor.id, actor.id);
  const reopened = new SessionClient({
    base: "https://api.example.invalid",
    mode: "native",
    vault,
    fetch: request,
  });
  await reopened.restore();
  assert.equal(reopened.current!.mode, "authenticated");
  delete (globalThis as any).localStorage;
});
test("login: timeout compatible con WebView sin AbortSignal.timeout y fallo de vault distinguible", async () => {
  const old = Object.getOwnPropertyDescriptor(AbortSignal, "timeout");
  Object.defineProperty(AbortSignal, "timeout", {
    configurable: true,
    value: undefined,
  });
  const vault = {
    get: async () => null,
    set: async () => {},
    remove: async () => {},
  };
  try {
    const request: typeof fetch = async (_url, init) =>
      new Promise((_resolve, reject) =>
        init!.signal!.addEventListener("abort", () => reject(Error("aborted"))),
      );
    const client = new SessionClient({
      base: "https://api.example.invalid",
      mode: "native",
      vault,
      fetch: request,
      authTimeoutMs: 5,
    });
    await assert.rejects(
      client.login("x@example.invalid", "synthetic-only"),
      (e: unknown) => e instanceof SessionError && e.code === "REQUEST_TIMEOUT",
    );
    const bad = new SessionClient({
      base: "https://api.example.invalid",
      mode: "native",
      vault: {
        ...vault,
        set: async () => {
          throw Error("keystore test");
        },
      },
      fetch: async () =>
        Response.json({
          actor: { id: "a", role: "buyer", label: "test", guest: false },
          accessToken: "a",
          refreshToken: "r",
          accessExpiresAt: Date.now() + 300000,
        }),
    });
    await assert.rejects(
      bad.login("x@example.invalid", "synthetic-only"),
      (e: unknown) =>
        e instanceof SessionError && e.code === "SESSION_STORAGE_UNAVAILABLE",
    );
    assert.equal(bad.current, null);
  } finally {
    if (old) Object.defineProperty(AbortSignal, "timeout", old);
  }
});
