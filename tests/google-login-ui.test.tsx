import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
test("Google web: botón oficial directo, un clic y sin cuadro intermedio", async () => {
  const dom = new JSDOM("<html><head></head><body></body></html>", {
    url: "http://127.0.0.1:5173/",
  });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    sessionStorage: dom.window.sessionStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: dom.window.navigator,
  });
  const React = await import("react");
  const { render, fireEvent, waitFor, cleanup } =
    await import("@testing-library/react");
  const originalFetch = globalThis.fetch;
  let verified = 0,
    callback: (data: { credential: string }) => void = () => {},
    rendered = 0;
  globalThis.fetch = async (input, init) => {
    const path = String(input);
    if (path.endsWith("/auth/options"))
      return Response.json({
        google: {
          available: true,
          clientId: "test.apps.googleusercontent.com",
        },
      });
    if (path.endsWith("/auth/google/challenge"))
      return Response.json({
        challengeId: "test-id",
        nonce: "single-use-test-nonce",
        clientId: "test.apps.googleusercontent.com",
      });
    if (path.endsWith("/auth/google/verify")) {
      verified++;
      assert.equal(
        JSON.parse(String(init?.body)).credential,
        "synthetic-id-token",
      );
      return Response.json({
        actor: { id: "buyer-test", role: "buyer", label: "Test", guest: false },
        accessExpiresAt: Date.now() + 300000,
      });
    }
    throw Error("unexpected path");
  };
  (dom.window as any).google = {
    accounts: {
      id: {
        initialize: (options: any) => {
          assert.equal(options.nonce, "single-use-test-nonce");
          callback = options.callback;
        },
        renderButton: (element: HTMLElement, options: any) => {
          rendered++;
          assert.equal(options.type, "icon");
          const button = document.createElement("button");
          button.setAttribute("aria-label", "Acceder con Google");
          button.onclick = () => callback({ credential: "synthetic-id-token" });
          element.append(button);
        },
      },
    },
  };
  const append = document.head.append.bind(document.head);
  document.head.append = (...nodes: any[]) => {
    append(...nodes);
    for (const node of nodes)
      if (node instanceof dom.window.HTMLScriptElement)
        queueMicrotask(() => node.dispatchEvent(new dom.window.Event("load")));
  };
  try {
    const { GoogleLogin } = await import("../apps/web/src/google-login.js");
    const busy: boolean[] = [];
    const view = render(
      <GoogleLogin disabled={false} onBusy={(v) => busy.push(v)} />,
    );
    await waitFor(() => assert.equal(rendered, 1));
    assert.equal(view.queryByRole("dialog"), null);
    assert.equal(view.queryByText(/Elige tu cuenta/), null);
    fireEvent.click(view.getByRole("button", { name: "Acceder con Google" }));
    await waitFor(() => assert.equal(verified, 1));
    assert.ok(busy.includes(true));
    assert.equal(view.queryByRole("dialog"), null);
  } finally {
    cleanup();
    globalThis.fetch = originalFetch;
    dom.window.close();
  }
});
