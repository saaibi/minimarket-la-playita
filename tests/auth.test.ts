import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "../apps/api/src/password.js";
test("contraseñas: scrypt con sal distinta, verificación y rechazo de formato inválido", async () => {
  const pass = "test-password-not-a-runtime-account",
    a = await hashPassword(pass),
    b = await hashPassword(pass);
  assert.notEqual(a, b);
  assert.equal(a.includes(pass), false);
  assert.ok(a.startsWith("scrypt$131072$8$1$"));
  assert.equal(await verifyPassword(pass, a), true);
  assert.equal(await verifyPassword("incorrect-password", a), false);
  assert.equal(await verifyPassword(pass, "invalid"), false);
});
