import test from "node:test";
import assert from "node:assert/strict";
import { databaseOptions } from "../apps/api/src/database-options.js";
test("database TLS never disables validation on a public host", () => {
  const previous = process.env.DATABASE_TLS_MODE;
  try {
    delete process.env.DATABASE_TLS_MODE;
    assert.equal(databaseOptions("postgres://u:p@127.0.0.1/db").ssl, false);
    assert.deepEqual(databaseOptions("postgres://u:p@public.example/db").ssl, {
      rejectUnauthorized: true,
    });
    assert.throws(() =>
      databaseOptions("postgres://u:p@public.example/db?sslmode=require"),
    );
    process.env.DATABASE_TLS_MODE = "render-internal";
    assert.deepEqual(databaseOptions("postgres://u:p@dpg-example-a/db").ssl, {
      rejectUnauthorized: false,
    });
    assert.throws(() =>
      databaseOptions("postgres://u:p@dpg-example-a.render.com/db"),
    );
    process.env.DATABASE_TLS_MODE = "local";
    assert.throws(() => databaseOptions("postgres://u:p@public.example/db"));
  } finally {
    if (previous === undefined) delete process.env.DATABASE_TLS_MODE;
    else process.env.DATABASE_TLS_MODE = previous;
  }
});
