const PROJECT_URL = Deno.env.get("SUPABASE_URL") ?? "";
const IODA_URL = "https://api.ioda.inetintel.cc.gatech.edu/v2";
const COUNTRY = "IR";
const LOOKBACK_HOURS = 4;
const MAX_POINTS = 240;
const SOURCES = [
  { id: "ioda:IR:bgp", signal: "bgp", unit: "Visible IPv4 /24 networks" },
  { id: "ioda:IR:ping-slash24", signal: "ping-slash24", unit: "Reachable IPv4 /24 networks" },
  { id: "ioda:IR:merit-nt", signal: "merit-nt", unit: "Unique source IPs" },
];
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, apikey, x-netguard-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function getServiceKey(): string {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  const encoded = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (!encoded) throw new Error("service_key_unavailable");
  const keys = JSON.parse(encoded);
  const key = typeof keys.default === "string" ? keys.default : "";
  if (!key) throw new Error("default_secret_key_unavailable");
  return key;
}

function dbHeaders(key: string): Record<string, string> {
  const headers: Record<string, string> = {
    "apikey": key,
    "Accept": "application/json",
    "Content-Type": "application/json",
  };
  if (key.startsWith("eyJ")) headers["Authorization"] = `Bearer ${key}`;
  return headers;
}

async function dbRequest(
  key: string,
  table: string,
  method: "GET" | "POST",
  body?: unknown,
  query = "",
  prefer = "return=minimal",
): Promise<Response> {
  const response = await fetch(`${PROJECT_URL}/rest/v1/${table}${query}`, {
    method,
    headers: { ...dbHeaders(key), "Prefer": prefer },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`database_${table}_http_${response.status}`);
  return response;
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

function walk(value: unknown): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];
  const stack: unknown[] = [value];
  while (stack.length) {
    const item = stack.pop();
    if (Array.isArray(item)) {
      for (let i = item.length - 1; i >= 0; i--) stack.push(item[i]);
    } else if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      result.push(record);
      for (const child of Object.values(record)) stack.push(child);
    }
  }
  return result;
}

function numericValue(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) && raw >= 0 ? raw : null;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const item = raw as Record<string, unknown>;
    for (const key of ["value", "count", "total", "samples", "number"]) {
      const candidate = item[key];
      if (typeof candidate === "number" && Number.isFinite(candidate) && candidate >= 0) return candidate;
    }
  }
  return null;
}

function normalize(payload: unknown, source: typeof SOURCES[number], collectedAt: string) {
  if (payload && typeof payload === "object" && (payload as Record<string, unknown>).error) {
    throw new Error("ioda_error_envelope");
  }
  const byTimestamp = new Map<number, Record<string, unknown>>();
  for (const series of walk(payload)) {
    if ((series.datasource ?? series.source) !== source.signal) continue;
    const values = series.values;
    const start = series.from;
    const step = series.step;
    if (!Array.isArray(values) || typeof start !== "number" || !Number.isInteger(start) ||
        typeof step !== "number" || !Number.isInteger(step) || step <= 0) continue;
    values.forEach((raw, index) => {
      const value = numericValue(raw);
      if (value === null) return;
      const timestamp = start + index * step;
      byTimestamp.set(timestamp, {
        source_id: source.id,
        observed_at: new Date(timestamp * 1000).toISOString(),
        collected_at: collectedAt,
        value,
        unit: source.unit,
        geographic_scope: "country",
        quality: "valid",
        external_id: `${source.id}:${timestamp}`,
        metadata: {
          provider: "IODA",
          country_code: COUNTRY,
          datasource: source.signal,
          upstream_step_seconds: step,
          upstream_native_step_seconds: series.nativeStep ?? null,
        },
      });
    });
  }
  return [...byTimestamp.entries()].sort((a, b) => a[0] - b[0]).map((entry) => entry[1]);
}

function safeError(error: unknown): { code: string; message: string } {
  const message = error instanceof Error ? error.message : "";
  if (message.startsWith("ioda_http_")) return { code: "upstream_http_error", message: "IODA پاسخ موفق نداد." };
  if (message.startsWith("database_")) return { code: "database_error", message: "ثبت داده در پایگاه داده ناموفق بود." };
  if (message.includes("fetch")) return { code: "network_error", message: "ارتباط با منبع داده برقرار نشد." };
  return { code: "collector_error", message: "جمع‌آوری داده با خطا مواجه شد." };
}

async function collectSource(key: string, source: typeof SOURCES[number]) {
  const started = new Date();
  const monotonicStart = performance.now();
  let status = "success";
  let errorCode: string | null = null;
  let errorMessage: string | null = null;
  let received = 0;
  let upserted = 0;
  try {
    const until = Math.floor(Date.now() / 1000);
    const from = until - LOOKBACK_HOURS * 3600;
    const query = new URLSearchParams({
      from: String(from),
      until: String(until),
      source: source.signal,
      datasource: source.signal,
      maxPoints: String(MAX_POINTS),
    });
    const response = await fetch(`${IODA_URL}/signals/raw/country/${COUNTRY}?${query}`, {
      headers: { "Accept": "application/json", "User-Agent": "NetGuard/1.0 (public internet monitoring)" },
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`ioda_http_${response.status}`);
    const payload = await response.json();
    const rows = normalize(payload, source, new Date().toISOString());
    received = rows.length;
    if (rows.length) {
      await dbRequest(
        key,
        "observations",
        "POST",
        rows,
        "?on_conflict=source_id,observed_at",
        "resolution=merge-duplicates,return=minimal",
      );
      upserted = rows.length;
    } else {
      status = "no_data";
    }
  } catch (error) {
    status = "error";
    const safe = safeError(error);
    errorCode = safe.code;
    errorMessage = safe.message;
    console.error(`Source ${source.id} failed: ${safe.code}`);
  }

  const finished = new Date();
  const run = {
    id: crypto.randomUUID(),
    source_id: source.id,
    started_at: started.toISOString(),
    finished_at: finished.toISOString(),
    status,
    records_received: received,
    records_upserted: upserted,
    duration_ms: Math.max(0, Math.round(performance.now() - monotonicStart)),
    error_code: errorCode,
    error_message: errorMessage,
    collector_version: "1.1.0",
  };
  await dbRequest(key, "collector_runs", "POST", run);
  return {
    source_id: source.id,
    status,
    records_received: received,
    records_upserted: upserted,
    duration_ms: run.duration_ms,
    error_code: errorCode,
  };
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405, headers: corsHeaders });
  }
  try {
    if (!PROJECT_URL.startsWith("https://")) throw new Error("project_url_unavailable");
    const suppliedToken = request.headers.get("x-netguard-token") ?? "";
    if (!suppliedToken || suppliedToken.length < 40) {
      return Response.json({ error: "unauthorized" }, { status: 401, headers: corsHeaders });
    }
    const key = getServiceKey();
    const credentialResponse = await dbRequest(
      key,
      "netguard_collector_credentials",
      "GET",
      undefined,
      "?select=token_hash&name=eq.ioda_collector&limit=1",
    );
    const credentials = await credentialResponse.json();
    const expectedHash = Array.isArray(credentials) ? credentials[0]?.token_hash : null;
    if (typeof expectedHash !== "string" ||
        !constantTimeEqual(await sha256(suppliedToken), expectedHash)) {
      return Response.json({ error: "unauthorized" }, { status: 401, headers: corsHeaders });
    }

    const results = [];
    for (const source of SOURCES) results.push(await collectSource(key, source));
    const failures = results.filter((result) => result.status === "error").length;
    return Response.json({
      status: failures === 0 ? "ok" : "partial",
      generated_at: new Date().toISOString(),
      results,
    }, { status: 200, headers: corsHeaders });
  } catch (error) {
    const safe = safeError(error);
    console.error(`Collector invocation failed: ${safe.code}`);
    return Response.json({ error: safe.code }, { status: 500, headers: corsHeaders });
  }
});
