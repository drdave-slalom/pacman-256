import test from "node:test";
import assert from "node:assert/strict";
import { charWidth, truncateToWidth, visibleWidth } from "./width.ts";

test("visibleWidth counts wide characters as 2 columns", () => {
  assert.equal(visibleWidth("abc"), 3);
  assert.equal(visibleWidth("中文"), 4);
  assert.equal(visibleWidth("a中b"), 4);
});

test("truncateToWidth respects visible width, not string length", () => {
  assert.equal(truncateToWidth("abcdef", 3), "abc");
  assert.equal(truncateToWidth("a中文", 3), "a中");
  assert.equal(truncateToWidth("abc", 0), "");
  assert.equal(truncateToWidth("abc", 100), "abc");
});

test("charWidth treats control characters as zero width", () => {
  assert.equal(charWidth("\u0000"), 0);
  assert.equal(charWidth("\u001b"), 0);
});
