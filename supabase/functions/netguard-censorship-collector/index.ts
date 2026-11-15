const PROJECT_URL = Deno.env.get("SUPABASE_URL") ?? "";
const OONI_API_URL = "https://api.ooni.io/api/v1/measurements";
const COUNTRY = "IR";
const LOOKBACK_DAYS = 90;
const PAGE_SIZE = 100;
const TEST_LIST_BATCH_SIZE = 250;
const MAX_PAGES = 5;
const TEST_LIST_URL = "https://raw.githubusercontent.com/citizenlab/test-lists/master/lists/ir.csv";
const EXCLUDED_TEST_CATEGORIES = new Set(["ALDR", "GMB", "PORN", "DATE", "XED"]);

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
    apikey: key,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`;
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
    headers: { ...dbHeaders(key), Prefer: prefer },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = (await response.text()).replace(/[\\r\\n]+/g, " ").slice(0, 240);
    throw new Error(`database_${table}_http_${response.status}_${detail}`);
  }
  return response;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index++) mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return mismatch === 0;
}

function asBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true" || value === "t";
}

function normalizeDomain(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const candidate = raw.trim();
    const parsed = new URL(/^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`);
    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
    return hostname && hostname !== "localhost" ? hostname : null;
  } catch {
    return null;
  }
}

async function fetchMeasurements(classification: "confirmed" | "anomaly", since: string, until: string) {
  const collected: Record<string, unknown>[] = [];
  let fetchError: string | null = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({
      probe_cc: COUNTRY,
      test_name: "web_connectivity",
      [classification]: "true",
      since,
      until,
      limit: String(PAGE_SIZE),
      offset: String(page * PAGE_SIZE),
      order_by: "measurement_start_time",
      order: "desc",
    });

    let response: Response;
    try {
      response = await fetch(`${OONI_API_URL}?${params.toString()}`, {
        headers: { Accept: "application/json", "User-Agent": "NetGuard/1.0 (public Iran internet monitoring)" },
        signal: AbortSignal.timeout(25000),
      });
    } catch (error) {
      fetchError = error instanceof Error ? error.message : "ooni_request_error";
      break;
    }
    if (!response.ok) {
      fetchError = `ooni_${classification}_http_${response.status}`;
      break;
    }

    let payload: Record<string, unknown>;
    try {
      payload = await response.json();
    } catch {
      fetchError = "ooni_invalid_json";
      break;
    }
    const results = payload && Array.isArray(payload.results) ? payload.results : [];
    for (const raw of results) {
      if (!raw || typeof raw !== "object") continue;
      const item = raw as Record<string, unknown>;
      const confirmed = asBoolean(item.confirmed);
      const anomaly = asBoolean(item.anomaly);
      if (classification === "confirmed" && !confirmed) continue;
      if (classification === "anomaly" && (!anomaly || confirmed)) continue;

      const input = typeof item.input === "string" ? item.input.trim() : "";
      const domain = normalizeDomain(input);
      const rawTime = item.measurement_start_time ?? item.test_start_time;
      const measuredAt = typeof rawTime === "string" ? new Date(rawTime) : null;
      if (!domain || !input || !measuredAt || !Number.isFinite(measuredAt.getTime())) continue;

      const reportId = typeof item.report_id === "string" ? item.report_id : null;
      const rawAsn = item.probe_asn;
      const asnMatch = typeof rawAsn === "string" ? rawAsn.trim().match(/^(?:AS)?(\d+)$/i) : null;
      const probeAsnNumber = typeof rawAsn === "number" ? rawAsn : Number(asnMatch?.[1]);
      const probeAsn = Number.isSafeInteger(probeAsnNumber) && probeAsnNumber > 0 ? probeAsnNumber : null;

      // Keep the legacy identity stable so historical rows can be updated with the corrected ASN.
      const legacyAsnNumber = Number(rawAsn);
      const identityAsn = Number.isSafeInteger(legacyAsnNumber) && legacyAsnNumber > 0
        ? legacyAsnNumber
        : null;
      const categoryCode = typeof item.category_code === "string" ? item.category_code : null;
      const testName = typeof item.test_name === "string" ? item.test_name : "web_connectivity";
      const identity = [
        reportId ?? "",
        input,
        measuredAt.toISOString(),
        identityAsn ?? "",
        classification,
      ].join("|");

      collected.push({
        measurement_id: await sha256(identity),
        domain,
        input,
        classification,
        measurement_start_time: measuredAt.toISOString(),
        probe_asn: probeAsn,
        category_code: categoryCode,
        report_id: reportId,
        test_name: testName,
      });
    }
    if (results.length < PAGE_SIZE) break;
  }

  return { rows: collected, error: fetchError };
}


function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const input = text.replace(/^\uFEFF/, "");
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (char === '"') {
      if (quoted && input[index + 1] === '"') {
        field += '"';
        index++;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && input[index + 1] === "\n") index++;
      row.push(field);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  row.push(field);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

async function fetchTestListDomains() {
  try {
    const response = await fetch(TEST_LIST_URL, {
      headers: { Accept: "text/csv", "User-Agent": "NetGuard/1.0 (public Iran internet monitoring)" },
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error("citizenlab_http_" + response.status);
    const rows = parseCsv(await response.text());
    if (!rows.length) throw new Error("citizenlab_empty_list");
    const header = rows[0].map((value) => value.trim().toLowerCase());
    const urlIndex = header.indexOf("url");
    const categoryIndex = header.indexOf("category_code");
    const descriptionIndex = header.indexOf("category_description");
    if (urlIndex < 0 || categoryIndex < 0) throw new Error("citizenlab_invalid_headers");

    const deduplicated = new Map<string, Record<string, unknown>>();
    for (const values of rows.slice(1)) {
      const input = (values[urlIndex] ?? "").trim();
      const category = (values[categoryIndex] ?? "").trim().toUpperCase();
      if (!input || !category || EXCLUDED_TEST_CATEGORIES.has(category)) continue;
      const domain = normalizeDomain(input);
      if (!domain) continue;
      deduplicated.set(domain, {
        domain,
        input,
        category_code: category,
        category_description: (values[descriptionIndex] ?? "").trim(),
        source_url: "https://github.com/citizenlab/test-lists/blob/master/lists/ir.csv",
        updated_at: new Date().toISOString(),
      });
    }
    return { rows: [...deduplicated.values()], error: null as string | null };
  } catch (error) {
    const code = error instanceof Error ? error.message.split("_http_")[0] : "citizenlab_fetch_error";
    return { rows: [] as Record<string, unknown>[], error: code.slice(0, 120) };
  }
}

async function saveTestListDomains(key: string, rows: Record<string, unknown>[]) {
  for (let offset = 0; offset < rows.length; offset += TEST_LIST_BATCH_SIZE) {
    await dbRequest(
      key,
      "censorship_test_domains",
      "POST",
      rows.slice(offset, offset + TEST_LIST_BATCH_SIZE),
      "?on_conflict=domain",
      "resolution=merge-duplicates,return=minimal",
    );
  }
}

async function saveRows(key: string, rows: Record<string, unknown>[]) {
  for (let offset = 0; offset < rows.length; offset += PAGE_SIZE) {
    const batch = rows.slice(offset, offset + PAGE_SIZE);
    await dbRequest(
      key,
      "censorship_measurements",
      "POST",
      batch,
      "?on_conflict=measurement_id",
      "resolution=merge-duplicates,return=minimal",
    );
  }
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405, headers: corsHeaders });
  }

  const startedAt = new Date();
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

    const until = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const [confirmedResult, anomalyResult, testListResult] = await Promise.all([
      fetchMeasurements("confirmed", since, until),
      fetchMeasurements("anomaly", since, until),
      fetchTestListDomains(),
    ]);
    const collected = [...confirmedResult.rows, ...anomalyResult.rows];
    const rows = [...new Map(collected.map((row) => [String(row.measurement_id), row])).values()];
    let measurementSaveError: string | null = null;
    let testListSaveError: string | null = testListResult.error;
    let testListSaved = 0;
    if (testListResult.rows.length) {
      try {
        await saveTestListDomains(key, testListResult.rows);
        testListSaved = testListResult.rows.length;
      } catch (error) {
        testListSaveError = error instanceof Error ? error.message.slice(0, 240) : "database_censorship_test_domains";
      }
    }
    if (rows.length) {
      try {
        await saveRows(key, rows);
      } catch (error) {
        measurementSaveError = error instanceof Error ? error.message.slice(0, 240) : "database_censorship_measurements";
      }
    }
    const errors = [
      confirmedResult.error, anomalyResult.error, testListSaveError, measurementSaveError,
    ].filter((item): item is string => Boolean(item));
    const successfulWork = testListSaved > 0 || (rows.length > 0 && !measurementSaveError);
    const status = errors.length === 0
      ? "success"
      : successfulWork
      ? "partial"
      : "error";
    const finishedAt = new Date();
    await dbRequest(key, "censorship_sync_runs", "POST", {
      id: crypto.randomUUID(),
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
      status,
      records_received: rows.length,
      error_code: [
        confirmedResult.error, anomalyResult.error, measurementSaveError,
      ].filter(Boolean).join(",").slice(0, 500) || null,
      test_list_records_received: testListSaved,
      test_list_error_code: testListSaveError,
    });

    return Response.json({
      status,
      records_received: rows.length,
      test_list_records_received: testListSaved,
      test_list_error_code: testListSaveError,
      since,
      until,
      generated_at: finishedAt.toISOString(),
    }, { status: 200, headers: corsHeaders });
  } catch (error) {
    const finishedAt = new Date();
    const errorCode = error instanceof Error
      ? error.message.replace(/[\\r\\n]+/g, " ").slice(0, 240)
      : "collector_error";
    try {
      const key = getServiceKey();
      await dbRequest(key, "censorship_sync_runs", "POST", {
        id: crypto.randomUUID(),
        started_at: startedAt.toISOString(),
        finished_at: finishedAt.toISOString(),
        status: "error",
        records_received: 0,
        error_code: errorCode,
      });
    } catch {
      // Preserve the original failure; no credentials or upstream payloads are logged.
    }
    console.error(`Censorship collection failed: ${errorCode}`);
    return Response.json({ error: "censorship_collection_failed" }, { status: 500, headers: corsHeaders });
  }
});
