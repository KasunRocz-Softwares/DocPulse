import assert from "node:assert/strict";
import { test } from "node:test";
import { HttpAiSummaryProvider } from "./http-ai-summary.provider";

function config(values: Record<string, string>) {
  return {
    get: (key: string) => values[key],
  } as never;
}

const input = {
  changes: [
    {
      id: "change-1",
      title: "Quicker exports",
      category: "IMPROVEMENT",
      publicDescription: "Exports complete faster.",
    },
  ],
};

test("fails clearly when endpoint or model configuration is missing", async () => {
  const provider = new HttpAiSummaryProvider(config({}));
  await assert.rejects(
    provider.generate(input),
    (error: { getStatus?: () => number; message?: string }) =>
      error.getStatus?.() === 503 &&
      /AI_SUMMARY_PROVIDER_URL/.test(error.message ?? ""),
  );
});

test("rejects HTTP provider URLs before an API key can be sent", async () => {
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  globalThis.fetch = async () => {
    requestCount += 1;
    return new Response("unexpected", { status: 200 });
  };
  try {
    const provider = new HttpAiSummaryProvider(
      config({
        AI_SUMMARY_PROVIDER_URL: "http://provider.example/v1/chat/completions",
        AI_SUMMARY_MODEL: "configured-model",
        AI_SUMMARY_PROVIDER_API_KEY: "test-secret",
      }),
    );
    await assert.rejects(
      provider.generate(input),
      (error: { getStatus?: () => number; message?: string }) =>
        error.getStatus?.() === 503 && /HTTPS/.test(error.message ?? ""),
    );
    assert.equal(requestCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("validates provider response and reports configured model metadata", async () => {
  const originalFetch = globalThis.fetch;
  let sentBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (_url, init) => {
    sentBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        model: "provider-model-v2",
        choices: [{ message: { content: "  Exports complete faster.  " } }],
      }),
      { status: 200 },
    );
  };
  try {
    const provider = new HttpAiSummaryProvider(
      config({
        AI_SUMMARY_PROVIDER_URL: "https://provider.example/v1/chat/completions",
        AI_SUMMARY_MODEL: "configured-model",
        AI_SUMMARY_PROVIDER_API_KEY: "test-secret",
      }),
    );
    assert.deepEqual(await provider.generate(input), {
      summary: "Exports complete faster.",
      model: "provider-model-v2",
    });
    assert.equal(sentBody?.model, "configured-model");
    const userMessage = (sentBody?.messages as Array<{ content: string }>)[1];
    assert.ok(userMessage);
    assert.equal(userMessage.content, JSON.stringify(input));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("does not expose provider response bodies or credentials on HTTP errors", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response("provider echoed test-secret", { status: 502 });
  try {
    const provider = new HttpAiSummaryProvider(
      config({
        AI_SUMMARY_PROVIDER_URL: "https://provider.example/completions",
        AI_SUMMARY_MODEL: "configured-model",
        AI_SUMMARY_PROVIDER_API_KEY: "test-secret",
      }),
    );
    await assert.rejects(
      provider.generate(input),
      (error: { getStatus?: () => number; message?: string }) =>
        error.getStatus?.() === 503 &&
        /502/.test(error.message ?? "") &&
        !/test-secret|provider echoed/.test(error.message ?? ""),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects malformed provider summaries", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: " " } }] }), {
      status: 200,
    });
  try {
    const provider = new HttpAiSummaryProvider(
      config({
        AI_SUMMARY_PROVIDER_URL: "https://provider.example/completions",
        AI_SUMMARY_MODEL: "configured-model",
      }),
    );
    await assert.rejects(provider.generate(input), /invalid summary/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects oversized provider responses", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response("x".repeat(65 * 1024), { status: 200 });
  try {
    const provider = new HttpAiSummaryProvider(
      config({
        AI_SUMMARY_PROVIDER_URL: "https://provider.example/completions",
        AI_SUMMARY_MODEL: "configured-model",
      }),
    );
    await assert.rejects(provider.generate(input), /size limit/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
