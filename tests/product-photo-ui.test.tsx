import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
test("Foto de producto: archivo/cámara, permiso denegado y cancelar libera cámara sin cambiar foto", async () => {
  const dom = new JSDOM("<html><body></body></html>", {
    url: "http://127.0.0.1:5173/",
  });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: dom.window.navigator,
  });
  let stopped = 0,
    fail = true,
    calls = 0;
  Object.defineProperty(dom.window.navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: async (options: unknown) => {
        calls++;
        assert.deepEqual(options, {
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (fail)
          throw Object.assign(Error("denied"), { name: "NotAllowedError" });
        return { getTracks: () => [{ stop: () => stopped++ }] };
      },
    },
  });
  dom.window.HTMLMediaElement.prototype.play = async () => {};
  const React = await import("react");
  const { render, fireEvent, waitFor, cleanup } =
    await import("@testing-library/react");
  try {
    const { ProductPhoto, compressProductPhoto } =
      await import("../apps/web/src/product-photo.js");
    const changes: string[] = [];
    const busy: boolean[] = [];
    const view = render(
      <ProductPhoto
        photo=""
        onChange={(v) => changes.push(v)}
        onBusy={(v) => busy.push(v)}
      />,
    );
    assert.ok(view.getByRole("button", { name: "Cargar archivo" }));
    assert.equal(calls, 0);
    fireEvent.click(view.getByRole("button", { name: "Tomar foto" }));
    await waitFor(() =>
      assert.match(view.getByRole("alert").textContent!, /Permite el acceso/),
    );
    assert.deepEqual(changes, []);
    assert.equal(busy.at(-1), false);
    fail = false;
    fireEvent.click(view.getByRole("button", { name: "Tomar foto" }));
    await waitFor(() => assert.equal(calls, 2));
    fireEvent.click(view.getByRole("button", { name: "Cancelar cámara" }));
    await waitFor(() => assert.equal(stopped, 1));
    assert.deepEqual(changes, []);
    assert.equal(busy.at(-1), false);
    fireEvent.click(view.getByRole("button", { name: "Tomar foto" }));
    await waitFor(() => assert.equal(calls, 3));
    cleanup();
    assert.equal(stopped, 2);
    await assert.rejects(
      compressProductPhoto(new Blob(["<svg/>"], { type: "image/svg+xml" })),
      /JPG/,
    );
    await assert.rejects(
      compressProductPhoto(
        new Blob([new Uint8Array(20000001)], { type: "image/jpeg" }),
      ),
      /20 MB/,
    );
  } finally {
    cleanup();
    dom.window.close();
  }
});
