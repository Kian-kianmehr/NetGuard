import test from "node:test";
import assert from "node:assert/strict";
import { fetchJsonWithRetry } from "../src/snapshot-client.js";

test("returns decoded JSON when the request succeeds", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => [{ dataset_key: "dashboard_168" }],
  });

  try {
    const result = await fetchJsonWithRetry("/snapshot", {}, { timeoutMs: 100, maxAttempts: 1 });
    assert.deepEqual(result, [{ dataset_key: "dashboard_168" }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("retries a transient network failure once", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) throw new TypeError("network unavailable");
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };

  try {
    const result = await fetchJsonWithRetry("/snapshot", {}, {
      timeoutMs: 100,
      maxAttempts: 2,
      retryDelayMs: 0,
    });
    assert.deepEqual(result, { ok: true });
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("does not retry client errors", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return {
      ok: false,
      status: 401,
      json: async () => ({ message: "Unauthorized" }),
    };
  };

  try {
    await assert.rejects(
      fetchJsonWithRetry("/snapshot", {}, { timeoutMs: 100, maxAttempts: 2, retryDelayMs: 0 }),
      /Unauthorized/
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("aborts a request that exceeds the timeout", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (_url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    }, { once: true });
  });

  try {
    await assert.rejects(
      fetchJsonWithRetry("/snapshot", {}, {
        timeoutMs: 15,
        maxAttempts: 1,
        retryDelayMs: 0,
      }),
      /پاسخ سرویس داده/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("aborts when the response body stalls", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (_url, { signal }) => Promise.resolve({
    ok: true,
    status: 200,
    json: () => new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("body aborted")), { once: true });
    }),
  });

  try {
    await assert.rejects(
      fetchJsonWithRetry("/snapshot", {}, {
        timeoutMs: 15,
        maxAttempts: 1,
        retryDelayMs: 0,
      }),
      /پاسخ سرویس داده/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
