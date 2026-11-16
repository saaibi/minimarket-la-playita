import test from "node:test";
import assert from "node:assert/strict";
import type { Product } from "@playita/shared";
import {
  needsReplenishment,
  validOrderQuantity,
  replenishmentText,
  purchaseOptions,
} from "../apps/web/src/replenishment.js";
const base = {
  id: "one",
  name: "Huevos",
  kind: "unit",
  supplier: "Proveedor A",
  stock: 20,
  reserved: 18,
  available: 2,
  minimum: 3,
  priceCop: 650,
  version: 1,
  presentations: [],
} as Product;
test("Reposición: disponibilidad reservada, cantidades por medida y agrupación sin precios de venta", () => {
  assert.equal(needsReplenishment(base), true);
  assert.equal(needsReplenishment({ ...base, available: 0, minimum: 0 }), true);
  assert.equal(needsReplenishment({ ...base, available: 4 }), false);
  for (const q of ["", "0", "-1", "1.5", "NaN", "Infinity"])
    assert.equal(validOrderQuantity(base, q), false);
  assert.equal(validOrderQuantity(base, "12"), true);
  const lb = {
    ...base,
    id: "two",
    name: "Papa",
    kind: "weight",
    weightUnit: "lb",
    supplier: "Proveedor B",
    available: 1500,
  } as Product;
  assert.equal(validOrderQuantity(lb, "1.5"), true);
  assert.equal(validOrderQuantity(lb, "0.001"), false);
  assert.equal(validOrderQuantity({ ...lb, weightUnit: "kg" }, "0.001"), true);
  const text = replenishmentText([
    { product: base, quantity: "12" },
    { product: lb, quantity: "1.5" },
  ]);
  assert.match(text, /Proveedor: Proveedor A/);
  assert.match(text, /Proveedor: Proveedor B/);
  assert.match(text, /Huevos: 12 unidades/);
  assert.match(text, /Papa: 1,5 libras/);
  const packaged = { ...base, purchasePresentation: "tira de 24 unidades" };
  const several = {
    ...packaged,
    presentations: [
      { id: "box", name: "Caja", factor: 12, priceCop: 6500 },
      { id: "tray", name: "Bandeja", factor: 30, priceCop: 15000 },
    ],
  };
  assert.deepEqual(
    purchaseOptions(several).map((o) => o.id),
    ["purchase", "unit", "presentation:box", "presentation:tray"],
  );
  assert.match(
    replenishmentText([
      { product: several, quantity: "5", presentation: "unit" },
    ]),
    /Huevos: 5 unidades/,
  );
  assert.match(
    replenishmentText([
      { product: several, quantity: "2", presentation: "presentation:box" },
    ]),
    /2 × Caja \(12 unidades\)/,
  );
  assert.throws(
    () =>
      replenishmentText([
        { product: several, quantity: "1", presentation: "missing" },
      ]),
    /INVALID_QUANTITY/,
  );

  assert.equal(validOrderQuantity(packaged, "1.5"), false);
  const namedText = replenishmentText([
    { product: packaged, quantity: "2" },
    { product: { ...lb, purchasePresentation: "arroba" }, quantity: "1" },
  ]);
  assert.match(namedText, /2 × tira de 24 unidades/);
  assert.match(namedText, /1 × arroba/);
  assert.equal(text.includes("Quedan"), false);
  assert.equal(text.includes("650"), false);
  assert.throws(
    () => replenishmentText([{ product: base, quantity: "" }]),
    /INVALID_QUANTITY/,
  );
});
