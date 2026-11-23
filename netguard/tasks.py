from __future__ import annotations

import logging

import httpx

from netguard.ai_worker import run_once
from netguard.celery_app import celery_app

logger = logging.getLogger("netguard.tasks")


@celery_app.task(
    bind=True,
    name="netguard.analyze_dashboard_cycle",
    autoretry_for=(httpx.HTTPError,),
    retry_backoff=True,
    retry_jitter=True,
    max_retries=3,
)
def analyze_dashboard_cycle_task(self):
    """Run one staged AI cycle outside the FastAPI request process."""
    result = run_once()
    logger.info(
        "AI cycle finished with status=%s cycle_id=%s",
        result.get("status"),
        result.get("cycle_id"),
    )
    return result
