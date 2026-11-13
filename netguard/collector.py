from __future__ import annotations

import logging
import time
import uuid
from datetime import datetime, timezone
from typing import Any
import httpx

from netguard import __version__
from netguard.config import SOURCES, Settings, Source
from netguard.ioda import IODAClient
from netguard.storage import SupabaseREST

logger = logging.getLogger("netguard.collector")


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _safe_error(exc: Exception) -> tuple[str, str]:
    if isinstance(exc, httpx.TimeoutException):
        return "timeout", "درخواست منبع از مهلت تعیین‌شده عبور کرد."
    if isinstance(exc, httpx.HTTPStatusError):
        return "upstream_http_error", f"منبع با وضعیت HTTP {exc.response.status_code} پاسخ داد."
    if isinstance(exc, httpx.RequestError):
        return "network_error", "ارتباط با منبع داده برقرار نشد."
    if isinstance(exc, ValueError):
        return "invalid_payload", "ساختار دادهٔ دریافتی معتبر نبود."
    return "collector_error", "جمع‌آوری منبع با خطا مواجه شد."


def collect_one(source: Source, ioda: IODAClient,
                storage: SupabaseREST) -> dict[str, Any]:
    started = _utc_now()
    monotonic_start = time.monotonic()
    status, error_code, error_message = "success", None, None
    received = upserted = 0
    try:
        rows = ioda.fetch(source, now=started)
        received = len(rows)
        upserted = storage.upsert_observations(row.payload() for row in rows)
        if not rows:
            status = "no_data"
    except Exception as exc:
        status = "error"
        error_code, error_message = _safe_error(exc)
        logger.warning("Source %s failed (%s)", source.source_id, error_code)

    finished = _utc_now()
    run = {
        "id": str(uuid.uuid4()), "source_id": source.source_id,
        "started_at": _iso(started), "finished_at": _iso(finished),
        "status": status, "records_received": received, "records_upserted": upserted,
        "duration_ms": max(0, int((time.monotonic() - monotonic_start) * 1000)),
        "error_code": error_code, "error_message": error_message,
        "collector_version": __version__,
    }
    storage.insert_run(run)
    return run


def run_collection(settings: Settings | None = None) -> int:
    settings = settings or Settings.from_env()
    ioda = IODAClient(settings)
    storage = SupabaseREST(settings.supabase_url, settings.supabase_secret_key)
    failures = 0
    try:
        for source in SOURCES:
            result = collect_one(source, ioda, storage)
            logger.info("%s status=%s received=%s upserted=%s duration_ms=%s",
                        source.source_id, result["status"],
                        result["records_received"], result["records_upserted"],
                        result["duration_ms"])
            failures += result["status"] == "error"
    finally:
        ioda.close()
        storage.close()
    return 1 if failures else 0
