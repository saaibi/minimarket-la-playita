import test from "node:test";
import assert from "node:assert/strict";
import { SignJWT } from "jose";
import { authenticate } from "../apps/api/src/auth.js";
const secret = "test-only-auth-key-with-at-least-32-characters";
async function token(role: string, expires = "5m", key = secret) {
  return new SignJWT({ role })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("playita-local")
    .setAudience("playita-api")
    .setSubject("user-a")
    .setExpirationTime(expires)
    .sign(new TextEncoder().encode(key));
}
test("JWT verifica firma, emisor, audiencia, expiración y rol, no confía en selector cliente", async () => {
  assert.deepEqual(
    await authenticate("Bearer " + (await token("buyer")), secret),
    { id: "user-a", role: "buyer" },
  );
  await assert.rejects(authenticate(undefined, secret));
  await assert.rejects(
    authenticate(
      "Bearer " +
        (await token(
          "admin",
          "5m",
          "different-secret-key-with-at-least-32-characters",
        )),
      secret,
    ),
  );
  await assert.rejects(
    authenticate("Bearer " + (await token("buyer", "-1s")), secret),
  );
  await assert.rejects(
    authenticate("Bearer " + (await token("superadmin")), secret),
  );
});
