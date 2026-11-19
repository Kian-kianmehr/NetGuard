import test from "node:test";
import assert from "node:assert/strict";
import { fetchJsonWithRetry, fetchSnapshotWithFallback } from "../src/snapshot-client.js";

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


test("falls back to the public Supabase snapshot when the API host is unavailable", async () => {
  const originalFetch = globalThis.fetch;
  const row = {
    dataset_key: "dashboard_24",
    payload: { analysis: { intelligence: { model_status: "ready" } } },
    collected_at: "2026-11-19T09:06:14Z",
    status: "success",
    source_count: 3,
    error_code: null,
  };
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("/api/dashboard")) {
      throw new TypeError("network unavailable");
    }
    return { ok: true, status: 200, json: async () => [row] };
  };

  try {
    const result = await fetchSnapshotWithFallback({
      datasetKey: "dashboard_24",
      apiUrl: "https://api.example.test/api/dashboard?hours=24",
      supabaseUrl: "https://project.supabase.co",
      supabaseKey: "sb_publishable_test",
    }, { timeoutMs: 100, maxAttempts: 1, retryDelayMs: 0 });

    assert.deepEqual(result, row);
    assert.equal(calls.length, 2);
    assert.match(calls[1].url, /rest\/v1\/netguard_snapshots/);
    assert.equal(calls[1].options.headers.apikey, "sb_publishable_test");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("uses the primary API when it succeeds without contacting Supabase", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  const payload = {
    snapshot_at: "2026-11-19T09:06:14Z",
    snapshot_status: "success",
    source_count: 3,
    analysis: { intelligence: { model_status: "ready" } },
  };
  globalThis.fetch = async () => {
    calls += 1;
    return { ok: true, status: 200, json: async () => payload };
  };

  try {
    const result = await fetchSnapshotWithFallback({
      datasetKey: "dashboard_24",
      apiUrl: "https://api.example.test/api/dashboard?hours=24",
      supabaseUrl: "https://project.supabase.co",
      supabaseKey: "sb_publishable_test",
    }, { timeoutMs: 100, maxAttempts: 1, retryDelayMs: 0 });

    assert.equal(calls, 1);
    assert.equal(result.dataset_key, "dashboard_24");
    assert.equal(result.payload, payload);
    assert.equal(result.status, "success");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("reports a clear error when both snapshot paths fail", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError("network unavailable");
  };

  try {
    await assert.rejects(
      fetchSnapshotWithFallback({
        datasetKey: "dashboard_24",
        apiUrl: "https://api.example.test/api/dashboard?hours=24",
        supabaseUrl: "https://project.supabase.co",
        supabaseKey: "sb_publishable_test",
      }, { timeoutMs: 100, maxAttempts: 1, retryDelayMs: 0 }),
      /API و مسیر جایگزین پایگاه داده/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
