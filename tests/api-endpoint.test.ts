import test from "node:test";
import assert from "node:assert/strict";
import { nativeApiUrl } from "../apps/web/src/api-endpoint.js";
test("native build requires HTTPS API without credentials or loopback", () => {
  for (const value of [
    "",
    "http://127.0.0.1:4300",
    "https://localhost",
    "https://[::1]",
    "https://user:secret@example.com",
    "https://example.com?token=secret",
  ])
    assert.equal(nativeApiUrl(value), "");
  assert.equal(
    nativeApiUrl("https://playita.example.com/"),
    "https://playita.example.com",
  );
});
