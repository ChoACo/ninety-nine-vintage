import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("Kakao postcode search is allowed by CSP and recovers from script failures", async () => {
  const [config, button] = await Promise.all([
    source("next.config.ts"),
    source("src/components/features/account/PostcodeSearchButton.tsx"),
  ]);

  assert.match(config, /script-src[^`]*https:\/\/t1\.kakaocdn\.net/);
  assert.match(config, /frame-src 'self' https:\/\/postcode\.map\.kakao\.com/);
  assert.match(button, /id="kakao-postcode-service"/);
  assert.match(button, /h-\[450px\]/);
  assert.match(button, /window\.setInterval/);
  assert.match(button, /Date\.now\(\) - startedAt >= 8_000/);
  assert.match(button, /event\.key === "Escape"/);
  assert.match(button, /onReady=\{markReady\}/);
  assert.match(
    button,
    /onError=\{\(\) => \{[\s\S]{0,80}setReady\(false\);[\s\S]{0,80}setLoadError\(true\);/,
  );
  assert.match(button, /주소 검색 서비스를 불러오지 못했습니다/);
});
