import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
test("Crédito: una respuesta perdida conserva solicitud y clave por usuario; otro crédito no la reemplaza", async () => {
  const dom = new JSDOM("", { url: "http://localhost" });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    localStorage: dom.window.localStorage,
  });
  const { auth } = await import("../apps/web/src/session.js");
  const { creditMutation } = await import("../apps/web/src/credit.js");
  const original = auth.request,
    calls: any[] = [];
  let lost = true;
  auth.request = async (path, init, owner) => {
    calls.push({
      path,
      body: init?.body,
      key: (init?.headers as any)["Idempotency-Key"],
      owner,
    });
    if (lost) throw Error("network lost");
    return Response.json({ id: "saved" }, { status: 201 });
  };
  try {
    const body = {
      clientId: crypto.randomUUID(),
      lines: [
        { productId: crypto.randomUUID(), quantity: 1, expectedPriceCop: 1000 },
      ],
    };
    await assert.rejects(creditMutation("seller-a", "/credit/sales", body));
    await assert.rejects(
      creditMutation("seller-a", "/credit/sales", {
        ...body,
        clientId: crypto.randomUUID(),
      }),
      /sin confirmar/,
    );
    assert.equal(calls.length, 1);
    lost = false;
    await creditMutation("seller-b", "/credit/sales", body);
    assert.notEqual(calls[0].key, calls[1].key);
    await creditMutation(
      "seller-a",
      "/credit/sales",
      JSON.parse(calls[0].body),
    );
    assert.equal(calls[0].key, calls[2].key);
    assert.equal(calls[0].body, calls[2].body);
    assert.equal(localStorage.getItem("playita-credit-attempt:seller-a"), null);
  } finally {
    auth.request = original;
    dom.window.close();
  }
});
test("Canasta: pago más abono muestra reparto y confirma una sola solicitud", async () => {
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
    { render, fireEvent, waitFor, cleanup } =
      await import("@testing-library/react"),
    { auth } = await import("../apps/web/src/session.js"),
    { Checkout } = await import("../apps/web/src/credit.js");
  const original = auth.request,
    requests: any[] = [];
  let saved = false;
  const clientId = crypto.randomUUID();
  auth.request = async (path, init) => {
    if (!init?.method)
      return Response.json([
        {
          id: clientId,
          name: "cliente@example.invalid",
          active: true,
          balanceCop: 5000,
        },
      ]);
    requests.push({ path, body: JSON.parse(String(init.body)) });
    return Response.json({ id: "sale" }, { status: 201 });
  };
  try {
    const view = render(
      React.createElement(Checkout, {
        owner: "seller-test",
        lines: [
          {
            productId: crypto.randomUUID(),
            quantity: 1,
            expectedPriceCop: 7000,
          },
        ],
        total: 7000,
        onBusy: () => {},
        onSaved: () => {
          saved = true;
        },
      }),
    );
    await waitFor(() =>
      assert.ok(view.getByRole("option", { name: "cliente@example.invalid" })),
    );
    fireEvent.click(view.getByRole("button", { name: "Pago + abono" }));
    fireEvent.change(view.getByRole("combobox"), {
      target: { value: clientId },
    });
    fireEvent.change(view.getByLabelText("Efectivo recibido (COP)"), {
      target: { value: "10000" },
    });
    assert.ok(view.getByText(/Saldo restante/).textContent?.includes("2.000"));
    fireEvent.click(view.getByRole("button", { name: /Cobrar y abonar/ }));
    await waitFor(() => assert.equal(saved, true));
    assert.equal(requests.length, 1);
    assert.equal(requests[0].path, "/credit/checkout");
    assert.equal(requests[0].body.abonoCop, 3000);
    assert.equal(requests[0].body.cashReceived, 10000);
    assert.equal(requests[0].body.clientId, clientId);
  } finally {
    cleanup();
    auth.request = original;
    dom.window.close();
  }
});
