import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("background single registration reports completion and failure via a modal", async () => {
  const consoleSource = await source(
    "src/components/admin/operator/OperatorProductsConsole.tsx",
  );

  assert.match(consoleSource, /type RegistrationResultModal =/);
  assert.match(
    consoleSource,
    /setRegistrationResult\(\{[\s\S]{0,80}kind: "success"/,
  );
  assert.match(
    consoleSource,
    /setRegistrationResult\(\{[\s\S]{0,80}kind: "failure"/,
  );
  assert.match(consoleSource, /<PremiumDialog[\s\S]*?single-registration-result-title/);
  assert.match(consoleSource, />\s*등록 완료\s*</);
  assert.match(consoleSource, />\s*등록 실패\s*</);
  assert.match(consoleSource, />\s*재시도 진행 중입니다\s*</);
  const retryingWindow = consoleSource.slice(
    consoleSource.indexOf('kind === "retrying" &&'),
    consoleSource.indexOf('kind === "failure" &&'),
  );
  assert.ok(retryingWindow.includes("재시도 진행 중입니다"));
  assert.doesNotMatch(retryingWindow, /<Button/);
});

test("retry reruns the background job and failure confirm restores inputs with photos", async () => {
  const consoleSource = await source(
    "src/components/admin/operator/OperatorProductsConsole.tsx",
  );

  const retryIndex = consoleSource.indexOf("kind: \"retrying\"");
  const retryCallIndex = consoleSource.indexOf(
    "void processSingleRegistration(retrySnapshot)",
  );
  assert.notEqual(retryIndex, -1);
  assert.ok(
    retryCallIndex > retryIndex,
    "재시도 모달을 먼저 띄운 뒤 백그라운드 재시도를 실행해야 합니다.",
  );
  assert.match(
    consoleSource,
    /const restoreFailedRegistration = \(jobId: string\) => \{[\s\S]*?dismissFailedSingleRegistration\(jobId\)[\s\S]*?setForm\(\{ \.\.\.snapshot\.form \}\)[\s\S]*?setSingleImages\(/,
  );
  assert.match(
    consoleSource,
    /previewUrl: URL\.createObjectURL\(file\)/,
  );
  assert.match(
    consoleSource,
    /onClick=\{\(\) =>[\s\S]{0,100}restoreFailedRegistration\(registrationResult\.jobId\)[\s\S]{0,100}>\s*확인\s*</,
  );
  assert.match(
    consoleSource,
    /onClick=\{\(\) =>[\s\S]{0,100}retrySingleRegistration\(registrationResult\.jobId\)[\s\S]{0,100}>\s*재시도\s*</,
  );
});
