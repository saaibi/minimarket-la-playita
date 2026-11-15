import test from "node:test";
import assert from "node:assert/strict";
import { reportRange } from "../apps/api/src/analytics.js";
test("Informes rechazan fechas inexistentes, intervalos invertidos y rangos excesivos", () => {
  assert.deepEqual(reportRange("2026-11-01", "2026-11-15"), {
    from: "2026-11-01",
    to: "2026-11-15",
  });
  for (const args of [
    ["2026-02-30", "2026-03-01"],
    ["2026-11-15", "2026-11-01"],
    ["2024-01-01", "2026-01-01"],
    ["invalid", "2026-11-15"],
    [undefined, "2026-11-15"],
  ])
    assert.equal(reportRange(...(args as [unknown, unknown])), null);
});
