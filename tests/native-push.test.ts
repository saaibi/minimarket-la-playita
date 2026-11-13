import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
test("Push nativo: permiso voluntario, rechazo, registro propio, apertura y aislamiento al cambiar cuenta", async () => {
  const dom = new JSDOM("<html><body></body></html>", {
    url: "http://localhost",
  });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    localStorage: dom.window.localStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const React = await import("react"),
    { render, fireEvent, waitFor, cleanup, act } =
      await import("@testing-library/react");
  const { auth } = await import("../apps/web/src/session.js"),
    { useNativePush, NativePushControl } =
      await import("../apps/web/src/native-push.js");
  const previous = auth.request;
  const oldSession = auth.current;
  let permission = "prompt",
    permissionRequests = 0,
    unregistered = 0;
  const listeners = new Map<string, Function>(),
    requests: any[] = [],
    opened: any[] = [],
    received: any[] = [];
  const api = {
    addListener: async (name: string, callback: Function) => {
      listeners.set(name, callback);
      return {
        remove: async () => {
          if (listeners.get(name) === callback) listeners.delete(name);
        },
      };
    },
    checkPermissions: async () => ({ receive: permission }),
    requestPermissions: async () => {
      permissionRequests++;
      return { receive: "denied" };
    },
    createChannel: async () => {},
    register: async () => {
      queueMicrotask(() =>
        listeners.get("registration")?.({
          value: "synthetic-device-token-xxxxxxxxxx",
        }),
      );
    },
    unregister: async () => {
      unregistered++;
    },
  };
  const platform = { android: true, api: api as any };
  auth.request = async (path, init, owner) => {
    requests.push({
      path,
      body: init?.body ? JSON.parse(String(init.body)) : null,
      owner,
    });
    return Response.json(
      path === "/push/options" ? { available: true } : { ok: true },
    );
  };
  function session(owner: string) {
    auth.current = {
      actor: { id: owner, role: "buyer", guest: false, label: "Synthetic" },
      mode: "authenticated",
      accessExpiresAt: Date.now() + 60000,
    } as any;
  }
  function Screen({ owner }: { owner: string }) {
    const push = useNativePush(
      owner,
      false,
      true,
      async (order, event) => {
        opened.push([order, event]);
      },
      async () => {
        received.push(true);
      },
      platform,
    );
    return React.createElement(NativePushControl, { push });
  }
  try {
    session("account-a");
    const view = render(React.createElement(Screen, { owner: "account-a" }));
    await waitFor(() =>
      assert.ok(view.getByRole("button", { name: "Activar avisos" })),
    );
    assert.equal(permissionRequests, 0);
    assert.ok(!requests.some((r) => r.path === "/push/devices"));
    fireEvent.click(view.getByRole("button", { name: "Activar avisos" }));
    await waitFor(() => assert.ok(view.getByText(/Permiso no concedido/)));
    assert.equal(permissionRequests, 1);
    assert.ok(!requests.some((r) => r.path === "/push/devices"));
    permission = "granted";
    fireEvent.click(view.getByRole("button", { name: "Activar avisos" }));
    await waitFor(() =>
      assert.ok(view.getByRole("button", { name: "Desactivar avisos" })),
    );
    const registered = requests.find((r) => r.path === "/push/devices");
    assert.equal(registered.owner, "account-a");
    assert.deepEqual(Object.keys(registered.body).sort(), [
      "installationId",
      "token",
    ]);
    const lateRegistration = listeners.get("registration")!;
    const orderId = crypto.randomUUID();
    await act(async () => {
      listeners.get("pushNotificationReceived")?.({});
      listeners.get("pushNotificationActionPerformed")?.({
        notification: { data: { orderId, eventId: "12" } },
      });
    });
    assert.equal(received.length, 1);
    assert.deepEqual(opened, [[orderId, "12"]]);
    session("account-b");
    view.rerender(React.createElement(Screen, { owner: "account-b" }));
    await waitFor(() =>
      assert.ok(view.getByRole("button", { name: "Activar avisos" })),
    );
    const before = requests.filter((r) => r.path === "/push/devices").length;
    await act(async () =>
      lateRegistration({ value: "late-old-account-token-xxxxxxxxxx" }),
    );
    assert.equal(
      requests.filter((r) => r.path === "/push/devices").length,
      before,
    );
    assert.equal(permissionRequests, 1);
    fireEvent.click(view.getByRole("button", { name: "Activar avisos" }));
    await waitFor(() =>
      assert.ok(view.getByRole("button", { name: "Desactivar avisos" })),
    );
    fireEvent.click(view.getByRole("button", { name: "Desactivar avisos" }));
    await waitFor(() =>
      assert.ok(view.getByRole("button", { name: "Activar avisos" })),
    );
    assert.equal(unregistered, 1);
    assert.equal(
      requests.filter((r) => r.path === "/push/devices/unregister").at(-1)
        .owner,
      "account-b",
    );
  } finally {
    cleanup();
    auth.request = previous;
    auth.current = oldSession;
    dom.window.close();
  }
});
