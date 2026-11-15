from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import quote

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from netguard.analysis import analyze_dashboard
from netguard.ml import analyze_intelligence

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
    return {"status": "ok", "database_configured": configured}


@app.get("/api/dashboard")
def dashboard(
    hours: int = Query(default=168, ge=6, le=168),
) -> dict[str, Any]:
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
            observations = _read_view(
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
                    "order": "observed_at.asc",
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
    analysis["intelligence"] = analyze_intelligence(
        sources, observations, now=now
    )
    return {
        "sources": sources,
        "observations": observations,
        "analysis": analysis,
        "events": events,
        "generated_at": now.isoformat(),
        "window_hours": hours,
    }


@app.get("/api/censorship")
def censorship() -> dict[str, Any]:
    """Return cached OONI measurements collected from probes inside Iran."""
    project_url, key = _supabase_config()
    timeout = httpx.Timeout(12.0, connect=5.0)
    try:
        with httpx.Client(timeout=timeout, follow_redirects=True) as client:
            domains = _read_view(
                client,
                project_url,
                key,
                "censored_domains",
                {
                    "select": "*",
                    "order": "confirmed_measurements.desc,last_observed_at.desc",
                    "limit": "5000",
                },
            )
            runs = _read_view(
                client,
                project_url,
                key,
                "censorship_sync_runs",
                {
                    "select": "started_at,finished_at,status,records_received,error_code",
                    "order": "started_at.desc",
                    "limit": "1",
                },
            )
            coverage_rows = _read_view(
                client, project_url, key, "censorship_coverage",
                {"select": "*", "limit": "1"},
            )
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("OONI censorship data read failed (%s)", type(exc).__name__)
        raise HTTPException(
            status_code=502,
            detail="Censorship monitoring data is temporarily unavailable.",
        ) from None

    coverage = coverage_rows[0] if coverage_rows else {}
    total_domains_observed = int(coverage.get("domain_count") or len(domains))
    for item in domains:
        domain = item.get("domain")
        if isinstance(domain, str) and domain:
            item["source_url"] = (
                "https://explorer.ooni.org/search?probe_cc=IR&domain="
                + quote(domain, safe="")
            )
        item["classification_label"] = (
            "مسدودیت تأییدشده" if item.get("confirmed_blocked")
            else "ناهنجاری؛ نیازمند بررسی"
        )
    return {
        "domains": domains,
        "total_domains_observed": total_domains_observed,
        "coverage": coverage,
        "scope_note": (
            "همهٔ دامنه‌های دارای نتیجهٔ تأییدشده یا ناهنجاری در آزمون Web Connectivity "
            "OONI طی ۹۰ روز اخیر نمایش داده می‌شوند؛ این فهرست کل وب‌سایت‌های فیلترشدهٔ ایران "
            "نیست و فقط شبکه‌هایی را پوشش می‌دهد که در آزمون‌ها مشارکت کرده‌اند. "
            "نبود یک دامنه در این فهرست، اثبات دسترسی آزاد نیست."
        ),
        "sync": runs[0] if runs else None,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "lookback_days": 90,
    }
