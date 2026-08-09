import assert from "node:assert/strict";
import { getConfiguredModels, routeCompletion } from "../../src/lib/ai/aiModelRouter.ts";

const models = getConfiguredModels();
const originalFetch = globalThis.fetch;

try {
  const calls = [];
  globalThis.fetch = async (_url, init) => {
    const model = JSON.parse(init.body).model;
    calls.push(model);
    if (model === models[0]) {
      return Response.json({ error: { message: "rate limited" } }, { status: 429 });
    }
    return Response.json({
      id: "completion-1",
      model,
      choices: [{ message: { content: "{}" } }],
      usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
    });
  };

  const fallback = await routeCompletion({ messages: [{ role: "user", content: "test" }] }, { apiKey: "test" });
  assert.equal(fallback.usedModel, models[1]);
  assert.equal(fallback.attemptedModels, 2);
  assert.deepEqual(fallback.attemptedModelIds, [models[0], models[1]]);
  assert.match(fallback.fallbackReason ?? "", /429/);
  assert.deepEqual(calls, [models[0], models[1]]);

  globalThis.fetch = async () => Response.json(
    { error: { message: "unavailable" } },
    { status: 503 },
  );
  await assert.rejects(
    routeCompletion({ messages: [{ role: "user", content: "test" }] }, { apiKey: "test" }),
    (error) => {
      assert.equal(error.modelsTried, models.length);
      assert.deepEqual(error.attemptedModelIds, [...models]);
      return true;
    },
  );
} finally {
  globalThis.fetch = originalFetch;
}

console.log("PASS AI model router execution paths");
