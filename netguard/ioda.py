from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Iterable

import httpx

from netguard.config import Settings, Source


@dataclass(frozen=True, slots=True)
class Observation:
    source_id: str
    observed_at: str
    collected_at: str
    value: float
    unit: str
    geographic_scope: str
    quality: str
    external_id: str
    metadata: dict[str, Any]

    def payload(self) -> dict[str, Any]:
        return {
            "source_id": self.source_id,
            "observed_at": self.observed_at,
            "collected_at": self.collected_at,
            "value": self.value,
            "unit": self.unit,
            "geographic_scope": self.geographic_scope,
            "quality": self.quality,
            "external_id": self.external_id,
            "metadata": self.metadata,
        }


def _walk(value: Any) -> Iterable[dict[str, Any]]:
    stack = [value]
    while stack:
        item = stack.pop()
        if isinstance(item, dict):
            yield item
            stack.extend(reversed(list(item.values())))
        elif isinstance(item, list):
            stack.extend(reversed(item))


def _numeric_value(raw: Any) -> tuple[float, str] | None:
    if isinstance(raw, bool):
        return None
    if isinstance(raw, (int, float)):
        value = float(raw)
        return (value, "value") if math.isfinite(value) and value >= 0 else None
    if isinstance(raw, dict):
        for key in ("value", "count", "total", "samples", "number"):
            candidate = raw.get(key)
            if isinstance(candidate, (int, float)) and not isinstance(candidate, bool):
                value = float(candidate)
                if math.isfinite(value) and value >= 0:
                    return value, key
    return None


def normalize_signal_payload(
    payload: Any,
    source: Source,
    *,
    collected_at: datetime | None = None,
    country_code: str = "IR",
) -> list[Observation]:
    """Normalize IODA time series. Missing and invalid buckets are never zero-filled."""
    if isinstance(payload, dict) and payload.get("error"):
        raise ValueError("IODA returned an error envelope.")

    collected = collected_at or datetime.now(timezone.utc)
    if collected.tzinfo is None:
        raise ValueError("collected_at must be timezone-aware.")
    collected_iso = collected.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")

    by_timestamp: dict[int, Observation] = {}
    matched = 0
    for series in _walk(payload):
        if series.get("datasource", series.get("source")) != source.signal:
            continue
        values, start, step = (
            series.get("values"),
            series.get("from"),
            series.get("step"),
        )
        if not isinstance(values, list):
            continue
        if isinstance(start, bool) or not isinstance(start, int):
            continue
        if isinstance(step, bool) or not isinstance(step, int) or step <= 0:
            continue

        matched += 1
        for index, raw in enumerate(values):
            parsed = _numeric_value(raw)
            if parsed is None:
                continue
            value, value_key = parsed
            timestamp = start + index * step
            by_timestamp[timestamp] = Observation(
                source_id=source.source_id,
                observed_at=datetime.fromtimestamp(
                    timestamp, timezone.utc
                ).isoformat().replace("+00:00", "Z"),
                collected_at=collected_iso,
                value=value,
                unit=source.unit,
                geographic_scope="country",
                quality="valid",
                external_id=f"{source.source_id}:{timestamp}",
                metadata={
                    "provider": "IODA",
                    "country_code": country_code,
                    "datasource": source.signal,
                    "upstream_step_seconds": step,
                    "upstream_native_step_seconds": series.get("nativeStep"),
                    "value_field": value_key,
                },
            )

    if not matched and isinstance(payload, dict) and payload.get("status") == "error":
        raise ValueError("IODA returned an unsuccessful status.")
    return [by_timestamp[key] for key in sorted(by_timestamp)]


class IODAClient:
    def __init__(
        self,
        settings: Settings,
        client: httpx.Client | None = None,
    ):
        self.settings = settings
        self._owns_client = client is None
        self.client = client or httpx.Client(
            timeout=httpx.Timeout(
                settings.timeout_seconds,
                connect=min(5.0, settings.timeout_seconds),
            ),
            follow_redirects=True,
            headers={
                "Accept": "application/json",
                "User-Agent": "NetGuard/1.0 (public network measurement)",
            },
        )

    def close(self) -> None:
        if self._owns_client:
            self.client.close()

    def fetch(
        self,
        source: Source,
        *,
        now: datetime | None = None,
    ) -> list[Observation]:
        end = now or datetime.now(timezone.utc)
        if end.tzinfo is None:
            raise ValueError("now must be timezone-aware.")

        until = int(end.timestamp())
        start = until - self.settings.lookback_hours * 3600
        response = self.client.get(
            f"{self.settings.ioda_base_url}/signals/raw/country/{self.settings.country_code}",
            params={
                "from": start,
                "until": until,
                "source": source.signal,
                "maxPoints": self.settings.max_points,
            },
        )
        response.raise_for_status()
        return normalize_signal_payload(
            response.json(),
            source,
            collected_at=datetime.now(timezone.utc),
            country_code=self.settings.country_code,
        )
