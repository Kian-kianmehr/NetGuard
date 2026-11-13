from __future__ import annotations

import asyncio
import math
import os
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"
IODA_BASE_URL = os.getenv("IODA_BASE_URL", "https://api.ioda.inetintel.cc.gatech.edu/v2").rstrip("/")
COUNTRY_CODE = os.getenv("NETGUARD_COUNTRY_CODE", "IR").upper()
CACHE_TTL_SECONDS = int(os.getenv("CACHE_TTL_SECONDS", "90"))
SOURCE_TIMEOUT_SECONDS = float(os.getenv("SOURCE_TIMEOUT_SECONDS", "5"))
MAX_POINTS = 500

SOURCES = {
    "bgp": {"label": "BGP visibility", "unit": "Visible IPv4 /24s", "description": "Routed IPv4 network visibility observed through BGP."},
    "ping-slash24": {"label": "Active probing", "unit": "Reachable IPv4 /24s", "description": "IPv4 /24 networks responding to IODA active probing."},
    "merit-nt": {"label": "Network telescope", "unit": "Unique source IPs", "description": "Unique source IP addresses observed by the Merit network telescope."},
}

app = FastAPI(title="NetGuard API", description="Public internet measurement dashboard for Iran, powered by IODA.", version="0.2.0")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

_cache: dict[int, tuple[float, dict[str, Any]]] = {}
_refresh_tasks: dict[int, asyncio.Task] = {}
_state_lock = asyncio.Lock()


def _flatten_items(data: Any) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    stack = [data]
    while stack:
        current = stack.pop()
        if isinstance(current, dict):
            if isinstance(current.get("values"), list):
                items.append(current)
            else:
                stack.extend(reversed(list(current.values())))
        elif isinstance(current, list):
            stack.extend(reversed(current))
    return items


def _normalise_series(payload: dict[str, Any], source: str) -> dict[str, Any]:
    if payload.get("error"):
        raise ValueError(str(payload["error"]))
    candidates = _flatten_items(payload.get("data", payload))
    matching = [item for item in candidates if item.get("datasource") == source]
    if not matching:
        raise ValueError("IODA returned no time series for this source.")
    points: dict[int, float | None] = {}
    for item in matching:
        values, start, step = item.get("values"), item.get("from"), item.get("step")
        if not isinstance(values, list) or not isinstance(start, int) or isinstance(start, bool) or not isinstance(step, int) or isinstance(step, bool) or step <= 0:
            continue
        for index, raw in enumerate(values):
            timestamp = start + index * step
            if raw is None:
                points[timestamp] = None
            elif isinstance(raw, (int, float)) and not isinstance(raw, bool) and math.isfinite(raw):
                points[timestamp] = float(raw)
    if not points:
        raise ValueError("IODA returned no valid numeric observations.")
    ordered = sorted(points.items())
    valid = [(ts, value) for ts, value in ordered if value is not None]
    latest_timestamp, latest_value = valid[-1] if valid else (None, None)
    meta = SOURCES[source]
    return {
        "id": source, "label": meta["label"], "unit": meta["unit"], "description": meta["description"],
        "points": [{"timestamp": ts, "value": value} for ts, value in ordered],
        "latest": latest_value, "latest_at": latest_timestamp, "observations": len(valid),
        "missing": len(ordered) - len(valid), "status": "available" if valid else "no_data",
    }


async def _fetch_source(client: httpx.AsyncClient, source: str, start: int, end: int) -> dict[str, Any]:
    response = await client.get(
        f"{IODA_BASE_URL}/signals/raw/country/{COUNTRY_CODE}",
        params={"from": start, "until": end, "datasource": source, "maxPoints": MAX_POINTS},
    )
    response.raise_for_status()
    return _normalise_series(response.json(), source)


async def _build_dashboard(hours: int) -> dict[str, Any]:
    end = datetime.now(timezone.utc)
    start = end - timedelta(hours=hours)
    timeout = httpx.Timeout(SOURCE_TIMEOUT_SECONDS, connect=2.0)
    async with httpx.AsyncClient(timeout=timeout, limits=httpx.Limits(max_connections=6, max_keepalive_connections=3)) as client:
        results = await asyncio.gather(
            *[_fetch_source(client, source, int(start.timestamp()), int(end.timestamp())) for source in SOURCES],
            return_exceptions=True,
        )
    series, errors = [], []
    for source, result in zip(SOURCES, results):
        if isinstance(result, Exception):
            errors.append({"source": source, "message": str(result)[:180] or type(result).__name__})
        else:
            series.append(result)
    return {
        "country": {"code": COUNTRY_CODE, "name": "Iran"},
        "window_hours": hours,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "provider": "IODA — Georgia Tech",
        "provider_url": "https://ioda.inetintel.cc.gatech.edu/",
        "series": series,
        "errors": errors,
        "feed_status": "available" if series and not errors else "partial" if series else "unavailable",
        "refresh_in_progress": False,
        "stale": False,
        "notice": "این شاخص‌ها اندازه‌گیری‌های زیرساختی شبکه‌اند و تجربه مستقیم همه کاربران را نشان نمی‌دهند. داده مفقود صفر نیست و هیچ سیگنال منفردی علت اختلال یا فیلترینگ را اثبات نمی‌کند.",
    }


async def _refresh(hours: int) -> None:
    try:
        data = await _build_dashboard(hours)
        async with _state_lock:
            _cache[hours] = (time.monotonic(), data)
    finally:
        async with _state_lock:
            _refresh_tasks.pop(hours, None)


def _loading_payload(hours: int, cached: dict[str, Any] | None = None) -> dict[str, Any]:
    if cached:
        return {**cached, "stale": True, "refresh_in_progress": True}
    return {
        "country": {"code": COUNTRY_CODE, "name": "ایران"},
        "window_hours": hours,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "provider": "IODA — Georgia Tech",
        "series": [],
        "errors": [],
        "feed_status": "loading",
        "refresh_in_progress": True,
        "stale": False,
        "notice": "ساختار داشبورد آماده است؛ داده‌های منابع در پس‌زمینه دریافت می‌شوند.",
    }


@app.get("/", include_in_schema=False)
async def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "netguard-api"}


@app.get("/api/dashboard")
async def dashboard(hours: int = Query(default=24, ge=6, le=168), refresh: bool = Query(default=False)) -> dict[str, Any]:
    now = time.monotonic()
    async with _state_lock:
        cached_entry = _cache.get(hours)
        cached = cached_entry[1] if cached_entry else None
        fresh = cached_entry and now - cached_entry[0] < CACHE_TTL_SECONDS
        if fresh and not refresh:
            return cached
        task = _refresh_tasks.get(hours)
        if task is None or task.done():
            task = asyncio.create_task(_refresh(hours))
            _refresh_tasks[hours] = task
        return _loading_payload(hours, cached)


