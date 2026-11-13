import test from "node:test";
import assert from "node:assert/strict";
import { type Product, grams } from "@playita/shared";
import {
  remainingStock,
  assertCartAddition,
} from "../apps/web/src/cart-stock.js";
const product: Product = {
  id: "eggs",
  name: "Huevos",
  kind: "unit",
  priceCop: 650,
  stock: 38,
  reserved: 8,
  available: 30,
  version: 1,
  presentations: [
    { id: "one", name: "Unidad", factor: 1, priceCop: 650 },
    { id: "half", name: "Medio cartón", factor: 15, priceCop: 9000 },
    { id: "box", name: "Cartón", factor: 30, priceCop: 17000 },
  ],
};
const line = (quantity: number, presentationId = "one") => ({
  productId: product.id,
  presentationId,
  quantity,
  expectedPriceCop: 650,
});
test("Canasta: suma unidades entre presentaciones, descuenta reservas y bloquea adiciones repetidas", () => {
  const cart = [line(1, "half"), line(14)];
  assert.equal(remainingStock(product, cart), 1);
  assert.throws(
    () => assertCartAddition(product, cart, line(1, "half")),
    /Solo quedan 1/,
  );
  assert.throws(
    () => assertCartAddition(product, cart, line(2)),
    /Solo quedan 1/,
  );
  assertCartAddition(product, cart, line(1));
  cart.push(line(1));
  assert.equal(remainingStock(product, cart), 0);
  assert.throws(
    () => assertCartAddition(product, cart, line(1)),
    /Solo quedan 0/,
  );
  assert.equal(remainingStock(product, cart.slice(0, 1)), 15);
  assert.equal(remainingStock({ ...product, available: 20 }, cart), 0);
  assert.throws(() => assertCartAddition(product, [], line(1, "removed")));
});
test("Canasta: kilos y libras comparten disponibilidad en gramos", () => {
  const p = {
    ...product,
    id: "potato",
    kind: "weight" as const,
    stock: 1750,
    reserved: 0,
    available: 1750,
    presentations: [],
  };
  const kilo = {
    productId: p.id,
    quantity: grams(1, "kg"),
    expectedPriceCop: 4000,
  };
  const pound = {
    productId: p.id,
    quantity: grams(1, "lb"),
    expectedPriceCop: 4000,
  };
  const cart = [kilo, pound];
  assert.equal(remainingStock(p, cart), 250);
  assert.throws(() => assertCartAddition(p, cart, pound), /250 g/);
  assertCartAddition(p, cart, { ...kilo, quantity: 250 });
  assert.throws(() => assertCartAddition(p, cart, { ...kilo, quantity: 251 }));
});
test("Tarjeta real: rechaza cantidades mayores al remanente y desactiva Agregar al agotarlo", async () => {
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM("<html><body></body></html>", {
    url: "http://localhost",
  });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const React = await import("react");
  const { render, fireEvent, cleanup } = await import("@testing-library/react");
  const { ProductCard } = await import("../apps/web/src/shop.js");
  const added: unknown[] = [];
  try {
    const view = render(
      React.createElement(ProductCard, {
        p: product,
        remaining: 1,
        add: (line) => added.push(line),
      }),
    );
    fireEvent.change(view.getByLabelText("Cantidad"), {
      target: { value: "2" },
    });
    fireEvent.click(view.getByRole("button", { name: "+ Agregar" }));
    assert.equal(added.length, 0);
    assert.match(view.getByRole("alert").textContent || "", /Solo quedan 1/);
    fireEvent.change(view.getByLabelText("Cantidad"), {
      target: { value: "1" },
    });
    fireEvent.click(view.getByRole("button", { name: "+ Agregar" }));
    assert.equal(added.length, 1);
    view.rerender(
      React.createElement(ProductCard, {
        p: product,
        remaining: 0,
        add: (line) => added.push(line),
      }),
    );
    assert.equal(
      (view.getByRole("button", { name: "+ Agregar" }) as HTMLButtonElement)
        .disabled,
      true,
    );
  } finally {
    cleanup();
    dom.window.close();
  }
});
