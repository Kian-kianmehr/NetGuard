from __future__ import annotations

import os

from celery import Celery


broker_url = (
    os.getenv("CELERY_BROKER_URL", "").strip()
    or os.getenv("REDIS_URL", "").strip()
    or "memory://"
)

celery_app = Celery(
    "netguard",
    broker=broker_url,
    include=["netguard.tasks"],
)

celery_app.conf.update(
    accept_content=["json"],
    task_serializer="json",
    result_serializer="json",
    task_ignore_result=True,
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,
    broker_connection_retry_on_startup=True,
    broker_transport_options={"visibility_timeout": 3600},
    task_soft_time_limit=180,
    task_time_limit=210,
    timezone="UTC",
    enable_utc=True,
)
