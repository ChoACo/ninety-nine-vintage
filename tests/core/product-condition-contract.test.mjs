import assert from "node:assert/strict";
import test from "node:test";

import {
  formatConditionGrade,
  normalizeConditionGrade,
} from "../../src/lib/catalog/conditions.ts";

test("public product condition grades normalize the current and legacy contracts", () => {
  assert.equal(normalizeConditionGrade("S"), "S");
  assert.equal(normalizeConditionGrade(" a "), "A");
  assert.equal(normalizeConditionGrade("A+"), "A");
  assert.equal(normalizeConditionGrade("C"), "C");
});

test("missing or placeholder condition values stay hidden from customers", () => {
  for (const value of [null, undefined, "", "미입력", "unknown"]) {
    assert.equal(normalizeConditionGrade(value), null);
    assert.equal(formatConditionGrade(value), null);
  }
  assert.equal(formatConditionGrade("A"), "Grade A · 사용감 적음");
});
