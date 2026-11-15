from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from math import isfinite
from statistics import median
from typing import Any


ENGINE_NAME = "NetGuard Explainable Anomaly Engine v1"
MIN_BASELINE_POINTS = 12
MIN_CHANGE_PERCENT = 25.0
MIN_ROBUST_Z = 3.5


def _parse_time(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except ValueError:
        return None


def _valid_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    valid = []
    for row in rows:
        if row.get("quality", "valid") != "valid":
            continue
        try:
            value = float(row["value"])
        except (KeyError, TypeError, ValueError):
            continue
        if not isfinite(value) or value < 0:
            continue
        timestamp = _parse_time(row.get("observed_at"))
        if timestamp is None:
            continue
        valid.append({**row, "_value": value, "_time": timestamp})
    return sorted(valid, key=lambda item: item["_time"])


def _robust_stats(values: list[float], current: float) -> tuple[float, float, float]:
    center = median(values)
    mad = median([abs(value - center) for value in values])
    # MAD is robust to spikes. The small relative floor avoids division by zero
    # on stable count series without hiding meaningful deviations.
    scale = max(1.4826 * mad, abs(center) * 0.02, 1.0)
    z_score = (current - center) / scale
    if abs(center) < 1e-9:
        change = 100.0 if current > 0 else 0.0
    else:
        change = (current - center) / abs(center) * 100.0
    return center, change, z_score


def _event_severity(change: float, z_score: float) -> str:
    magnitude = abs(change)
    if change < 0 and magnitude >= 60 and abs(z_score) >= 6:
        return "critical"
    if magnitude >= 40 and abs(z_score) >= 4.5:
        return "high"
    return "warning"


def _event_evidence_score(sample_count: int, change: float, z_score: float) -> int:
    # This is an evidence-strength score, not a calibrated probability.
    coverage = min(sample_count / 40.0, 1.0) * 35
    magnitude = min(abs(change) / 80.0, 1.0) * 35
    consistency = min(abs(z_score) / 8.0, 1.0) * 30
    return round(min(100.0, coverage + magnitude + consistency))


def _history_events(
    source: dict[str, Any],
    rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    for index in range(MIN_BASELINE_POINTS, len(rows)):
        baseline_rows = rows[max(0, index - 12):index]
        if len(baseline_rows) < MIN_BASELINE_POINTS:
            continue
        current_row = rows[index]
        current = current_row["_value"]
        center, change, z_score = _robust_stats(
            [row["_value"] for row in baseline_rows], current
        )
        if abs(change) < MIN_CHANGE_PERCENT or abs(z_score) < MIN_ROBUST_Z:
            continue
        candidates.append({
            "index": index,
            "at": current_row["observed_at"],
            "current": current,
            "baseline": center,
            "change": change,
            "z_score": z_score,
        })

    if not candidates:
        return []

    clusters: list[list[dict[str, Any]]] = []
    for candidate in candidates:
        if not clusters or candidate["index"] - clusters[-1][-1]["index"] > 2:
            clusters.append([candidate])
        else:
            clusters[-1].append(candidate)

    events: list[dict[str, Any]] = []
    for cluster in clusters:
        peak = max(cluster, key=lambda item: abs(item["change"]))
        first, last = cluster[0], cluster[-1]
        change = peak["change"]
        events.append({
            "event_id": f"anomaly:{source.get('source_id')}:{first['at']}",
            "event_type": "signal_anomaly",
            "source_id": source.get("source_id"),
            "source_name": source.get("display_name") or source.get("source_id"),
            "title": "انحراف غیرعادی در سیگنال",
            "description": (
                f"مقدار سیگنال نسبت به خط مبنای اخیر "
                f"{'کاهش' if change < 0 else 'افزایش'} محسوسی داشته است."
            ),
            "direction": "drop" if change < 0 else "spike",
            "change_percent": round(change, 1),
            "peak_change_percent": round(change, 1),
            "baseline_value": round(peak["baseline"], 2),
            "observed_value": round(peak["current"], 2),
            "unit": source.get("unit", ""),
            "start_at": first["at"],
            "end_at": last["at"],
            "occurred_at": last["at"],
            "severity": _event_severity(change, peak["z_score"]),
            "evidence_score": _event_evidence_score(
                len(rows), change, peak["z_score"]
            ),
            "robust_z_score": round(peak["z_score"], 2),
            "sample_count": len(rows),
            "corroboration": "single_signal",
            "status": "detected",
            "status_label": "شناسایی‌شده؛ نیازمند بررسی",
            "scope": "country",
        })
    return events


def analyze_dashboard(
    sources: list[dict[str, Any]],
    observations: list[dict[str, Any]],
    *,
    generated_at: datetime | None = None,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    now = generated_at or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    now = now.astimezone(timezone.utc)

    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for observation in observations:
        source_id = observation.get("source_id")
        if isinstance(source_id, str):
            grouped[source_id].append(observation)

    signal_results: list[dict[str, Any]] = []
    events: list[dict[str, Any]] = []

    for source in sources:
        source_id = source.get("source_id", "")
        rows = _valid_rows(grouped.get(source_id, []))
        sample_count = len(rows)
        latest = rows[-1] if rows else None
        source_events = _history_events(source, rows)
        events.extend(source_events)

        baseline_rows = rows[-18:-3] if sample_count >= 15 else []
        recent_rows = rows[-3:] if sample_count >= 3 else []
        baseline_value = recent_value = change = z_score = None
        current_anomaly = False
        if len(baseline_rows) >= 8 and recent_rows:
            baseline_value, change, z_score = _robust_stats(
                [row["_value"] for row in baseline_rows],
                median([row["_value"] for row in recent_rows]),
            )
            recent_value = median([row["_value"] for row in recent_rows])
            current_anomaly = (
                abs(change) >= MIN_CHANGE_PERCENT
                and abs(z_score) >= MIN_ROBUST_Z
            )

        freshness_status = source.get("freshness_status") or "unknown"
        if freshness_status == "stale":
            events.append({
                "event_id": f"stale:{source_id}:{source.get('last_observed_at')}",
                "event_type": "source_stale",
                "source_id": source_id,
                "source_name": source.get("display_name") or source_id,
                "title": "دادهٔ منبع به‌روز نیست",
                "description": "آخرین مشاهده از آستانهٔ تازگی تعریف‌شده برای این منبع عبور کرده است.",
                "direction": "unknown",
                "change_percent": None,
                "peak_change_percent": None,
                "baseline_value": None,
                "observed_value": source.get("latest_value"),
                "unit": source.get("unit", ""),
                "start_at": source.get("last_observed_at"),
                "end_at": source.get("last_observed_at"),
                "occurred_at": source.get("last_collected_at") or source.get("last_observed_at"),
                "severity": "warning",
                "evidence_score": 65,
                "robust_z_score": None,
                "sample_count": sample_count,
                "corroboration": "operational",
                "status": "detected",
                "status_label": "مشکل تازگی داده",
                "scope": "country",
            })
        elif source.get("last_run_status") == "error":
            events.append({
                "event_id": f"collector-error:{source_id}:{source.get('last_run_started_at')}",
                "event_type": "collector_error",
                "source_id": source_id,
                "source_name": source.get("display_name") or source_id,
                "title": "خطا در دریافت منبع",
                "description": "آخرین اجرای ثبت‌شدهٔ جمع‌آوری برای این منبع با خطا پایان یافته است.",
                "direction": "unknown",
                "change_percent": None,
                "peak_change_percent": None,
                "baseline_value": None,
                "observed_value": source.get("latest_value"),
                "unit": source.get("unit", ""),
                "start_at": source.get("last_run_started_at"),
                "end_at": source.get("last_run_started_at"),
                "occurred_at": source.get("last_run_started_at"),
                "severity": "warning",
                "evidence_score": 70,
                "robust_z_score": None,
                "sample_count": sample_count,
                "corroboration": "operational",
                "status": "detected",
                "status_label": "خطای جمع‌آوری",
                "scope": "country",
            })

        eligible = sample_count >= 15 and latest is not None
        if freshness_status != "fresh":
            data_state = "stale" if freshness_status == "stale" else "limited"
        elif not eligible:
            data_state = "insufficient"
        else:
            data_state = "usable"

        signal_results.append({
            "source_id": source_id,
            "display_name": source.get("display_name") or source_id,
            "provider": source.get("provider", "IODA"),
            "signal": source.get("signal", ""),
            "description": source.get("description", ""),
            "source_url": source.get("source_url", ""),
            "unit": source.get("unit", ""),
            "freshness_status": freshness_status,
            "last_observed_at": source.get("last_observed_at"),
            "last_collected_at": source.get("last_collected_at"),
            "last_run_started_at": source.get("last_run_started_at"),
            "last_run_status": source.get("last_run_status"),
            "latest_value": source.get("latest_value"),
            "sample_count": sample_count,
            "minimum_value": round(min((r["_value"] for r in rows), default=0), 2) if rows else None,
            "maximum_value": round(max((r["_value"] for r in rows), default=0), 2) if rows else None,
            "median_value": round(median([r["_value"] for r in rows]), 2) if rows else None,
            "baseline_value": round(baseline_value, 2) if baseline_value is not None else None,
            "recent_value": round(recent_value, 2) if recent_value is not None else None,
            "change_percent": round(change, 1) if change is not None else None,
            "robust_z_score": round(z_score, 2) if z_score is not None else None,
            "current_anomaly": current_anomaly,
            "data_state": data_state,
            "data_state_label": {
                "usable": "دادهٔ کافی و تازه",
                "insufficient": "تاریخچهٔ ناکافی",
                "stale": "دادهٔ قدیمی",
                "limited": "وضعیت داده نامشخص یا محدود",
            }[data_state],
            "event_count": len(source_events),
        })

    # A single signal can raise an alert, but cross-signal corroboration is
    # only assigned when independent national indicators move down close in time.
    negative_events = [
        event for event in events
        if event.get("event_type") == "signal_anomaly"
        and event.get("direction") == "drop"
        and _parse_time(event.get("occurred_at")) is not None
    ]
    for event in events:
        if event.get("event_type") != "signal_anomaly":
            continue
        event_time = _parse_time(event.get("occurred_at"))
        corroborating = {
            other.get("source_id")
            for other in negative_events
            if other.get("source_id") != event.get("source_id")
            and event_time is not None
            and _parse_time(other.get("occurred_at")) is not None
            and abs((event_time - _parse_time(other.get("occurred_at"))).total_seconds()) <= 3600
        }
        if corroborating and event.get("direction") == "drop":
            event["corroboration"] = "multiple_indicators"
            event["status"] = "suspected"
            event["status_label"] = "چندسیگناله؛ مشکوک و نیازمند تأیید"
            event["evidence_score"] = min(100, event["evidence_score"] + 15)
            event["corroborating_sources"] = sorted(corroborating)

    events.sort(
        key=lambda event: _parse_time(event.get("occurred_at")) or datetime.min.replace(tzinfo=timezone.utc),
        reverse=True,
    )

    usable = [signal for signal in signal_results if signal["data_state"] == "usable"]
    anomalous = [signal for signal in signal_results if signal["current_anomaly"]]
    corroborated = [
        event for event in events
        if event.get("status") == "suspected"
    ]
    fresh_count = sum(1 for signal in signal_results if signal["freshness_status"] == "fresh")
    if corroborated:
        assessment = "elevated_attention"
        summary = (
            "چند شاخص مستقل در بازهٔ زمانی نزدیک کاهش غیرعادی نشان داده‌اند. "
            "این وضعیت یک هشدار چندسیگناله است، نه اثبات قطعی قطعی یا علت آن."
        )
    elif anomalous:
        assessment = "watch"
        summary = (
            "در یک یا چند سیگنال انحراف آماری شناسایی شده است. "
            "برای نتیجه‌گیری دربارهٔ وضعیت کل شبکه، شواهد مستقل بیشتری لازم است."
        )
    elif len(usable) >= 2:
        assessment = "no_anomaly_detected"
        summary = (
            "در داده‌های قابل‌استفاده، انحرافی که از آستانهٔ تشخیص عبور کند مشاهده نشده است. "
            "این نتیجه به‌تنهایی سلامت کامل اینترنت را اثبات نمی‌کند."
        )
    else:
        assessment = "insufficient_data"
        summary = (
            "برای ارزیابی مطمئن، تعداد یا تازگی داده‌های موجود کافی نیست. "
            "وضعیت شبکه از روی دادهٔ ناقص نتیجه‌گیری نمی‌شود."
        )

    source_count = len(signal_results)
    coverage = round(
        100 * sum(min(signal["sample_count"] / 40.0, 1.0)
                  * (1.0 if signal["freshness_status"] == "fresh" else 0.5)
                  for signal in signal_results) / source_count
    ) if source_count else 0

    analysis = {
        "engine": ENGINE_NAME,
        "engine_type": "explainable_robust_statistics",
        "assessment": assessment,
        "assessment_label": {
            "elevated_attention": "هشدار چندسیگناله",
            "watch": "نیازمند بررسی",
            "no_anomaly_detected": "انحراف معناداری شناسایی نشد",
            "insufficient_data": "دادهٔ کافی نیست",
        }[assessment],
        "summary": summary,
        "generated_at": now.isoformat().replace("+00:00", "Z"),
        "data_coverage_percent": coverage,
        "fresh_sources": fresh_count,
        "total_sources": source_count,
        "usable_sources": len(usable),
        "anomalous_sources": len(anomalous),
        "events_count": len(events),
        "signals": signal_results,
        "method": [
            "مقایسهٔ مقدارهای اخیر با میانهٔ پنجرهٔ قبلی همان سیگنال",
            "استفاده از Median Absolute Deviation برای کاهش حساسیت به نقاط پرت",
            "بررسی هم‌زمانی فقط میان شاخص‌های مستقل و در بازهٔ حداکثر یک ساعت",
            "جداسازی تازگی داده از وضعیت واقعی شبکه",
        ],
        "limitations": [
            "این نسخه از تحلیل آماری توضیح‌پذیر و محلی استفاده می‌کند؛ مدل زبانی خارجی یا API پولی فراخوانی نمی‌شود.",
            "امتیاز شواهد احتمال وقوع اختلال نیست و به‌عنوان احتمال کالیبره‌شده تفسیر نمی‌شود.",
            "داده‌ها در سطح ملی‌اند و وضعیت شهر، استان یا اپراتور را مشخص نمی‌کنند.",
            "یک سیگنال منفرد یا کاهش یک شاخص، فیلترینگ، تحریم یا قطعی را اثبات نمی‌کند.",
        ],
    }
    return analysis, events
