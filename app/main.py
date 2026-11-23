from __future__ import annotations

import json
import logging
import os
import subprocess
import sys
from time import monotonic
from datetime import datetime, timedelta, timezone
from typing import Any
import uuid
from urllib.parse import quote

import httpx
from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from netguard.analysis import analyze_dashboard

logger = logging.getLogger("netguard.api")


def _supabase_config() -> tuple[str, str]:
    project_url = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
    # Prefer the least-privileged public key. Server-side secret keys are never
    # sent to the browser and are not required for this read-only API.
    public_key = (
        os.getenv("SUPABASE_PUBLISHABLE_KEY", "").strip()
        or os.getenv("SUPABASE_ANON_KEY", "").strip()
        or os.getenv("SUPABASE_SECRET_KEY", "").strip()
        or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    )
    if not project_url.startswith("https://") or not public_key:
        raise HTTPException(
            status_code=503,
            detail="Supabase public connection is not configured on the API service.",
        )
    return project_url, public_key


def _auth_headers(key: str) -> dict[str, str]:
    headers = {"apikey": key, "Accept": "application/json"}
    if key.startswith("eyJ"):
        headers["Authorization"] = f"Bearer {key}"
    return headers


def _read_view(
    client: httpx.Client,
    project_url: str,
    key: str,
    view: str,
    params: dict[str, str],
) -> list[dict[str, Any]]:
    response = client.get(
        f"{project_url}/rest/v1/{view}",
        params=params,
        headers=_auth_headers(key),
    )
    response.raise_for_status()
    result = response.json()
    if not isinstance(result, list):
        raise ValueError(f"Supabase view {view} returned a non-list response")
    return result


def _read_view_all(
    client: httpx.Client,
    project_url: str,
    key: str,
    view: str,
    params: dict[str, str],
    *,
    page_size: int = 1000,
    max_rows: int = 12000,
) -> list[dict[str, Any]]:
    """Read a bounded view in stable pages so PostgREST max_rows cannot silently truncate history."""
    collected: list[dict[str, Any]] = []
    offset = 0
    while offset < max_rows:
        page_params = {
            **params,
            "limit": str(min(page_size, max_rows - offset)),
            "offset": str(offset),
        }
        batch = _read_view(client, project_url, key, view, page_params)
        collected.extend(batch)
        if len(batch) < int(page_params["limit"]):
            break
        offset += len(batch)
    return collected


app = FastAPI(
    title="NetGuard API",
    description="Read-only API for the NetGuard Iran internet monitoring dashboard.",
    version="1.1.0",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "OPTIONS"],
    allow_headers=["Accept", "Content-Type"],
)


def _queue_configured() -> bool:
    return bool(
        os.getenv("CELERY_BROKER_URL", "").strip()
        or os.getenv("REDIS_URL", "").strip()
    )


@app.get("/health")
def health() -> dict[str, Any]:
    configured = bool(
        os.getenv("SUPABASE_URL", "").strip()
        and (
            os.getenv("SUPABASE_PUBLISHABLE_KEY", "").strip()
            or os.getenv("SUPABASE_ANON_KEY", "").strip()
            or os.getenv("SUPABASE_SECRET_KEY", "").strip()
            or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
        )
    )
    return {
        "status": "ok",
        "database_configured": configured,
        "queue_configured": _queue_configured(),
    }


def _build_dashboard_snapshot(hours: int = 168) -> dict[str, Any]:
    project_url, key = _supabase_config()
    now = datetime.now(timezone.utc)
    since = (now - timedelta(hours=hours)).isoformat()
    timeout = httpx.Timeout(12.0, connect=5.0)
    try:
        with httpx.Client(timeout=timeout, follow_redirects=True) as client:
            sources = _read_view(
                client,
                project_url,
                key,
                "dashboard_sources",
                {"select": "*", "order": "source_id.asc"},
            )
            observations = _read_view_all(
                client,
                project_url,
                key,
                "dashboard_observations",
                {
                    "select": (
                        "source_id,display_name,observed_at,collected_at,value,unit,"
                        "geographic_scope,quality"
                    ),
                    "observed_at": f"gte.{since}",
                    "order": "observed_at.asc,source_id.asc",
                    "limit": "6000",
                },
            )
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("Supabase dashboard read failed (%s)", type(exc).__name__)
        raise HTTPException(
            status_code=502,
            detail="The monitoring database could not return dashboard data.",
        ) from None

    analysis, events = analyze_dashboard(
        sources, observations, generated_at=now, window_hours=hours
    )
    return {
        "sources": sources,
        "observations": observations,
        "analysis": analysis,
        "events": events,
        "generated_at": now.isoformat(),
        "window_hours": hours,
    }


def _build_dashboard_stage(client: httpx.Client) -> dict[str, Any]:
    """Persist one immutable input batch for the independent AI worker."""
    project_url, key = _supabase_config()
    now = datetime.now(timezone.utc)
    sources = _read_view(
        client,
        project_url,
        key,
        "dashboard_sources",
        {"select": "*", "order": "source_id.asc"},
    )
    observations = _read_view_all(
        client,
        project_url,
        key,
        "dashboard_observations",
        {
            "select": (
                "source_id,display_name,observed_at,collected_at,value,unit,"
                "geographic_scope,quality"
            ),
            "observed_at": f"gte.{(now - timedelta(hours=168)).isoformat()}",
            "order": "observed_at.asc,source_id.asc",
            "limit": "6000",
        },
    )
    return {
        "cycle_id": str(uuid.uuid4()),
        "generated_at": now.isoformat(),
        "sources": sources,
        "observations": observations,
        "observation_count": len(observations),
        "cycle_interval_seconds": 600,
    }


_SNAPSHOT_CACHE_TTL_SECONDS = 60
_SNAPSHOT_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
_SNAPSHOT_CACHE_LOCK = __import__("threading").Lock()


def _read_snapshot(dataset_key: str, *, stale_after_seconds: int) -> dict[str, Any]:
    project_url, key = _supabase_config()
    cache_key = f"{project_url}:{dataset_key}"
    now = monotonic()
    with _SNAPSHOT_CACHE_LOCK:
        cached = _SNAPSHOT_CACHE.get(cache_key)
        if cached and now - cached[0] < _SNAPSHOT_CACHE_TTL_SECONDS:
            return dict(cached[1])
    try:
        with httpx.Client(timeout=httpx.Timeout(8.0, connect=4.0)) as client:
            rows = _read_view(
                client, project_url, key, "netguard_snapshots",
                {"select": "payload,collected_at,status,source_count,error_code",
                 "dataset_key": f"eq.{dataset_key}", "limit": "1"},
            )
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("Snapshot read failed for %s (%s)", dataset_key, type(exc).__name__)
        raise HTTPException(status_code=502, detail="دادهٔ ذخیره‌شده فعلاً در دسترس نیست.") from None
    if not rows:
        raise HTTPException(status_code=503, detail="هنوز نخستین snapshot این بخش ثبت نشده است.")
    row = rows[0]
    payload = row.get("payload") or {}
    payload["snapshot_at"] = row.get("collected_at")
    payload.setdefault("checked_at", row.get("collected_at"))
    payload["snapshot_status"] = row.get("status")
    payload["source_count"] = row.get("source_count", 0)
    payload["snapshot_error"] = row.get("error_code")
    payload["stale_after_seconds"] = stale_after_seconds
    try:
        collected = datetime.fromisoformat(str(row.get("collected_at")).replace("Z", "+00:00"))
        payload["is_stale"] = (datetime.now(timezone.utc) - collected).total_seconds() > stale_after_seconds
    except (TypeError, ValueError):
        payload["is_stale"] = True
    with _SNAPSHOT_CACHE_LOCK:
        _SNAPSHOT_CACHE[cache_key] = (monotonic(), payload)
    return payload


def _save_snapshot(
    client: httpx.Client, project_url: str, key: str, token: str,
    dataset_key: str, payload: dict[str, Any], source_count: int,
) -> None:
    response = client.post(
        f"{project_url}/rest/v1/rpc/netguard_save_snapshot",
        headers={**_auth_headers(key), "Content-Type": "application/json"},
        json={
            "p_token": token, "p_dataset_key": dataset_key, "p_payload": payload,
            "p_status": "success", "p_source_count": source_count, "p_error_code": None,
        },
    )
    response.raise_for_status()



_RESTRICTED_TEST_CATEGORIES = {"ALDR", "GMB", "PORN", "DATE", "XED"}
_CATEGORY_LABELS = {
    "CULTR": "فرهنگ و جامعه", "POLR": "دیدگاه و نقد سیاسی", "REL": "مذهب",
    "HUMR": "حقوق بشر", "NEWS": "خبر و رسانه", "MILX": "موضوعات نظامی",
    "ANON": "ابزارهای ناشناس‌سازی", "ECON": "اقتصاد", "COMM": "ارتباطات",
    "FILE": "اشتراک فایل", "HACK": "فناوری و امنیت", "GOVT": "نهادهای دولتی",
    "GRP": "گروه‌ها و سازمان‌ها", "GAME": "بازی و سرگرمی", "HOST": "میزبانی وب",
    "MMED": "رسانه و محتوای چندرسانه‌ای", "ENV": "محیط زیست", "SRCH": "جست‌وجو",
    "CTRL": "کنترل اینترنت", "PUBH": "سلامت عمومی", "COMT": "فناوری و تجارت",
    "HATE": "محتوای نفرت‌پراکن", "IGO": "سازمان‌های بین‌المللی",
    "LGBT": "جامعه و حقوق مدنی", "PROV": "ارائه‌دهندگان خدمات",
}

@app.get("/api/dashboard")
def dashboard(hours: int = 168) -> dict[str, Any]:
    if hours not in (24, 72, 168):
        raise HTTPException(status_code=422, detail="Only precomputed windows are available: 24, 72, or 168 hours.")
    snapshot = _read_snapshot(f"dashboard_{hours}", stale_after_seconds=900)
    # Keep the monitoring read model independent from the AI read model.
    analysis = snapshot.get("analysis")
    if isinstance(analysis, dict) and "intelligence" in analysis:
        snapshot = {**snapshot, "analysis": {
            key: value for key, value in analysis.items() if key != "intelligence"
        }}
    return snapshot


@app.get("/api/intelligence")
def intelligence_snapshot(hours: int = 24) -> dict[str, Any]:
    """Read the latest precomputed AI result; never execute models in the API."""
    if hours not in (24, 72, 168):
        raise HTTPException(status_code=422, detail="Only precomputed windows are available: 24, 72, or 168 hours.")
    snapshot = _read_snapshot(f"dashboard_{hours}", stale_after_seconds=900)
    analysis = snapshot.get("analysis") if isinstance(snapshot.get("analysis"), dict) else {}
    intelligence = analysis.get("intelligence")
    if not isinstance(intelligence, dict):
        raise HTTPException(status_code=503, detail="هنوز خروجی تحلیل هوشمند برای این بازه منتشر نشده است.")
    return {
        "intelligence": intelligence,
        "snapshot_at": snapshot.get("snapshot_at"),
        "generated_at": snapshot.get("generated_at"),
        "analysis_completed_at": snapshot.get("analysis_completed_at"),
        "cycle_id": snapshot.get("analysis_cycle_id") or snapshot.get("cycle_id"),
        "snapshot_status": snapshot.get("snapshot_status"),
        "is_stale": snapshot.get("is_stale", True),
        "stale_after_seconds": snapshot.get("stale_after_seconds", 900),
    }


def _build_censorship_snapshot() -> dict[str, Any]:
    """Return OONI evidence and the safe Citizen Lab test candidates separately."""
    project_url, key = _supabase_config()
    timeout = httpx.Timeout(15.0, connect=5.0)
    try:
        with httpx.Client(timeout=timeout, follow_redirects=True) as client:
            domains = _read_view(
                client, project_url, key, "censored_domains",
                {"select": "*", "order": "confirmed_measurements.desc,last_observed_at.desc", "limit": "5000"},
            )
            test_domains = _read_view(
                client, project_url, key, "censorship_test_domains",
                {"select": "domain,category_code,category_description,source_url,updated_at",
                 "order": "domain.asc", "limit": "2000"},
            )
            runs = _read_view(
                client, project_url, key, "censorship_sync_runs",
                {"select": "started_at,finished_at,status,records_received,error_code,"
                          "test_list_records_received,test_list_error_code",
                 "order": "started_at.desc", "limit": "1"},
            )
            coverage_rows = _read_view(
                client, project_url, key, "censorship_coverage", {"select": "*", "limit": "1"},
            )
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("Censorship data read failed (%s)", type(exc).__name__)
        raise HTTPException(status_code=502, detail="Censorship monitoring data is temporarily unavailable.") from None

    def safe_category(code: Any) -> bool:
        return str(code or "").upper() not in _RESTRICTED_TEST_CATEGORIES

    observed: dict[str, dict[str, Any]] = {}
    for item in domains:
        domain = item.get("domain")
        code = str(item.get("category_code") or "").upper()
        if not isinstance(domain, str) or not domain or not safe_category(code):
            continue
        item["candidate_only"] = False
        item["has_measurements"] = True
        item["in_test_list"] = False
        item["category_label"] = _CATEGORY_LABELS.get(code, "سایر موضوعات")
        item["classification_label"] = (
            "مسدودیت تأییدشده" if item.get("confirmed_blocked")
            else "نشانهٔ اختلال؛ نیازمند بررسی"
        )
        item["source_url"] = (
            "https://explorer.ooni.org/search?probe_cc=IR&domain=" + quote(domain, safe="")
        )
        observed[domain] = item

    candidates: dict[str, dict[str, Any]] = {}
    for row in test_domains:
        domain = row.get("domain")
        code = str(row.get("category_code") or "").upper()
        if not isinstance(domain, str) or not domain or not safe_category(code):
            continue
        candidates[domain] = row
        if domain in observed:
            observed[domain]["in_test_list"] = True
            if not observed[domain].get("category_code"):
                observed[domain]["category_code"] = code
                observed[domain]["category_label"] = _CATEGORY_LABELS.get(code, "سایر موضوعات")
            continue
        observed[domain] = {
            "domain": domain, "confirmed_blocked": False, "confirmed_measurements": 0,
            "anomaly_measurements": 0, "probe_networks": 0, "measurement_count": 0,
            "measurements_with_asn": 0, "asn_coverage_percent": 0,
            "candidate_only": True, "has_measurements": False, "in_test_list": True,
            "category_code": code, "category_label": _CATEGORY_LABELS.get(code, "سایر موضوعات"),
            "classification_label": "در فهرست آزمون؛ هنوز نتیجهٔ تازه‌ای نداریم",
            "last_observed_at": None, "source_url": row.get("source_url")
                or "https://github.com/citizenlab/test-lists/blob/master/lists/ir.csv",
        }

    coverage = coverage_rows[0] if coverage_rows else {}
    sync = runs[0] if runs else None
    safe_observed_count = sum(1 for item in observed.values() if item.get("has_measurements"))
    confirmed_count = sum(1 for item in observed.values() if item.get("confirmed_blocked"))
    anomaly_count = sum(1 for item in observed.values()
                        if item.get("has_measurements") and not item.get("confirmed_blocked"))
    candidate_only_count = sum(1 for item in observed.values() if item.get("candidate_only"))
    return {
        "domains": sorted(observed.values(),
                          key=lambda item: (not bool(item.get("confirmed_blocked")),
                                            not bool(item.get("has_measurements")),
                                            -(int(item.get("measurement_count") or 0)))),
        "total_domains_observed": safe_observed_count,
        "total_test_domains": len(candidates),
        "candidate_domains_not_recently_tested": candidate_only_count,
        "confirmed_domain_count": confirmed_count,
        "anomaly_domain_count": anomaly_count,
        "coverage": coverage,
        "scope_note": (
            "این صفحه دو نوع داده را جدا نشان می‌دهد: آزمون‌های واقعی OONI از داخل ایران و "
            "دامنه‌هایی که در فهرست پژوهشی Citizen Lab برای آزمایش قرار گرفته‌اند. "
            "فقط نتیجهٔ دارای نشانهٔ مسدودسازی در OONI «تأییدشده» است؛ فهرست پژوهشی به‌تنهایی "
            "فیلتر بودن را ثابت نمی‌کند. نبود نتیجه یعنی وضعیت نامشخص، نه دسترسی آزاد."
        ),
        "sync": sync,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "lookback_days": 90,
        "test_list_source": "https://github.com/citizenlab/test-lists/blob/master/lists/ir.csv",
    }


@app.get("/api/censorship")
def censorship() -> dict[str, Any]:
    return _read_snapshot("censorship", stale_after_seconds=1800)


_PROVIDER_STATUSPAGES = (
    {"id": "cloudflare", "name": "Cloudflare", "group": "infrastructure",
     "description": "شبکهٔ جهانی لبه و مراکز حضور؛ وضعیت شهرها به‌صورت جداگانه بررسی می‌شود.",
     "api": "https://www.cloudflarestatus.com/api/v2/summary.json",
     "url": "https://www.cloudflarestatus.com/"},
    {"id": "digitalocean", "name": "DigitalOcean", "group": "infrastructure",
     "description": "زیرساخت ابری و ماشین‌های مجازی.",
     "api": "https://status.digitalocean.com/api/v2/summary.json",
     "url": "https://status.digitalocean.com/"},
    {"id": "render", "name": "Render", "group": "infrastructure",
     "description": "میزبانی برنامه‌ها و سرویس‌های وب.",
     "api": "https://status.render.com/api/v2/summary.json",
     "url": "https://status.render.com/"},
    {"id": "supabase", "name": "Supabase", "group": "infrastructure",
     "description": "پایگاه داده و خدمات پشتیبان برنامه‌ها.",
     "api": "https://status.supabase.com/api/v2/summary.json",
     "url": "https://status.supabase.com/"},
    {"id": "openai", "name": "OpenAI", "group": "ai",
     "description": "سرویس‌های هوش مصنوعی و رابط‌های برنامه‌نویسی.",
     "api": "https://status.openai.com/api/v2/summary.json",
     "url": "https://status.openai.com/"},
    {"id": "anthropic", "name": "Anthropic", "group": "ai",
     "description": "سرویس‌های Claude و رابط برنامه‌نویسی.",
     "api": "https://status.anthropic.com/api/v2/summary.json",
     "url": "https://status.anthropic.com/"},
    {"id": "huggingface", "name": "Hugging Face", "group": "ai",
     "description": "میزبانی مدل‌ها، مجموعه‌داده‌ها و ابزارهای یادگیری ماشین.",
     "api": "https://status.huggingface.co/api/v2/summary.json",
     "url": "https://status.huggingface.co/"},
    {"id": "github", "name": "GitHub", "group": "developer",
     "description": "مخزن کد، همکاری تیمی و سرویس‌های توسعه.",
     "api": "https://www.githubstatus.com/api/v2/summary.json",
     "url": "https://www.githubstatus.com/"},
)
_PROVIDER_CACHE: dict[str, Any] = {"expires_at": 0.0, "payload": None}
_PROVIDER_CACHE_LOCK = __import__("threading").Lock()
_PROVIDER_STATUS_ORDER = {
    "operational": 0, "under_maintenance": 1, "degraded_performance": 2,
    "partial_outage": 3, "major_outage": 4,
}
_PROVIDER_STATUS_LABELS = {
    "operational": "عادی", "under_maintenance": "تعمیرات برنامه‌ریزی‌شده",
    "degraded_performance": "کندی یا افت کیفیت", "partial_outage": "اختلال بخشی",
    "major_outage": "اختلال گسترده", "unknown": "نامشخص",
}


def _fetch_statuspage_provider(provider: dict[str, str]) -> dict[str, Any]:
    checked_at = datetime.now(timezone.utc).isoformat()
    try:
        response = httpx.get(
            provider["api"], timeout=httpx.Timeout(6.0, connect=3.0),
            follow_redirects=True, headers={"Accept": "application/json", "User-Agent": "NetGuard/1.0"},
        )
        response.raise_for_status()
        payload = response.json()
        status = payload.get("status") or {}
        indicator = str(status.get("indicator") or "unknown").lower()
        indicator_map = {
            "none": "operational", "minor": "degraded_performance",
            "major": "major_outage", "critical": "major_outage",
            "maintenance": "under_maintenance",
        }
        overall = indicator_map.get(indicator, "unknown")
        components = payload.get("components") or []
        normalized = []
        for component in components:
            raw_status = str(component.get("status") or "unknown").lower()
            name = str(component.get("name") or "")
            if not name:
                continue
            normalized.append({
                "name": name, "status": raw_status,
                "status_label": _PROVIDER_STATUS_LABELS.get(raw_status, "نامشخص"),
                "updated_at": component.get("updated_at"),
            })
        component_worst = max(
            (_PROVIDER_STATUS_ORDER.get(item["status"], 0) for item in normalized),
            default=0,
        )
        overall_order = _PROVIDER_STATUS_ORDER.get(overall, 0)
        if component_worst > overall_order:
            overall = max(
                (item["status"] for item in normalized),
                key=lambda item: _PROVIDER_STATUS_ORDER.get(item, 0),
            )
        incidents = []
        for incident in (payload.get("incidents") or [])[:8]:
            updates = incident.get("incident_updates") or []
            latest = updates[0] if updates else {}
            incidents.append({
                "name": incident.get("name") or "رخداد اعلام‌شده",
                "status": incident.get("status"),
                "impact": incident.get("impact"),
                "updated_at": latest.get("updated_at") or incident.get("updated_at"),
                "body": str(latest.get("body") or incident.get("shortlink") or "")[:360],
                "url": incident.get("shortlink") or provider["url"],
            })
        locations = [
            item for item in normalized
            if " - (" in item["name"] and item["status"] != "operational"
        ]
        return {
            **{key: provider[key] for key in ("id", "name", "group", "description", "url")},
            "status": overall,
            "status_label": _PROVIDER_STATUS_LABELS.get(overall, "نامشخص"),
            "summary": str(status.get("description") or "")[:240],
            "provider_updated_at": (payload.get("page") or {}).get("updated_at"),
            "checked_at": checked_at,
            "component_count": len(normalized),
            "components_attention": sum(1 for item in normalized if item["status"] != "operational"),
            "data_center_count": sum(1 for item in normalized if " - (" in item["name"]),
            "affected_locations": locations[:30],
            "incidents": incidents,
            "technical_components": normalized[:80],
            "available": True,
        }
    except (httpx.HTTPError, ValueError, TypeError, KeyError) as exc:
        logger.info("Provider status unavailable for %s (%s)", provider["id"], type(exc).__name__)
        return {
            **{key: provider[key] for key in ("id", "name", "group", "description", "url")},
            "status": "unknown", "status_label": "نامشخص",
            "summary": "وضعیت از صفحهٔ رسمی دریافت نشد.",
            "provider_updated_at": None, "checked_at": checked_at,
            "component_count": 0, "components_attention": 0,
            "data_center_count": 0, "affected_locations": [],
            "incidents": [], "technical_components": [], "available": False,
        }


def _fetch_google_cloud_status() -> dict[str, Any]:
    provider = {
        "id": "google-cloud", "name": "Google Cloud و Vertex AI",
        "group": "infrastructure",
        "description": "زیرساخت ابری گوگل و بخشی از سرویس‌های هوش مصنوعی آن.",
        "url": "https://status.cloud.google.com/",
    }
    checked_at = datetime.now(timezone.utc).isoformat()
    try:
        response = httpx.get(
            "https://status.cloud.google.com/incidents.json",
            timeout=httpx.Timeout(6.0, connect=3.0), follow_redirects=True,
            headers={"Accept": "application/json", "User-Agent": "NetGuard/1.0"},
        )
        response.raise_for_status()
        payload = response.json()
        now = datetime.now(timezone.utc)
        active: list[dict[str, Any]] = []
        recently_resolved: list[dict[str, Any]] = []
        for incident in payload if isinstance(payload, list) else []:
            updates = incident.get("updates") or []
            end = incident.get("end")
            begin = incident.get("begin")
            if not begin:
                continue
            try:
                begin_dt = datetime.fromisoformat(str(begin).replace("Z", "+00:00"))
                if begin_dt.tzinfo is None:
                    begin_dt = begin_dt.replace(tzinfo=timezone.utc)
            except ValueError:
                continue
            if not end:
                active.append(incident)
            elif now - begin_dt <= timedelta(days=30):
                recently_resolved.append(incident)

        incidents = []
        for incident in (active + recently_resolved)[:8]:
            updates = incident.get("updates") or []
            latest = updates[-1] if updates else {}
            is_active = not incident.get("end")
            incidents.append({
                "name": incident.get("external_desc") or incident.get("service_name") or "رخداد اعلام‌شده",
                "status": "active" if is_active else "resolved",
                "impact": "در حال بررسی" if is_active else "پایان‌یافته",
                "updated_at": latest.get("created") or incident.get("modified"),
                "body": str(latest.get("text") or "")[:360],
                "url": provider["url"],
            })
        return {
            **provider,
            "status": "degraded_performance" if active else "operational",
            "status_label": "اختلال اعلام‌شده" if active else "بدون رخداد فعال اعلام‌شده",
            "summary": (f"{len(active)} رخداد فعال" if active else "در فهرست رسمی، رخداد فعالی اعلام نشده است."),
            "provider_updated_at": None, "checked_at": checked_at,
            "component_count": 0, "components_attention": len(active),
            "data_center_count": 0, "affected_locations": [],
            "incidents": incidents, "technical_components": [],
            "available": True,
        }
    except (httpx.HTTPError, ValueError, TypeError) as exc:
        logger.info("Google Cloud status unavailable (%s)", type(exc).__name__)
        return {
            **provider, "status": "unknown", "status_label": "نامشخص",
            "summary": "وضعیت از فهرست رسمی رخدادها دریافت نشد.",
            "provider_updated_at": None, "checked_at": checked_at,
            "component_count": 0, "components_attention": 0,
            "data_center_count": 0, "affected_locations": [],
            "incidents": [], "technical_components": [], "available": False,
        }


def _build_iran_datacenters_snapshot() -> dict[str, Any]:
    project_url, key = _supabase_config()
    try:
        with httpx.Client(timeout=httpx.Timeout(8.0, connect=4.0)) as client:
            sites = _read_view(
                client, project_url, key, "iran_datacenters",
                {"select": "site_id,name,operator,city,province,asset_type,evidence_level,source_name,source_url,monitoring_status,status_label,last_checked_at,notes",
                 "order": "city.asc,name.asc", "limit": "500"},
            )
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("Iran datacenter inventory read failed (%s)", type(exc).__name__)
        raise HTTPException(status_code=502, detail="فهرست مراکز دادهٔ ایران فعلاً در دسترس نیست.") from None
    for site in sites:
        site["live_status_available"] = False
        site["status_label"] = site.get("status_label") or "پایش مستقیم فعال نیست"
    return {
        "sites": sites,
        "total_sites": len(sites),
        "directly_monitored": sum(1 for site in sites if site.get("live_status_available")),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "scope_note": (
            "این فهرست، موجودی اولیهٔ مراکز و مکان‌های میزبانیِ مستندشده یا ثبت‌شده در دایرکتوری‌هاست. "
            "در حال حاضر برای این سایت‌ها نقطهٔ سنجش مستقل داخل ایران در NetGuard نداریم؛ بنابراین "
            "وضعیت عملیاتی آن‌ها نامشخص است و از روی سالم بودن وب‌سایت اپراتور نتیجه‌گیری نمی‌شود."
        ),
    }


@app.get("/api/iran/datacenters")
def iran_datacenters() -> dict[str, Any]:
    return _read_snapshot("iran_datacenters", stale_after_seconds=1800)


@app.get("/api/providers/status")
def providers_status() -> dict[str, Any]:
    return _read_snapshot("providers_status", stale_after_seconds=900)




@app.post("/internal/collect-snapshots")
def collect_snapshots(x_netguard_token: str = Header(default="")) -> dict[str, Any]:
    expected = os.getenv("NETGUARD_COLLECTOR_TOKEN", "")
    if not expected or not x_netguard_token or not __import__("hmac").compare_digest(x_netguard_token, expected):
        raise HTTPException(status_code=401, detail="unauthorized")
    project_url, key = _supabase_config()
    completed: list[str] = []
    failures: list[dict[str, str]] = []
    staged_cycle_id: str | None = None
    try:
        with httpx.Client(timeout=httpx.Timeout(35.0, connect=6.0), follow_redirects=True) as client:
            try:
                dashboard_stage = _build_dashboard_stage(client)
                _save_snapshot(
                    client, project_url, key, x_netguard_token,
                    "dashboard_staging", dashboard_stage,
                    len(dashboard_stage.get("sources", [])),
                )
                staged_cycle_id = dashboard_stage["cycle_id"]
                completed.append("dashboard_staging")
            except Exception as exc:
                logger.exception("Dashboard data staging failed")
                failures.append({"dataset": "dashboard_staging", "error": type(exc).__name__})

            try:
                payload = _build_censorship_snapshot()
                _save_snapshot(client, project_url, key, x_netguard_token, "censorship", payload, len(payload.get("domains", [])))
                completed.append("censorship")
            except Exception as exc:
                logger.exception("Snapshot build failed for censorship")
                failures.append({"dataset": "censorship", "error": type(exc).__name__})
            try:
                payload = _build_iran_datacenters_snapshot()
                _save_snapshot(client, project_url, key, x_netguard_token, "iran_datacenters", payload, len(payload.get("sites", [])))
                completed.append("iran_datacenters")
            except Exception as exc:
                logger.exception("Snapshot build failed for Iranian data centers")
                failures.append({"dataset": "iran_datacenters", "error": type(exc).__name__})
    except httpx.HTTPError:
        logger.exception("Snapshot persistence failed")
        raise HTTPException(status_code=502, detail="snapshot_persistence_failed") from None
    return {
        "status": "success" if not failures else "partial",
        "completed": completed,
        "failures": failures,
        "staged_cycle_id": staged_cycle_id,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


@app.post("/internal/analyze-dashboard-cycle")
def analyze_dashboard_cycle(x_netguard_token: str = Header(default="")) -> dict[str, Any]:
    """Queue AI work when Redis is configured; retain a safe transition fallback."""
    expected = os.getenv("NETGUARD_COLLECTOR_TOKEN", "")
    if not expected or not x_netguard_token or not __import__("hmac").compare_digest(x_netguard_token, expected):
        raise HTTPException(status_code=401, detail="unauthorized")

    if _queue_configured():
        try:
            from netguard.tasks import analyze_dashboard_cycle_task

            queued = analyze_dashboard_cycle_task.delay()
        except Exception as exc:
            logger.exception("Could not enqueue the AI analysis task (%s)", type(exc).__name__)
            raise HTTPException(status_code=503, detail="analysis_queue_unavailable") from None
        return {"status": "queued", "task_id": queued.id}

    # Backward-compatible path until the Redis broker and worker are provisioned.
    try:
        result = subprocess.run(
            [sys.executable, "-m", "netguard.ai_worker"],
            check=False,
            capture_output=True,
            text=True,
            timeout=105,
        )
    except subprocess.TimeoutExpired:
        logger.error("AI analysis worker exceeded the 105-second execution budget")
        raise HTTPException(status_code=504, detail="analysis_worker_timeout") from None
    if result.returncode != 0:
        logger.error("AI analysis worker failed: %s", (result.stderr or "")[-1600:])
        raise HTTPException(status_code=500, detail="analysis_worker_failed")
    lines = [line for line in (result.stdout or "").splitlines() if line.strip()]
    if not lines:
        raise HTTPException(status_code=500, detail="analysis_worker_empty_response")
    try:
        payload = json.loads(lines[-1])
    except json.JSONDecodeError:
        logger.error("AI worker returned invalid JSON")
        raise HTTPException(status_code=500, detail="analysis_worker_invalid_response") from None
    if payload.get("status") == "published":
        project_url, _ = _supabase_config()
        with _SNAPSHOT_CACHE_LOCK:
            for cache_key in tuple(_SNAPSHOT_CACHE):
                if cache_key.startswith(f"{project_url}:dashboard_"):
                    _SNAPSHOT_CACHE.pop(cache_key, None)
    return payload
