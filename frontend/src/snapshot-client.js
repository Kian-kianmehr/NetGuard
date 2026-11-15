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
      const payload = await response.json().catch(() => null);

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
