import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
test("Pedido a proveedor: filtro, validación, compartir y cancelar sin modificar existencias", async () => {
  const dom = new JSDOM("<html><body></body></html>", {
    url: "http://localhost/",
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
  let sent: any,
    cancel = false;
  Object.defineProperty(dom.window.navigator, "share", {
    configurable: true,
    value: async (data: any) => {
      if (cancel) throw Error("cancelled");
      sent = data;
    },
  });
  const React = await import("react");
  const { render, fireEvent, waitFor, cleanup } =
    await import("@testing-library/react");
  const { ReplenishmentOrder } =
    await import("../apps/web/src/replenishment-order.js");
  const products = [
    {
      id: "one",
      name: "Huevos",
      kind: "unit",
      supplier: "Proveedor A",
      available: 0,
      minimum: 3,
      stock: 0,
      reserved: 0,
      priceCop: 650,
      presentations: [],
    },
    {
      id: "two",
      name: "Papa",
      kind: "weight",
      weightUnit: "lb",
      supplier: "Proveedor B",
      available: 500,
      minimum: 1000,
      stock: 500,
      reserved: 0,
      priceCop: 4000,
      presentations: [],
    },
    {
      id: "three",
      name: "Suficiente",
      kind: "unit",
      supplier: "Proveedor A",
      available: 10,
      minimum: 3,
      stock: 10,
      reserved: 0,
      priceCop: 1000,
      presentations: [],
    },
  ];
  const before = JSON.stringify(products);
  try {
    const view = render(
      <ReplenishmentOrder
        products={products as any}
        initialSupplier="Proveedor A"
        close={() => {}}
      />,
    );
    assert.equal(view.queryByText("Papa"), null);
    assert.equal(view.queryByText("Suficiente"), null);
    const share = view.getByRole("button", {
      name: "Compartir pedido",
    }) as HTMLButtonElement;
    assert.equal(share.disabled, true);
    fireEvent.change(view.getByLabelText("Cantidad a pedir de Huevos"), {
      target: { value: "12" },
    });
    assert.equal(share.disabled, false);
    fireEvent.click(share);
    await waitFor(() => assert.match(sent.text, /Huevos: 12 unidades/));
    assert.equal(sent.text.includes("Papa"), false);
    cancel = true;
    fireEvent.click(share);
    await waitFor(() => assert.ok(view.getByText(/No se compartió el pedido/)));
    assert.equal(JSON.stringify(products), before);
  } finally {
    cleanup();
    dom.window.close();
  }
});

test("Acciones flotantes: arrastrar no abre el menú y la posición se conserva", async () => {
  const dom = new JSDOM("<html><body></body></html>", {
    url: "http://localhost/",
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
  class Pointer extends dom.window.MouseEvent {
    pointerId: number;
    constructor(type: string, init: any) {
      super(type, init);
      this.pointerId = init.pointerId;
    }
  }
  (dom.window as any).PointerEvent = Pointer;
  const React = await import("react");
  const { render, fireEvent, cleanup } = await import("@testing-library/react");
  const { InventoryActions, clampActionPosition } =
    await import("../apps/web/src/inventory-actions.js");
  try {
    assert.deepEqual(clampActionPosition({ x: -100, y: 10000 }, 390, 844), {
      x: 12,
      y: 680,
    });
    let newProducts = 0;
    const view = render(
      <InventoryActions
        onNew={() => newProducts++}
        onOrder={() => {}}
        hidden={false}
      />,
    );
    const button = view.getByRole("button", { name: "Acciones de inventario" });
    fireEvent.pointerDown(button, {
      pointerId: 1,
      button: 0,
      clientX: 950,
      clientY: 600,
    });
    fireEvent.pointerMove(button, { pointerId: 1, clientX: 150, clientY: 250 });
    fireEvent.pointerUp(button, { pointerId: 1, clientX: 150, clientY: 250 });
    fireEvent.click(button, { detail: 1 });
    assert.equal(
      view.queryByRole("group", { name: "Opciones de inventario" }),
      null,
    );
    const stored = JSON.parse(
      dom.window.localStorage.getItem("playita.inventory.actions.position")!,
    );
    assert.ok(stored.x >= 12 && stored.x < 400);
    cleanup();
    const again = render(
      <InventoryActions
        onNew={() => newProducts++}
        onOrder={() => {}}
        hidden={false}
      />,
    );
    assert.equal(
      (again.container.firstElementChild as HTMLElement).style.left,
      stored.x + "px",
    );
    fireEvent.click(
      again.getByRole("button", { name: "Acciones de inventario" }),
    );
    fireEvent.click(again.getByRole("button", { name: "Nuevo producto" }));
    assert.equal(newProducts, 1);
  } finally {
    cleanup();
    dom.window.close();
  }
});
