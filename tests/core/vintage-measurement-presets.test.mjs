import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  collectMeasurements,
  measurementEntries,
  measurementPresetForCategory,
  normalizeMeasurements,
} from "../../src/lib/catalog/measurements.ts";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("category presets open the measurement fields per garment group", () => {
  const topFields = measurementPresetForCategory("여성 · 상의 · 니트")?.fields;
  assert.deepEqual([...topFields], ["shoulder", "chest", "sleeve", "length"]);
  const outerFields = measurementPresetForCategory("남성 · 아우터 · 코트")?.fields;
  assert.deepEqual([...outerFields], ["shoulder", "chest", "sleeve", "length"]);
  const bottomFields = measurementPresetForCategory("여성 · 바지 · 데님/청바지")?.fields;
  assert.deepEqual([...bottomFields], ["waist", "rise", "thigh", "hem", "length"]);
  const skirtFields = measurementPresetForCategory("여성 · 치마 · 미디스커트")?.fields;
  assert.deepEqual([...skirtFields], ["waist", "rise", "thigh", "hem", "length"]);
});

test("unknown, blank, and misc categories keep the form free of preset fields", () => {
  assert.equal(measurementPresetForCategory("기타"), null);
  assert.equal(measurementPresetForCategory(""), null);
  assert.equal(measurementPresetForCategory(null), null);
  assert.equal(measurementPresetForCategory(undefined), null);
});

test("measurement payloads are normalized to known positive centimeter keys", () => {
  assert.deepEqual(
    normalizeMeasurements({
      shoulder: 44,
      chest: "52.5",
      sleeve: 0,
      waist: -3,
      rise: 9999,
      thigh: Number.NaN,
      hem: "30",
      hip: null,
      length: 68,
      brand: "levis",
    }),
    { shoulder: 44, chest: 52.5, hem: 30, length: 68 },
  );
  assert.deepEqual(normalizeMeasurements(null), {});
  assert.deepEqual(normalizeMeasurements([44]), {});
  assert.deepEqual(normalizeMeasurements("44cm"), {});
});

test("form strings are collected into numeric measurements for saving", () => {
  assert.deepEqual(
    collectMeasurements({ shoulder: "45", chest: "", length: "70.5", waist: "abc" }),
    { shoulder: 45, length: 70.5 },
  );
});

test("display entries follow a stable order and drop empty values", () => {
  const entries = measurementEntries({ length: 66, shoulder: 42, sleeve: 0 });
  assert.deepEqual(
    entries.map((entry) => entry.label),
    ["어깨", "총장"],
  );
  assert.deepEqual(measurementEntries({}), []);
});

test("registration form opens preset fields from the selected category and persists them", async () => {
  const [consoleSource, postRoute, patchRoute] = await Promise.all([
    source("src/components/admin/operator/OperatorProductsConsole.tsx"),
    source("src/app/api/admin/operator/products/route.ts"),
    source("src/app/api/admin/operator/products/[id]/route.ts"),
  ]);
  assert.match(consoleSource, /<GenderCategorySelect/);
  assert.match(consoleSource, /<MeasurementFields[\s\S]{0,120}category=\{form\.category\}/);
  assert.match(consoleSource, /measurements: collectMeasurements\(snapshot\.form\.measurements\)/);
  assert.match(consoleSource, /measurements: collectMeasurements\(form\.measurements\)/);
  assert.match(postRoute, /measurements: normalizeMeasurements\(body\?\.measurements\)/);
  assert.match(patchRoute, /normalizeMeasurements\(body\.measurements\)/);
});
