from __future__ import annotations

import json
import logging
import os
import sys
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from netguard.analysis import analyze_dashboard
from netguard.ml import analyze_intelligence

logger = logging.getLogger("netguard.ai_worker")


def _supabase_config() -> tuple[str, str, str]:
    project_url = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
    key = (
        os.getenv("SUPABASE_PUBLISHABLE_KEY", "").strip()
        or os.getenv("SUPABASE_ANON_KEY", "").strip()
        or os.getenv("SUPABASE_SECRET_KEY", "").strip()
        or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    )
    token = os.getenv("NETGUARD_COLLECTOR_TOKEN", "").strip()
    if not project_url.startswith("https://") or not key or len(token) < 40:
        raise RuntimeError("AI worker Supabase configuration is incomplete")
    return project_url, key, token


def _headers(key: str) -> dict[str, str]:
    headers = {"apikey": key, "Accept": "application/json"}
    if key.startswith("eyJ"):
        headers["Authorization"] = f"Bearer {key}"
    return headers


def _parse_time(value: Any) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed.astimezone(timezone.utc)


def build_dashboard_payloads(
    stage: dict[str, Any],
    *,
    analysis_completed_at: datetime | None = None,
) -> dict[str, dict[str, Any]]:
    """Compute one AI result and attach it to every window in the same data cycle."""
    cycle_id = str(stage.get("cycle_id") or "")
    generated_at = _parse_time(stage.get("generated_at"))
    sources = stage.get("sources") or []
    all_observations = stage.get("observations") or []
    if not cycle_id or generated_at is None:
        raise ValueError("Dashboard staging payload has no valid cycle_id/generated_at")

    intelligence = analyze_intelligence(sources, all_observations, now=generated_at)
    completed_at = (analysis_completed_at or datetime.now(timezone.utc)).astimezone(timezone.utc)
    parsed = [
        (timestamp, row)
        for row in all_observations
        if (timestamp := _parse_time(row.get("observed_at"))) is not None
    ]

    payloads: dict[str, dict[str, Any]] = {}
    for hours in (24, 72, 168):
        cutoff = generated_at - timedelta(hours=hours)
        window_observations = [
            row for timestamp, row in parsed if timestamp >= cutoff
        ]
        analysis, events = analyze_dashboard(
            sources,
            window_observations,
            generated_at=generated_at,
            window_hours=hours,
        )
        analysis["intelligence"] = intelligence
        payloads[f"dashboard_{hours}"] = {
            "sources": sources,
            "observations": window_observations,
            "analysis": analysis,
            "events": events,
            "generated_at": generated_at.isoformat(),
            "window_hours": hours,
            "cycle_id": cycle_id,
            "analysis_cycle_id": cycle_id,
            "data_collected_at": generated_at.isoformat(),
            "analysis_completed_at": completed_at.isoformat(),
            "analysis_status": "complete",
        }
    return payloads


def run_once() -> dict[str, Any]:
    project_url, key, token = _supabase_config()
    base_headers = _headers(key)
    with httpx.Client(timeout=httpx.Timeout(35.0, connect=6.0), follow_redirects=True) as client:
        stage_response = client.get(
            f"{project_url}/rest/v1/netguard_snapshots",
            params={
                "select": "payload,collected_at,status,source_count",
                "dataset_key": "eq.dashboard_staging",
                "limit": "1",
            },
            headers=base_headers,
        )
        stage_response.raise_for_status()
        stage_rows = stage_response.json()
        if not stage_rows:
            return {"status": "no_pending_cycle"}

        stage = stage_rows[0].get("payload") or {}
        cycle_id = str(stage.get("cycle_id") or "")
        if not cycle_id:
            raise RuntimeError("Latest dashboard staging row has no cycle_id")

        current_response = client.get(
            f"{project_url}/rest/v1/netguard_snapshots",
            params={
                "select": "payload",
                "dataset_key": "eq.dashboard_24",
                "limit": "1",
            },
            headers=base_headers,
        )
        current_response.raise_for_status()
        current_rows = current_response.json()
        if current_rows and (current_rows[0].get("payload") or {}).get("cycle_id") == cycle_id:
            return {"status": "already_published", "cycle_id": cycle_id}

        payloads = build_dashboard_payloads(stage)
        publish_response = client.post(
            f"{project_url}/rest/v1/rpc/netguard_publish_dashboard_cycle",
            headers={**base_headers, "Content-Type": "application/json"},
            json={
                "p_token": token,
                "p_cycle_id": cycle_id,
                "p_dashboard_24": payloads["dashboard_24"],
                "p_dashboard_72": payloads["dashboard_72"],
                "p_dashboard_168": payloads["dashboard_168"],
                "p_source_count": len(stage.get("sources") or []),
            },
        )
        publish_response.raise_for_status()
        return {
            "status": "published",
            "cycle_id": cycle_id,
            "windows": [24, 72, 168],
            "analyzed_signals": len(payloads["dashboard_168"]["analysis"]["intelligence"].get("signals", [])),
            "observation_count": len(stage.get("observations") or []),
            "analysis_completed_at": payloads["dashboard_168"]["analysis_completed_at"],
        }


def main() -> int:
    logging.basicConfig(level=logging.INFO, stream=sys.stderr)
    try:
        result = run_once()
    except Exception as exc:
        logger.exception("AI analysis cycle failed (%s)", type(exc).__name__)
        return 1
    print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
