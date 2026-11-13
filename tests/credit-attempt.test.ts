import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
test("Crédito: una respuesta perdida conserva solicitud y clave por usuario; otro crédito no la reemplaza", async () => {
  const dom = new JSDOM("", { url: "http://localhost" });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    Element: dom.window.Element,
    ShadowRoot: dom.window.ShadowRoot,
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
    Element: dom.window.Element,
    ShadowRoot: dom.window.ShadowRoot,
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
          creditEnabled: true,
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
      assert.equal(
        (view.getByRole("combobox") as HTMLInputElement).disabled,
        false,
      ),
    );

    fireEvent.mouseDown(view.getByRole("combobox"));
    await waitFor(() =>
      assert.ok(view.getByRole("option", { name: /cliente@example.invalid/ })),
    );
    fireEvent.click(
      view.getByRole("option", { name: /cliente@example.invalid/ }),
    );
    const clientInput = view.getByRole("combobox") as HTMLInputElement;
    assert.notEqual(document.activeElement, clientInput);
    assert.equal(clientInput.value, "cliente@example.invalid");
    fireEvent.click(view.getByRole("button", { name: "Borrar cliente" }));
    assert.equal(clientInput.value, "");
    assert.equal(view.queryByText("Saldo después de confirmar:"), null);
    fireEvent.mouseDown(clientInput);
    fireEvent.click(
      await view.findByRole("option", { name: /cliente@example.invalid/ }),
    );
    clientInput.focus();
    fireEvent.change(clientInput, { target: { value: "cliente" } });
    assert.equal(clientInput.value, "cliente");
    fireEvent.change(clientInput, { target: { value: "" } });
    assert.equal(clientInput.value, "");
    fireEvent.change(clientInput, { target: { value: "cliente" } });
    fireEvent.click(
      await view.findByRole("option", { name: /cliente@example.invalid/ }),
    );
    assert.notEqual(document.activeElement, clientInput);
    fireEvent.change(view.getByLabelText("Efectivo recibido (COP)"), {
      target: { value: "10000" },
    });
    assert.ok(
      view
        .getByText(/Saldo después de confirmar/)
        .textContent?.includes("2.000"),
    );
    fireEvent.click(view.getByRole("button", { name: /Cobrar y abonar/ }));
    await waitFor(() => assert.equal(saved, true));
    assert.equal(requests.length, 1);
    assert.equal(requests[0].path, "/credit/checkout");
    assert.equal(requests[0].body.mode, "auto");
    assert.equal(requests[0].body.expectedBalanceCop, 5000);
    assert.equal(requests[0].body.cashReceived, 10000);
    assert.equal(requests[0].body.clientId, clientId);
  } finally {
    cleanup();
    auth.request = original;
    dom.window.close();
  }
});
test("Créditos: solo habilitados por defecto, búsqueda y deudas deshabilitadas accesibles", async () => {
  const dom = new JSDOM("<html><body></body></html>", {
    url: "http://localhost",
  });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    Element: dom.window.Element,
    ShadowRoot: dom.window.ShadowRoot,
    localStorage: dom.window.localStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const React = await import("react"),
    { render, fireEvent, waitFor, cleanup } =
      await import("@testing-library/react"),
    { auth } = await import("../apps/web/src/session.js"),
    { Credits } = await import("../apps/web/src/credit.js");
  const original = auth.request;
  let writes = 0;
  auth.request = async (_p, init) => {
    if (init?.method) writes++;
    return Response.json([
      {
        id: "a",
        name: "ana@example.invalid",
        creditEnabled: true,
        balanceCop: 0,
        chargedCop: 0,
        paidCop: 0,
      },
      {
        id: "b",
        name: "bruno@example.invalid",
        creditEnabled: true,
        balanceCop: 1000,
        chargedCop: 1000,
        paidCop: 0,
      },
      {
        id: "c",
        name: "carla@example.invalid",
        creditEnabled: false,
        balanceCop: 500,
        chargedCop: 500,
        paidCop: 0,
      },
    ]);
  };
  try {
    const view = render(
      React.createElement(Credits, {
        owner: "seller-filter",
        onChange: async () => {},
      }),
    );
    await waitFor(() =>
      assert.ok(view.getByRole("heading", { name: "ana@example.invalid" })),
    );
    assert.equal(
      view.queryByRole("heading", { name: "carla@example.invalid" }),
      null,
    );
    fireEvent.change(view.getByLabelText("Buscar cuenta"), {
      target: { value: "bruno" },
    });
    assert.equal(
      view.queryByRole("heading", { name: "ana@example.invalid" }),
      null,
    );
    assert.ok(view.getByRole("heading", { name: "bruno@example.invalid" }));
    fireEvent.change(view.getByLabelText("Buscar cuenta"), {
      target: { value: "" },
    });
    fireEvent.change(view.getByLabelText("Mostrar"), {
      target: { value: "pending" },
    });
    assert.ok(view.getByRole("heading", { name: "carla@example.invalid" }));
    assert.equal(writes, 0);
  } finally {
    cleanup();
    auth.request = original;
    dom.window.close();
  }
});
test("Contado: general y cuenta sin crédito muestran faltante o cambio sin abonar deuda", async () => {
  const dom = new JSDOM("<html><body></body></html>", {
    url: "http://localhost",
  });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    Element: dom.window.Element,
    ShadowRoot: dom.window.ShadowRoot,
    localStorage: dom.window.localStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const React = await import("react"),
    { render, fireEvent, waitFor, cleanup } =
      await import("@testing-library/react"),
    { auth } = await import("../apps/web/src/session.js"),
    { Checkout } = await import("../apps/web/src/credit.js");
  const original = auth.request,
    clientId = crypto.randomUUID();
  const writes: any[] = [];
  auth.request = async (_path, init) => {
    if (!init?.method)
      return Response.json([
        {
          id: clientId,
          name: "contado@example.invalid",
          active: true,
          creditEnabled: false,
          balanceCop: 5000,
        },
      ]);
    writes.push(JSON.parse(String(init.body)));
    return Response.json({ id: "paid" }, { status: 201 });
  };
  try {
    const view = render(
      React.createElement(Checkout, {
        owner: "cash-only-test",
        lines: [
          {
            productId: crypto.randomUUID(),
            quantity: 1,
            expectedPriceCop: 7000,
          },
        ],
        total: 7000,
        onBusy: () => {},
        onSaved: () => {},
      }),
    );
    await waitFor(() =>
      assert.equal(
        (view.getByRole("combobox") as HTMLInputElement).disabled,
        false,
      ),
    );
    fireEvent.change(view.getByLabelText("Efectivo recibido (COP)"), {
      target: { value: "5000" },
    });
    assert.ok(
      view.getByText(/^Faltan:/).parentElement?.classList.contains("shortage"),
    );
    assert.equal(
      (
        view.getByRole("button", {
          name: "Confirmar pago",
        }) as HTMLButtonElement
      ).disabled,
      true,
    );
    fireEvent.mouseDown(view.getByRole("combobox"));
    await waitFor(() =>
      assert.ok(view.getByRole("option", { name: /contado@example.invalid/ })),
    );
    fireEvent.click(
      view.getByRole("option", { name: /contado@example.invalid/ }),
    );
    fireEvent.change(view.getByLabelText("Efectivo recibido (COP)"), {
      target: { value: "10000" },
    });
    assert.ok(view.getByText(/^Cambio:/).textContent?.includes("3.000"));
    assert.ok(
      view.getByText(/^Cambio:/).parentElement?.classList.contains("change"),
    );
    assert.equal(view.queryByText(/^Nuevo crédito:/), null);
    assert.equal(view.queryByText(/^Abono a deuda anterior:/), null);
    fireEvent.click(view.getByRole("button", { name: "Confirmar pago" }));
    await waitFor(() => assert.equal(writes.length, 1));
    assert.equal(writes[0].expectedCreditEnabled, false);
  } finally {
    cleanup();
    auth.request = original;
    dom.window.close();
  }
});
