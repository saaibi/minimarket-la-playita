import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { bootstrapFailureCodes } from "../apps/api/src/bootstrap-diagnostics.js";
test("bootstrap diagnostics identify invalid fields without disclosing their values", () => {
  const result = z
    .object({ email: z.email(), password: z.string().min(12).max(128) })
    .safeParse({ email: "private-invalid-email", password: "secret" });
  assert.equal(result.success, false);
  if (!result.success) {
    const codes = bootstrapFailureCodes(result.error);
    assert.deepEqual(codes, [
      "ADMIN_EMAIL_INVALID",
      "ADMIN_PASSWORD_TOO_SHORT",
    ]);
    assert.ok(!JSON.stringify(codes).includes("private-invalid-email"));
    assert.ok(!JSON.stringify(codes).includes("secret"));
  }
  const long = z
    .object({ password: z.string().max(128) })
    .safeParse({ password: "x".repeat(129) });
  if (!long.success)
    assert.deepEqual(bootstrapFailureCodes(long.error), [
      "ADMIN_PASSWORD_TOO_LONG",
    ]);
});
test("database failures are reduced to a fixed allowlist, never raw database diagnostics", () => {
  assert.deepEqual(
    bootstrapFailureCodes({
      code: "23505",
      detail: "secret-value",
      message: "secret",
    }),
    ["BOOTSTRAP_IDENTITY_CONFLICT"],
  );
  assert.deepEqual(bootstrapFailureCodes({ code: "42501" }), [
    "BOOTSTRAP_DB_PERMISSION_DENIED",
  ]);
  assert.deepEqual(bootstrapFailureCodes({ code: "42P01" }), [
    "BOOTSTRAP_SCHEMA_MISSING",
  ]);
  assert.deepEqual(bootstrapFailureCodes({ code: "28P01" }), [
    "BOOTSTRAP_DB_AUTH_FAILED",
  ]);
  assert.deepEqual(bootstrapFailureCodes(new Error("secret-value")), [
    "BOOTSTRAP_UNKNOWN_FAILURE",
  ]);
});
