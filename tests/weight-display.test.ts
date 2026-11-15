import test from "node:test";
import assert from "node:assert/strict";
import {
  stockLabel,
  weightFactor,
  grams,
} from "../packages/shared/src/index.js";
test("La medida visible convierte existencias y mínimos sin cambiar gramos ni importes guardados", () => {
  assert.equal(
    stockLabel({ kind: "weight", weightUnit: "lb" }, 1500),
    "3 libras",
  );
  assert.equal(
    stockLabel({ kind: "weight", weightUnit: "kg" }, 1500),
    "1,5 kilos",
  );
  assert.equal(stockLabel({ kind: "weight" }, 1000), "1 kilo");
  assert.equal(stockLabel({ kind: "unit" }, 15), "15 unidades");
  assert.equal(stockLabel({ kind: "unit" }, 1), "1 unidad");
  assert.equal(grams(1.005, "kg"), 1005);
  assert.throws(() => grams(0.0001, "kg"));
  for (const unit of ["kg", "lb"] as const) {
    assert.equal(weightFactor(unit), grams(1, unit));
    assert.equal(grams(3, unit) / weightFactor(unit), 3);
  }
});
