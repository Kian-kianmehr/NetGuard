from __future__ import annotations

import asyncio
import math
import os
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"
IODA_BASE_URL = os.getenv(
    "IODA_BASE_URL",
    "https://api.ioda.inetintel.cc.gatech.edu/v2",
).rstrip("/")
COUNTRY_CODE = os.getenv("NETGUARD_COUNTRY_CODE", "IR").upper()
CACHE_TTL_SECONDS = int(os.getenv("CACHE_TTL_SECONDS", "90"))
MAX_POINTS = 500

SOURCES = {
    "bgp": {
        "label": "BGP visibility",
        "unit": "Visible IPv4 /24s",
        "description": "Routed IPv4 network visibility observed through BGP.",
    },
    "ping-slash24": {
        "label": "Active probing",
        "unit": "Reachable IPv4 /24s",
        "description": "IPv4 /24 networks responding to IODA active probing.",
    },
    "merit-nt": {
        "label": "Network telescope",
        "unit": "Unique source IPs",
        "description": "Unique source IP addresses observed by the Merit network telescope.",
    },
}

app = FastAPI(
    title="NetGuard API",
    description="Public internet measurement dashboard for Iran, powered by IODA.",
    version="0.1.0",
)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

_cache: dict[int, tuple[float, dict[str, Any]]] = {}
_cache_lock = asyncio.Lock()


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
    matching = [
        item for item in candidates
        if item.get("datasource") == source
    ]
    if not matching:
        raise ValueError("IODA returned no time series for this source.")

    points: dict[int, float | None] = {}
    for item in matching:
        values = item.get("values")
        start = item.get("from")
        step = item.get("step")
        if (
            not isinstance(values, list)
            or not isinstance(start, int)
            or isinstance(start, bool)
            or not isinstance(step, int)
            or isinstance(step, bool)
            or step <= 0
        ):
            continue

        for index, raw_value in enumerate(values):
            timestamp = start + index * step
            if raw_value is None:
                points[timestamp] = None
            elif (
                isinstance(raw_value, (int, float))
                and not isinstance(raw_value, bool)
                and math.isfinite(raw_value)
            ):
                points[timestamp] = float(raw_value)

    if not points:
        raise ValueError("IODA returned no valid numeric observations.")

    ordered = sorted(points.items())
    valid = [(timestamp, value) for timestamp, value in ordered if value is not None]
    latest_timestamp, latest_value = valid[-1] if valid else (None, None)
    metadata = SOURCES[source]

    return {
        "id": source,
        "label": metadata["label"],
        "unit": metadata["unit"],
        "description": metadata["description"],
        "points": [
            {"timestamp": timestamp, "value": value}
            for timestamp, value in ordered
        ],
        "latest": latest_value,
        "latest_at": latest_timestamp,
        "observations": len(ordered),
        "missing": len(ordered) - len(valid),
        "status": "available" if valid else "no_data",
    }


async def _fetch_source(
    client: httpx.AsyncClient,
    source: str,
    start: int,
    end: int,
) -> dict[str, Any]:
    response = await client.get(
        f"{IODA_BASE_URL}/signals/raw/country/{COUNTRY_CODE}",
        params={
            "from": start,
            "until": end,
            "datasource": source,
            "maxPoints": MAX_POINTS,
        },
    )
    response.raise_for_status()
    return _normalise_series(response.json(), source)


async def _build_dashboard(hours: int) -> dict[str, Any]:
    end = datetime.now(timezone.utc)
    start = end - timedelta(hours=hours)
    start_timestamp = int(start.timestamp())
    end_timestamp = int(end.timestamp())

    async with httpx.AsyncClient(timeout=20.0) as client:
        results = await asyncio.gather(
            *[
                _fetch_source(client, source, start_timestamp, end_timestamp)
                for source in SOURCES
            ],
            return_exceptions=True,
        )

    series = []
    errors = []
    for source, result in zip(SOURCES, results):
        if isinstance(result, Exception):
            errors.append({
                "source": source,
                "message": str(result)[:240],
            })
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
        "feed_status": (
            "available" if series and not errors
            else "partial" if series
            else "unavailable"
        ),
        "notice": (
            "These are network measurement signals, not a direct measurement "
            "of every user's internet experience. Missing observations are "
            "not treated as zero, and a single signal does not prove filtering "
            "or identify the cause of an outage."
        ),
    }


@app.get("/", include_in_schema=False)
async def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "netguard-api"}


@app.get("/api/dashboard")
async def dashboard(
    hours: int = Query(default=24, ge=6, le=168),
    refresh: bool = Query(default=False),
) -> dict[str, Any]:
    now = time.monotonic()
    async with _cache_lock:
        cached = _cache.get(hours)
        if not refresh and cached and now - cached[0] < CACHE_TTL_SECONDS:
            return cached[1]

    try:
        data = await _build_dashboard(hours)
    except httpx.HTTPError as error:
        raise HTTPException(
            status_code=502,
            detail=f"IODA data provider is temporarily unavailable: {error}",
        ) from error

    async with _cache_lock:
        _cache[hours] = (time.monotonic(), data)
    return data
