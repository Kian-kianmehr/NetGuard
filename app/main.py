from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager, suppress
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

logger = logging.getLogger("netguard.api")


def _supabase_config() -> tuple[str, str]:
    project_url = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
    public_key = (
        os.getenv("SUPABASE_PUBLISHABLE_KEY", "").strip()
        or os.getenv("SUPABASE_ANON_KEY", "").strip()
    )
    if not project_url.startswith("https://") or not public_key:
        raise HTTPException(
            status_code=503,
            detail="Supabase public connection is not configured on the API service.",
        )
    return project_url, public_key


def _auth_headers(key: str) -> dict[str, str]:
    headers = {"apikey": key, "Accept": "application/json"}
    # Legacy anon keys are JWTs; current sb_publishable keys are not.
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


def _collector_is_configured() -> bool:
    return bool(
        os.getenv("SUPABASE_URL", "").strip()
        and (
            os.getenv("SUPABASE_SECRET_KEY", "").strip()
            or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
        )
    )


async def _collector_loop() -> None:
    """Collect while the free web instance is awake; it pauses when Render sleeps it."""
    interval = max(60, int(os.getenv("COLLECTOR_INTERVAL_SECONDS", "300")))
    while True:
        if _collector_is_configured():
            try:
                from netguard.collector import run_collection

                exit_code = await asyncio.to_thread(run_collection)
                if exit_code:
                    logger.warning("Collector finished with source errors")
            except Exception as exc:  # Keep the API alive if collection fails.
                logger.error("Collector cycle failed (%s)", type(exc).__name__)
        else:
            logger.info("Collector is idle: Supabase secret is not configured")
        await asyncio.sleep(interval)


@asynccontextmanager
async def lifespan(_: FastAPI):
    task = asyncio.create_task(_collector_loop(), name="netguard-collector")
    try:
        yield
    finally:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task


app = FastAPI(
    title="NetGuard API",
    description="Read-only API for the NetGuard Iran internet monitoring dashboard.",
    version="1.0.0",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "OPTIONS"],
    allow_headers=["Accept", "Content-Type"],
)


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "database_configured": bool(
            os.getenv("SUPABASE_URL", "").strip()
            and (
                os.getenv("SUPABASE_PUBLISHABLE_KEY", "").strip()
                or os.getenv("SUPABASE_ANON_KEY", "").strip()
            )
        ),
        "collector_configured": _collector_is_configured(),
        "collector_interval_seconds": max(
            60, int(os.getenv("COLLECTOR_INTERVAL_SECONDS", "300"))
        ),
    }


@app.get("/api/dashboard")
def dashboard(
    hours: int = Query(default=168, ge=6, le=168),
) -> dict[str, Any]:
    project_url, key = _supabase_config()
    since = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
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
                    "limit": "1800",
                },
            )
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("Supabase dashboard read failed (%s)", type(exc).__name__)
        raise HTTPException(
            status_code=502,
            detail="The monitoring database could not return dashboard data.",
        ) from None

    return {
        "sources": sources,
        "observations": observations,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "window_hours": hours,
    }
