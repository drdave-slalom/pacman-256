import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeUnitId } from "./path.ts";

test("decodeUnitId decodes valid unit ids", () => {
  assert.equal(decodeUnitId("T10-execute"), "T10-execute");
  assert.equal(decodeUnitId("A%20B"), "A B");
});

test("decodeUnitId returns null for malformed percent-encoding", () => {
  assert.equal(decodeUnitId("%zz"), null);
  assert.equal(decodeUnitId("%"), null);
});
