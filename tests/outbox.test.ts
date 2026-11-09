import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Outbox, Synchronizer } from "../packages/mobile/src/outbox.js";
import { NodeSqliteDriver } from "./sqlite-driver.js";
import {
  baseQuantity,
  lineTotal,
  grams,
  orderDraftSchema,
  canonical,
  type OrderDraft,
} from "../packages/shared/src/index.js";
export const draft: OrderDraft = {
  paymentMethod: "cash",
  lines: [
    {
      productId: "11111111-1111-4111-8111-111111111111",
      presentationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
      quantity: 1,
      expectedPriceCop: 9000,
    },
  ],
};
test("SQLite real: pedido offline durable sobrevive cierre/reapertura, sin confirmación", async () => {
  const dir = await mkdtemp(join(tmpdir(), "playita-"));
  try {
    let db = new NodeSqliteDriver(join(dir, "orders.sqlite"));
    let box = new Outbox(db, "buyer-a");
    await box.init();
    const key = await box.enqueue(draft);
    db.close();
    db = new NodeSqliteDriver(join(dir, "orders.sqlite"));
    box = new Outbox(db, "buyer-a");
    await box.init();
    const rows = await box.list();
    assert.equal(rows[0]!.request_key, key);
    assert.equal(rows[0]!.status, "pending_sync");
    assert.deepEqual(JSON.parse(rows[0]!.payload), draft);
    assert.equal(rows[0]!.response, null);
    db.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("SQLite real: reintento de red conserva misma clave y respeta backoff", async () => {
  const db = new NodeSqliteDriver(":memory:"),
    box = new Outbox(db, "a");
  await box.init();
  const key = await box.enqueue(draft, crypto.randomUUID(), 0);
  let time = 0,
    calls = 0;
  const keys: string[] = [];
  const worker = new Synchronizer(
    box,
    async (k) => {
      keys.push(k);
      calls++;
      if (calls === 1) throw Error("offline");
      return { status: 201, body: { id: "server-order" } };
    },
    () => time,
    () => 0,
  );
  await worker.sync();
  let row = (await box.list())[0]!;
  assert.equal(row.status, "pending_sync");
  assert.equal(row.attempts, 1);
  assert.equal(row.next_attempt_at, 2000);
  await worker.sync();
  assert.equal(calls, 1);
  time = 2001;
  await worker.sync();
  row = (await box.list())[0]!;
  assert.equal(row.status, "synced");
  assert.deepEqual(keys, [key, key]);
  assert.equal(row.attempts, 2);
  db.close();
});
test("SQLite real: crash tras respuesta antes de ack recupera lease y clave, transporte de prueba idempotente", async () => {
  const db = new NodeSqliteDriver(":memory:"),
    box = new Outbox(db, "a");
  await box.init();
  const key = await box.enqueue(draft, crypto.randomUUID(), 0),
    row = (await box.claim(0))!;
  const fakeServer = new Map<string, string>();
  const transport = async (k: string) => {
    if (!fakeServer.has(k)) fakeServer.set(k, crypto.randomUUID());
    return { status: 201, body: { id: fakeServer.get(k) } };
  };
  await transport(row.request_key);
  assert.equal((await box.list())[0]!.status, "syncing");
  assert.equal(await box.claim(59999), null);
  const worker = new Synchronizer(box, transport, () => 60001);
  await worker.sync();
  assert.equal(fakeServer.size, 1);
  assert.equal((await box.list())[0]!.request_key, key);
  assert.equal((await box.list())[0]!.status, "synced");
  db.close();
});
test("SQLite real: conflicto explícito, revisión crea clave distinta y no pierde original", async () => {
  const db = new NodeSqliteDriver(":memory:"),
    box = new Outbox(db, "a");
  await box.init();
  const key = await box.enqueue(draft);
  await new Synchronizer(box, async () => ({
    status: 409,
    body: { code: "PRICE_CHANGED", details: { currentPriceCop: 9500 } },
  })).sync();
  let rows = await box.list();
  assert.equal(rows[0]!.status, "conflict");
  assert.equal(JSON.parse(rows[0]!.payload).lines[0].expectedPriceCop, 9000);
  const revised = structuredClone(draft);
  revised.lines[0]!.expectedPriceCop = 9500;
  const newKey = await box.revise(key, revised);
  rows = await box.list();
  assert.equal(rows.length, 2);
  assert.equal(rows.find((r) => r.request_key === key)!.resolved_by, newKey);
  assert.equal(
    rows.find((r) => r.request_key === newKey)!.status,
    "pending_sync",
  );
  await assert.rejects(box.revise(key, revised));
  db.close();
});
test("SQLite real: usuario aislado, 401 requiere revisión y catálogo no se cruza", async () => {
  const db = new NodeSqliteDriver(":memory:"),
    a = new Outbox(db, "a"),
    b = new Outbox(db, "b");
  await a.init();
  await a.enqueue(draft);
  await a.saveCatalog([{ costCop: 123 }]);
  assert.equal((await b.list()).length, 0);
  assert.equal(await b.claim(), null);
  assert.equal(await b.catalog(), null);
  await new Synchronizer(a, async () => ({
    status: 401,
    body: { code: "AUTH_REQUIRED" },
  })).sync();
  assert.equal((await a.list())[0]!.status, "pending_sync");
  db.close();
});
test("dominio: unidades 15/30, precios propios, gramos y contrato estricto", () => {
  assert.equal(baseQuantity("unit", 2, 15), 30);
  assert.equal(baseQuantity("unit", 1, 30), 30);
  assert.equal(lineTotal("unit", 1, 17000), 17000);
  assert.notEqual(17000, 650 * 30);
  assert.equal(grams(1, "lb"), 500);
  assert.equal(grams(2, "lb"), grams(1, "kg"));
  assert.equal(lineTotal("weight", 500, 4000), 2000);
  assert.throws(() => grams(0.0001, "kg"));
  assert.throws(() => baseQuantity("unit", 1.5, 15));
  assert.equal(
    orderDraftSchema.safeParse({ ...draft, paid: true }).success,
    false,
  );
  assert.equal(canonical({ b: 1, a: 2 }), canonical({ a: 2, b: 1 }));
});

test("SQLite real: autenticación vencida conserva clave y permite reintento tras reautenticar", async () => {
  const db = new NodeSqliteDriver(":memory:"),
    box = new Outbox(db, "account-a");
  await box.init();
  const key = await box.enqueue(draft, crypto.randomUUID(), 0),
    keys: string[] = [];
  let now = 0,
    valid = false;
  const worker = new Synchronizer(
    box,
    async (k) => {
      keys.push(k);
      return valid
        ? { status: 201, body: { id: "same-server-order" } }
        : { status: 401, body: { code: "AUTH_REQUIRED" } };
    },
    () => now,
  );
  await worker.sync();
  assert.equal((await box.list())[0]!.status, "pending_sync");
  assert.equal((await box.list())[0]!.request_key, key);
  valid = true;
  now = 30001;
  await worker.sync();
  assert.equal((await box.list())[0]!.status, "synced");
  assert.deepEqual(keys, [key, key]);
  db.close();
});
