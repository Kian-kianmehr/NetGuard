const DEFAULT_TIMEOUT_MS = 7000;
const DEFAULT_MAX_ATTEMPTS = 2;
const DEFAULT_RETRY_DELAY_MS = 350;

function makeTimeoutError(timeoutMs) {
  const error = new Error(`پاسخ سرویس داده در ${Math.round(timeoutMs / 1000)} ثانیه نرسید. اتصال شبکه را بررسی و دوباره تلاش کنید.`);
  error.name = "SnapshotTimeoutError";
  error.retryable = true;
  return error;
}

/**
 * Fetch and decode a JSON response with a hard time limit.
 *
 * Network failures, timeouts and transient server responses are retried once.
 * Client errors (for example invalid credentials or a missing resource) fail
 * immediately so the UI can show the actual problem instead of waiting.
 */
export async function fetchJsonWithRetry(
  url,
  options = {},
  {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  } = {}
) {
  const attempts = Math.max(1, Math.floor(Number(maxAttempts) || 1));
  const timeout = Math.max(1, Number(timeoutMs) || DEFAULT_TIMEOUT_MS);
  let lastError;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      const payload = await response.json().catch((error) => {
        if (controller.signal.aborted) throw error;
        return null;
      });

      if (!response.ok) {
        const error = new Error(
          payload?.message ||
          payload?.details ||
          `خواندن Snapshot ناموفق بود (${response.status}).`
        );
        error.retryable = response.status === 429 || response.status >= 500;
        throw error;
      }

      return payload;
    } catch (error) {
      if (controller.signal.aborted) {
        lastError = makeTimeoutError(timeout);
      } else if (error instanceof TypeError) {
        lastError = new Error("اتصال به سرویس داده برقرار نشد؛ شبکه را بررسی کنید و دوباره تلاش کنید.");
        lastError.retryable = true;
      } else {
        lastError = error;
      }

      const retryable = controller.signal.aborted || error?.retryable || error instanceof TypeError;
      const hasAnotherAttempt = attempt + 1 < attempts;
      if (!retryable || !hasAnotherAttempt) throw lastError;
    } finally {
      clearTimeout(timeoutId);
    }

    await new Promise((resolve) => setTimeout(resolve, Math.max(0, retryDelayMs)));
  }

  throw lastError || new Error("دریافت Snapshot ناموفق بود.");
}

/**
 * Fetch a public snapshot from the regional API first, then fall back to the
 * existing public-read Supabase table if the API host is unreachable.
 *
 * This uses only the publishable/anon key and the existing public SELECT policy.
 * It never writes data or exposes a server-side secret.
 */
export async function fetchSnapshotWithFallback(
  { datasetKey, apiUrl, supabaseUrl, supabaseKey },
  options = {},
) {
  let apiError;
  try {
    const payload = await fetchJsonWithRetry(
      apiUrl,
      {
        headers: { Accept: "application/json" },
        cache: "no-store",
      },
      options,
    );
    return {
      dataset_key: datasetKey,
      payload,
      collected_at: payload?.snapshot_at || payload?.collected_at || null,
      status: payload?.snapshot_status || "unknown",
      source_count: payload?.source_count ?? 0,
      error_code: payload?.snapshot_error || null,
    };
  } catch (error) {
    apiError = error;
  }

  if (!supabaseUrl || !supabaseKey) throw apiError;

  const query = new URLSearchParams({
    select: "dataset_key,payload,collected_at,status,source_count,error_code",
    dataset_key: `eq.${datasetKey}`,
    limit: "1",
  });
  const headers = { Accept: "application/json", apikey: supabaseKey };
  if (supabaseKey.startsWith("eyJ")) {
    headers.Authorization = `Bearer ${supabaseKey}`;
  }

  try {
    const rows = await fetchJsonWithRetry(
      `${supabaseUrl.replace(/\/$/, "")}/rest/v1/netguard_snapshots?${query.toString()}`,
      { headers, cache: "no-store" },
      { ...options, maxAttempts: 1 },
    );
    const row = Array.isArray(rows)
      ? rows.find((item) => item?.dataset_key === datasetKey)
      : null;
    if (!row || !row.payload || typeof row.payload !== "object" || Array.isArray(row.payload)) {
      throw new Error("Snapshot جایگزین در پایگاه داده پیدا نشد.");
    }
    return row;
  } catch (fallbackError) {
    const error = new Error(
      "دریافت داده از API و مسیر جایگزین پایگاه داده ناموفق بود؛ اتصال شبکه را بررسی و دوباره تلاش کنید.",
    );
    error.apiError = apiError;
    error.fallbackError = fallbackError;
    throw error;
  }
}

