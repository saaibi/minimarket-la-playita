import test from "node:test";
import assert from "node:assert/strict";
import { NodeSqliteDriver } from "./sqlite-driver.js";
import { Outbox, SQLITE_SCHEMA } from "../packages/mobile/src/outbox.js";
class NativeStatementDriver extends NodeSqliteDriver {
  executed: string[] = [];
  failPos = false;
  override async execute(sql: string) {
    // Model Android execSQL's single-statement boundary; a batch is not portable.
    assert.equal(
      sql.includes(";"),
      false,
      "native schema must execute one statement per call",
    );
    this.executed.push(sql);
    if (
      this.failPos &&
      sql.startsWith("CREATE TABLE IF NOT EXISTS pos_attempts")
    )
      throw Error("injected DDL failure");
    return super.execute(sql);
  }
}
function seedLegacy(db: NativeStatementDriver) {
  db.db.exec(SQLITE_SCHEMA.split(";\n")[0]!);
  db.db.exec("PRAGMA user_version=1");
  db.db
    .prepare(
      "INSERT INTO outbox(request_key,owner_id,payload,status,created_at) VALUES(?,?,?,'pending_sync',?)",
    )
    .run("legacy-key", "owner-a", "{}", 1);
}
test("Android SQLite: reparar catálogo/POS ausentes en versión 1, conservando pendientes y aislamiento", async () => {
  const db = new NativeStatementDriver(":memory:");
  try {
    seedLegacy(db);
    assert.throws(
      () => db.db.prepare("SELECT * FROM catalog_cache").all(),
      /no such table/,
    );
    assert.throws(
      () => db.db.prepare("SELECT * FROM pos_attempts").all(),
      /no such table/,
    );
    const a = new Outbox(db, "owner-a"),
      b = new Outbox(db, "owner-b");
    await a.init();
    await b.init();
    assert.equal((await a.list())[0]!.request_key, "legacy-key");
    assert.equal((await b.list()).length, 0);
    await a.saveCatalog([{ name: "Private owner-a" }]);
    assert.deepEqual((await a.catalog())!.data, [{ name: "Private owner-a" }]);
    assert.equal(await b.catalog(), null);
    const draft = {
      paymentMethod: "cash" as const,
      cashReceived: 1000,
      lines: [
        {
          productId: "11111111-1111-4111-8111-111111111111",
          quantity: 1,
          expectedPriceCop: 650,
        },
      ],
    };
    const key = await a.prepareSale(draft);
    assert.equal((await a.pendingSale())!.request_key, key);
    assert.equal(await b.pendingSale(), null);
    await a.init();
    assert.equal((await a.pendingSale())!.request_key, key);
    assert.equal((await a.list())[0]!.request_key, "legacy-key");
    assert.ok(db.executed.includes("BEGIN IMMEDIATE"));
    assert.ok(db.executed.includes("COMMIT"));
  } finally {
    db.close();
  }
});
test("reparación SQLite: fallo revierte DDL; versión futura conserva la base", async () => {
  const db = new NativeStatementDriver(":memory:");
  try {
    seedLegacy(db);
    db.failPos = true;
    const box = new Outbox(db, "owner-a");
    await assert.rejects(box.init(), /injected DDL/);
    assert.equal((await box.list())[0]!.request_key, "legacy-key");
    assert.throws(
      () => db.db.prepare("SELECT * FROM catalog_cache").all(),
      /no such table/,
    );
    db.failPos = false;
    await box.init();
    db.db.exec("PRAGMA user_version=2");
    await assert.rejects(box.init(), /futura/);
    assert.equal((await box.list())[0]!.request_key, "legacy-key");
  } finally {
    db.close();
  }
});
