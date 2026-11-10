import test from "node:test";
import assert from "node:assert/strict";
import {
  scheduleSchema,
  isStoreOpen,
  bogotaDate,
  productWriteSchema,
} from "@playita/shared";
import { Outbox } from "../packages/mobile/src/outbox.js";
import { NodeSqliteDriver } from "./sqlite-driver.js";
test("horarios Bogotá, modo manual y ventana nocturna y presentación base requerida", () => {
  const schedule = scheduleSchema.parse({
    days: Array.from({ length: 7 }, () => ({
      closed: false,
      open: "06:00",
      close: "21:00",
    })),
    override: "closed",
    overrideDate: "2026-11-09",
    version: 0,
  });
  assert.equal(isStoreOpen(schedule, new Date("2026-11-10T02:00:00Z")), false);
  assert.equal(bogotaDate(new Date("2026-11-10T04:59:00Z")), "2026-11-09");
  assert.equal(isStoreOpen(schedule, new Date("2026-11-10T12:00:00Z")), false);
  assert.equal(
    productWriteSchema.safeParse({
      name: "Huevos",
      kind: "unit",
      priceCop: 100,
      costCop: 1,
      minimum: 1,
      visible: true,
      presentations: [{ name: "Cartón", factor: 30, priceCop: 2000 }],
    }).success,
    false,
  );
});
test("POS durable: mismo intento tras reinicio, aislado por actor y sin modificar canasta pendiente", async () => {
  const db = new NodeSqliteDriver(":memory:"),
    box = new Outbox(db, "seller-a");
  await box.init();
  const draft = {
    lines: [
      {
        productId: "11111111-1111-4111-8111-111111111111",
        quantity: 1,
        expectedPriceCop: 100,
      },
    ],
    paymentMethod: "cash" as const,
    cashReceived: 100,
  };
  const key = await box.prepareSale(draft);
  assert.equal(await box.prepareSale(draft), key);
  assert.equal(
    (await new Outbox(db, "seller-a").pendingSale())?.request_key,
    key,
  );
  assert.equal(await new Outbox(db, "seller-b").pendingSale(), null);
  await assert.rejects(
    box.prepareSale({ ...draft, lines: [{ ...draft.lines[0]!, quantity: 2 }] }),
  );
  await box.finishSale(key, { id: "receipt" });
  assert.equal(await box.pendingSale(), null);
  db.close();
});
