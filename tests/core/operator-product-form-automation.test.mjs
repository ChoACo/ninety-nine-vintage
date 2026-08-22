import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  getAvailablePublishSlots,
  parseBrandAndSizeFromTitle,
} from "../../src/lib/utils/productParser.ts";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("title parser infers canonical brand and size without visible inputs", () => {
  assert.deepEqual(parseBrandAndSizeFromTitle("나이키 ACG 바람막이 105"), {
    brand: "NIKE",
    size: "105",
  });
  assert.deepEqual(parseBrandAndSizeFromTitle("Stussy 후드 XL"), {
    brand: "STUSSY",
    size: "XL",
  });
});

test("publication helper exposes exactly seven future 10:00 KST slots", () => {
  const slots = getAvailablePublishSlots(new Date("2026-08-23T00:30:00.000Z"));
  assert.equal(slots.length, 7);
  assert.equal(slots[0].value, "2026-08-23T01:00:00.000Z");
  for (const slot of slots) {
    const kstHour = (new Date(slot.value).getUTCHours() + 9) % 24;
    assert.equal(kstHour, 10);
  }
});

test("single form is store-scoped, category-driven, and hides automated catalog fields", async () => {
  const [consoleSource, componentSource, route] = await Promise.all([
    source("src/components/admin/operator/OperatorProductsConsole.tsx"),
    source("src/components/admin/operator/GenderCategorySelect.tsx"),
    source("src/app/api/admin/operator/products/route.ts"),
  ]);

  assert.match(consoleSource, /value === "auction"/);
  assert.match(consoleSource, /value === "shop"/);
  assert.match(consoleSource, /<details className=/);
  assert.doesNotMatch(consoleSource, /<details[^>]*\sopen/);
  assert.doesNotMatch(consoleSource, /aria-label="브랜드"/);
  assert.doesNotMatch(consoleSource, /aria-label="사이즈"/);
  assert.doesNotMatch(consoleSource, /aria-label="컨디션 등급"/);
  assert.match(componentSource, /MALE:[\s\S]*남성 아우터/);
  assert.match(componentSource, /FEMALE:[\s\S]*여성 아우터/);
  assert.match(componentSource, /UNISEX:[\s\S]*공용 아우터/);
  assert.match(componentSource, /ACCESSORY:[\s\S]*가방/);
  assert.match(route, /const storeId = auth\.selectedStoreId/);
  assert.doesNotMatch(route, /const storeId = text\(body/);
  assert.match(route, /condition_grade: singleRegistration[\s\S]*\? "A"/);
});
