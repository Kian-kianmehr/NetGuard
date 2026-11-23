import { useCallback, useRef, useState } from "react";
import { fetchSnapshotWithFallback } from "../snapshot-client.js";

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "https://netguard-api-oan9.onrender.com").replace(/\/+$/, "");
const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || "";

export const SNAPSHOTS = {
  dashboard_24: { path: "/api/dashboard?hours=24", ttl: 15 * 60 * 1000 },
  dashboard_72: { path: "/api/dashboard?hours=72", ttl: 15 * 60 * 1000 },
  dashboard_168: { path: "/api/dashboard?hours=168", ttl: 15 * 60 * 1000 },
  intelligence_24: { path: "/api/intelligence?hours=24", ttl: 15 * 60 * 1000 },
  intelligence_72: { path: "/api/intelligence?hours=72", ttl: 15 * 60 * 1000 },
  intelligence_168: { path: "/api/intelligence?hours=168", ttl: 15 * 60 * 1000 },
  censorship: { path: "/api/censorship", ttl: 30 * 60 * 1000 },
  providers_status: { path: "/api/providers/status", ttl: 15 * 60 * 1000 },
  iran_datacenters: { path: "/api/iran/datacenters", ttl: 30 * 60 * 1000 },
};

const CACHE_KEY = "netguard.cache.v3";
const CACHE_VERSION = 3;

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeRow(row, key) {
  const payload = row?.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
    ? row.payload
    : (row && typeof row === "object" ? row : {});
  const collectedAt = row?.collected_at || payload.snapshot_at || payload.collected_at || payload.generated_at || null;
  const collectedMs = collectedAt ? Date.parse(collectedAt) : NaN;
  return {
    ...payload,
    snapshot_at: collectedAt,
    checked_at: payload.checked_at || collectedAt,
    snapshot_status: row?.status || payload.snapshot_status || "unknown",
    source_count: row?.source_count ?? payload.source_count ?? 0,
    snapshot_error: row?.error_code || payload.snapshot_error || null,
    is_stale: !Number.isFinite(collectedMs) || Date.now() - collectedMs > (SNAPSHOTS[key]?.ttl || 0),
    _received_at: Date.now(),
  };
}

function readCache() {
  try {
    if (typeof localStorage === "undefined") return {};
    const parsed = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    if (!parsed || parsed.version !== CACHE_VERSION || !parsed.items || typeof parsed.items !== "object") return {};
    const result = {};
    for (const [key, item] of Object.entries(parsed.items)) {
      if (!SNAPSHOTS[key] || !item || typeof item !== "object") continue;
      result[key] = item;
    }
    return result;
  } catch {
    return {};
  }
}

function persistCache(items) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(CACHE_KEY, JSON.stringify({ version: CACHE_VERSION, items }));
  } catch {
    // Storage is optional. Live data must remain usable if it is disabled or full.
  }
}

function isFresh(key, record) {
  if (!record) return false;
  const timestamp = Date.parse(record.snapshot_at || "");
  return Number.isFinite(timestamp) && Date.now() - timestamp < SNAPSHOTS[key].ttl;
}

function createInitialStatuses(items) {
  const result = {};
  for (const key of Object.keys(SNAPSHOTS)) {
    result[key] = {
      loading: false,
      error: null,
      updatedAt: items[key]?.snapshot_at || null,
      source: items[key] ? "cache" : null,
    };
  }
  return result;
}

export function useNetguardData() {
  const cacheRef = useRef(null);
  if (cacheRef.current === null) cacheRef.current = readCache();
  const initialItems = cacheRef.current;

  const [items, setItems] = useState(initialItems);
  const [statuses, setStatuses] = useState(() => createInitialStatuses(initialItems));
  const itemsRef = useRef(initialItems);
  const inFlight = useRef(new Map());

  const loadOne = useCallback(async (key, force = false) => {
    const config = SNAPSHOTS[key];
    if (!config) return null;
    if (!force && isFresh(key, itemsRef.current[key])) return itemsRef.current[key];
    if (inFlight.current.has(key)) return inFlight.current.get(key);

    setStatuses((current) => ({
      ...current,
      [key]: { ...current[key], loading: true, error: null },
    }));

    const request = (async () => {
      try {
        const row = await fetchSnapshotWithFallback(
          {
            datasetKey: key,
            apiUrl: API_BASE + config.path,
            supabaseUrl: SUPABASE_URL,
            supabaseKey: SUPABASE_KEY,
          },
          { timeoutMs: 8000, maxAttempts: 2, retryDelayMs: 400 },
        );
        const normalized = normalizeRow(row, key);
        const next = { ...itemsRef.current, [key]: normalized };
        itemsRef.current = next;
        setItems(next);
        persistCache(next);
        setStatuses((current) => ({
          ...current,
          [key]: {
            loading: false,
            error: null,
            updatedAt: normalized.snapshot_at,
            source: "live",
          },
        }));
        return normalized;
      } catch (error) {
        const message = error?.message || "دریافت این بخش ناموفق بود.";
        setStatuses((current) => ({
          ...current,
          [key]: {
            ...current[key],
            loading: false,
            error: message,
            source: current[key].source || null,
          },
        }));
        return null;
      } finally {
        inFlight.current.delete(key);
      }
    })();

    inFlight.current.set(key, request);
    return request;
  }, []);

  const load = useCallback(async (keys, force = false) => {
    const uniqueKeys = [...new Set(safeArray(keys))].filter((key) => SNAPSHOTS[key]);
    return Promise.allSettled(uniqueKeys.map((key) => loadOne(key, force)));
  }, [loadOne]);

  const refreshPage = useCallback((page, hours, force = false) => {
    if (page === "overview") return load(["dashboard_" + hours, "intelligence_" + hours], force);
    if (page === "censorship") return load(["censorship"], force);
    if (page === "providers") return load(["providers_status", "iran_datacenters"], force);
    if (page === "intelligence") return load(["intelligence_" + hours], force);
    if (page === "method") return Promise.resolve([]);
    return load(["dashboard_" + hours], force);
  }, [load]);

  const dashboardKey = "dashboard_24";
  const dashboard = items[dashboardKey] || null;

  return {
    items,
    statuses,
    dashboard,
    load,
    refreshPage,
  };
}

export function getRecordStatus(key, statuses, record) {
  const status = statuses?.[key] || {};
  const ttl = SNAPSHOTS[key]?.ttl || 0;
  const timestamp = Date.parse(record?.snapshot_at || "");
  const stale = !Number.isFinite(timestamp) || Date.now() - timestamp > ttl;
  return {
    ...status,
    stale,
    hasData: Boolean(record),
    ageMs: Number.isFinite(timestamp) ? Math.max(0, Date.now() - timestamp) : null,
  };
}

export function formatFaNumber(value, digits = 1) {
  if (value === null || value === undefined || value === "") return "—";
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return new Intl.NumberFormat("fa-IR", { maximumFractionDigits: digits }).format(number);
}

export function formatTime(value, withDate = true) {
  if (!value) return "نامشخص";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "نامشخص";
  return new Intl.DateTimeFormat("fa-IR", {
    timeZone: "Asia/Tehran",
    ...(withDate ? { month: "short", day: "2-digit" } : {}),
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function safeText(value, fallback = "نامشخص") {
  return typeof value === "string" && value.trim() ? value : fallback;
}

export function asArray(value) {
  return safeArray(value);
}
