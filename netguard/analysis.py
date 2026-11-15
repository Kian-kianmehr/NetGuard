from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from math import ceil, isfinite
from statistics import median
from typing import Any


ASSESSMENT_NAME = "NetGuard Network Assessment"
MIN_CHANGE_PERCENT = 25.0
MIN_ROBUST_Z = 3.5
COMPARISON_WINDOW_MINUTES = 30
RECENT_ANOMALY_WINDOW_MINUTES = 30
DEFAULT_INTERVAL_SECONDS = 300


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
    scale = max(1.4826 * mad, abs(center) * 0.02, 1.0)
    z_score = (current - center) / scale
    change = 100.0 if abs(center) < 1e-9 and current > 0 else (
        0.0 if abs(center) < 1e-9 else (current - center) / abs(center) * 100.0
    )
    return center, change, z_score


def _interval_seconds(source: dict[str, Any]) -> int:
    try:
        configured = int(source.get("expected_interval_seconds") or 0)
    except (TypeError, ValueError):
        configured = 0
    if configured > 0:
        return configured
    return 600 if source.get("signal") == "ping-slash24" else DEFAULT_INTERVAL_SECONDS


def _minimum_window_samples(interval_seconds: int, window_minutes: int) -> int:
    expected = (window_minutes * 60) / max(interval_seconds, 1)
    return max(2, ceil(expected * 0.4))


def _compare_recent_windows(
    rows: list[dict[str, Any]],
    interval_seconds: int,
    *,
    at: datetime | None = None,
) -> dict[str, Any]:
    if not rows:
        return {
            "ready": False,
            "baseline_value": None,
            "recent_value": None,
            "change_percent": None,
            "robust_z_score": None,
            "baseline_samples": 0,
            "recent_samples": 0,
        }
    end = at or rows[-1]["_time"]
    recent_start = end - timedelta(minutes=COMPARISON_WINDOW_MINUTES)
    baseline_start = recent_start - timedelta(minutes=COMPARISON_WINDOW_MINUTES)
    baseline = [r["_value"] for r in rows if baseline_start <= r["_time"] < recent_start]
    recent = [r["_value"] for r in rows if recent_start <= r["_time"] <= end]
    minimum = _minimum_window_samples(interval_seconds, COMPARISON_WINDOW_MINUTES)
    result = {
        "ready": False,
        "baseline_value": None,
        "recent_value": median(recent) if recent else None,
        "change_percent": None,
        "robust_z_score": None,
        "baseline_samples": len(baseline),
        "recent_samples": len(recent),
        "baseline_window_minutes": COMPARISON_WINDOW_MINUTES,
        "recent_window_minutes": COMPARISON_WINDOW_MINUTES,
    }
    if len(baseline) < minimum or len(recent) < minimum:
        return result
    center, change, z_score = _robust_stats(baseline, median(recent))
    result.update({
        "ready": True,
        "baseline_value": center,
        "recent_value": median(recent),
        "change_percent": change,
        "robust_z_score": z_score,
    })
    return result


def _percentile(values: list[float], percentile: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, ceil(percentile * len(ordered)) - 1))
    return ordered[index]


def _source_quality(
    source: dict[str, Any],
    rows: list[dict[str, Any]],
    raw_rows: list[dict[str, Any]],
    *,
    now: datetime,
    window_hours: int,
) -> dict[str, Any]:
    interval = _interval_seconds(source)
    duration_seconds = max(1, window_hours * 3600)
    expected = max(1, ceil(duration_seconds / interval))
    sample_count = len(rows)
    first_at = rows[0]["_time"] if rows else None
    last_at = rows[-1]["_time"] if rows else None
    gaps = [
        (rows[index]["_time"] - rows[index - 1]["_time"]).total_seconds()
        for index in range(1, len(rows))
    ]
    gaps = [gap for gap in gaps if gap > 0]
    observed_span = (
        max(0.0, (last_at - first_at).total_seconds())
        if first_at is not None and last_at is not None else 0.0
    )
    sample_coverage = min(100.0, sample_count / expected * 100.0)
    span_coverage = min(100.0, observed_span / duration_seconds * 100.0)
    recent_2h = [r for r in rows if r["_time"] >= now - timedelta(hours=2)]
    recent_30m = [r for r in rows if r["_time"] >= now - timedelta(minutes=30)]
    baseline = _compare_recent_windows(rows, interval)
    latest_age = max(0.0, (now - last_at).total_seconds()) if last_at else None
    collected_times = [
        parsed for parsed in (_parse_time(row.get("collected_at")) for row in raw_rows)
        if parsed is not None
    ]
    latest_collected = max(collected_times) if collected_times else None
    collection_lag = (
        max(0.0, (now - latest_collected).total_seconds())
        if latest_collected else None
    )
    invalid_count = max(0, len(raw_rows) - sample_count)
    expected_gap_threshold = interval * 2.5
    gaps_over_threshold = sum(1 for gap in gaps if gap > expected_gap_threshold)

    return {
        "source_id": source.get("source_id"),
        "signal": source.get("signal"),
        "display_name": source.get("display_name") or source.get("source_id"),
        "expected_interval_seconds": interval,
        "expected_interval_minutes": round(interval / 60, 1),
        "expected_samples_in_window": expected,
        "valid_samples": sample_count,
        "invalid_samples": invalid_count,
        "sample_coverage_percent": round(sample_coverage, 1),
        "observed_span_percent": round(span_coverage, 1),
        "observed_span_hours": round(observed_span / 3600, 2),
        "first_observed_at": first_at.isoformat() if first_at else None,
        "last_observed_at": last_at.isoformat() if last_at else None,
        "last_collected_at": latest_collected.isoformat() if latest_collected else None,
        "observation_age_seconds": round(latest_age) if latest_age is not None else None,
        "collection_age_seconds": round(collection_lag) if collection_lag is not None else None,
        "median_gap_seconds": round(median(gaps)) if gaps else None,
        "p90_gap_seconds": round(_percentile(gaps, 0.9)) if gaps else None,
        "max_gap_seconds": round(max(gaps)) if gaps else None,
        "gaps_over_expected_threshold": gaps_over_threshold,
        "samples_last_2h": len(recent_2h),
        "samples_last_30m": len(recent_30m),
        "baseline_samples": baseline["baseline_samples"],
        "recent_samples": baseline["recent_samples"],
        "freshness_status": source.get("freshness_status") or "unknown",
        "last_run_status": source.get("last_run_status") or "unknown",
        "last_run_started_at": source.get("last_run_started_at"),
        "last_run_error_code": source.get("last_run_error_code"),
        "window_coverage_label": (
            "پوشش خوب" if sample_coverage >= 80 else
            "پوشش متوسط" if sample_coverage >= 50 else
            "پوشش محدود" if sample_coverage >= 20 else
            "تاریخچهٔ کم در بازه"
        ),
    }


def _event_severity(change: float, z_score: float) -> str:
    magnitude = abs(change)
    if change < 0 and magnitude >= 60 and abs(z_score) >= 6:
        return "critical"
    if magnitude >= 40 and abs(z_score) >= 4.5:
        return "high"
    return "warning"


def _event_evidence_score(sample_count: int, change: float, z_score: float) -> int:
    coverage = min(sample_count / 40.0, 1.0) * 35
    magnitude = min(abs(change) / 80.0, 1.0) * 35
    consistency = min(abs(z_score) / 8.0, 1.0) * 30
    return round(min(100.0, coverage + magnitude + consistency))


PRIMARY_SIGNAL_GUIDANCE = {
    "bgp": (
        "دیدپذیری مسیرهای اینترنت",
        "این شاخص نشان می‌دهد چه تعداد بخش از شبکه‌های IPv4 از مسیرهای اینترنتی قابل مشاهده‌اند. افت محسوس می‌تواند نشانه کاهش دیدپذیری یا اختلال در مسیرها باشد، اما تجربهٔ همهٔ کاربران را نشان نمی‌دهد.",
    ),
    "ping-slash24": (
        "پاسخ‌گویی شبکه‌ها به پایش فعال",
        "این شاخص تعداد بخش‌های شبکه‌ای را می‌شمارد که از نقاط اندازه‌گیری IODA پاسخ داده‌اند. افت محسوس می‌تواند نشانه کاهش دسترسی از این نقاط باشد، اما به‌تنهایی وضعیت همهٔ کاربران را مشخص نمی‌کند.",
    ),
    "merit-nt": (
        "مشاهدات تلسکوپ شبکه",
        "این شاخص تعداد IPهای یکتای دیده‌شده در تلسکوپ شبکه را نشان می‌دهد. تغییر آن ممکن است از الگوی ترافیک هم تأثیر بگیرد؛ بنابراین به‌تنهایی معیار خوب یا بد بودن اینترنت نیست.",
    ),
}


def _signal_trend(
    rows: list[dict[str, Any]],
    signal: str,
    interval_seconds: int,
    now: datetime,
) -> dict[str, Any]:
    if signal not in ("bgp", "ping-slash24"):
        return {
            "trend_1h_change_percent": None,
            "trend_1h_direction": "context_only" if signal == "merit-nt" else "unknown",
            "trend_1h_label": (
                "شاخص کمکی؛ جهت تغییر آن به‌تنهایی کیفیت را مشخص نمی‌کند"
                if signal == "merit-nt" else "روند قابل محاسبه نیست"
            ),
        }

    latest = rows[-1]["_time"] if rows else None
    if latest is None:
        return {
            "trend_1h_change_percent": None,
            "trend_1h_direction": "unknown",
            "trend_1h_label": "دادهٔ تازه برای محاسبهٔ روند یک‌ساعته در دسترس نیست",
        }

    recent_start = latest - timedelta(hours=1)
    previous_start = recent_start - timedelta(hours=1)
    recent = [r["_value"] for r in rows if recent_start <= r["_time"] <= latest]
    previous = [r["_value"] for r in rows if previous_start <= r["_time"] < recent_start]
    minimum = max(2, _minimum_window_samples(interval_seconds, 60))
    if len(recent) < minimum or len(previous) < minimum:
        return {
            "trend_1h_change_percent": None,
            "trend_1h_direction": "unknown",
            "trend_1h_label": "برای مقایسهٔ یک‌ساعته نمونهٔ کافی نداریم",
        }

    previous_median = median(previous)
    recent_median = median(recent)
    if abs(previous_median) < 1e-9:
        return {
            "trend_1h_change_percent": None,
            "trend_1h_direction": "unknown",
            "trend_1h_label": "روند قابل محاسبه نیست",
        }
    change = (recent_median - previous_median) / abs(previous_median) * 100.0
    if change >= 5.0:
        direction, label = "improving", "بهبود در شاخص دسترسی/دیدپذیری"
    elif change <= -5.0:
        direction, label = "worsening", "افت در شاخص دسترسی/دیدپذیری"
    else:
        direction, label = "stable", "تقریباً بدون تغییر محسوس"
    return {
        "trend_1h_change_percent": round(change, 1),
        "trend_1h_direction": direction,
        "trend_1h_label": label,
    }


def _plain_signal_explanation(
    signal: str,
    data_state: str,
    current_anomaly: bool,
    change_percent: float | None,
) -> str:
    _, meaning = PRIMARY_SIGNAL_GUIDANCE.get(
        signal,
        ("شاخص کمکی", "این شاخص فقط به‌عنوان شاهد مکمل بررسی می‌شود."),
    )
    if data_state != "usable":
        return meaning + " در حال حاضر دادهٔ این شاخص برای نتیجه‌گیری کافی یا به‌روز نیست."
    if current_anomaly and change_percent is not None and change_percent < 0:
        return meaning + " در بازه‌های زمانی هم‌طول افت غیرعادی دیده شده و باید در کنار شاخص‌های دیگر بررسی شود."
    if current_anomaly and change_percent is not None and change_percent > 0:
        return meaning + " مقدار اخیر افزایش غیرعادی داشته؛ افزایش این شاخص به‌خودی‌خود نشانهٔ اختلال نیست."
    return meaning + " در مقایسهٔ دو پنجرهٔ زمانی اخیر، افتی بالاتر از آستانهٔ تشخیص ثبت نشده است."


def _history_events(
    source: dict[str, Any],
    rows: list[dict[str, Any]],
    *,
    interval_seconds: int,
) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    for index in range(1, len(rows)):
        comparison = _compare_recent_windows(rows[:index + 1], interval_seconds, at=rows[index]["_time"])
        change = comparison["change_percent"]
        z_score = comparison["robust_z_score"]
        if (
            not comparison["ready"]
            or change is None or z_score is None
            or abs(change) < MIN_CHANGE_PERCENT
            or abs(z_score) < MIN_ROBUST_Z
        ):
            continue
        candidates.append({
            "at": rows[index]["observed_at"],
            "current": comparison["recent_value"],
            "baseline": comparison["baseline_value"],
            "change": change,
            "z_score": z_score,
        })

    if not candidates:
        return []
    cluster_gap = max(20 * 60, interval_seconds * 3)
    clusters: list[list[dict[str, Any]]] = []
    for candidate in candidates:
        candidate_time = _parse_time(candidate["at"])
        previous_time = _parse_time(clusters[-1][-1]["at"]) if clusters else None
        if not clusters or candidate_time is None or previous_time is None or (candidate_time - previous_time).total_seconds() > cluster_gap:
            clusters.append([candidate])
        else:
            clusters[-1].append(candidate)

    events = []
    for cluster in clusters:
        peak = max(cluster, key=lambda item: abs(item["change"]))
        change = peak["change"]
        first, last = cluster[0], cluster[-1]
        events.append({
            "event_id": f"anomaly:{source.get('source_id')}:{first['at']}",
            "event_type": "signal_anomaly",
            "source_id": source.get("source_id"),
            "source_name": source.get("display_name") or source.get("source_id"),
            "title": "انحراف غیرعادی در سیگنال",
            "description": (
                f"مقدار سیگنال نسبت به خط مبنای زمانی اخیر "
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
            "evidence_score": _event_evidence_score(len(rows), change, peak["z_score"]),
            "robust_z_score": round(peak["z_score"], 2),
            "sample_count": len(rows),
            "corroboration": "single_signal",
            "status": "detected",
            "status_label": "شناسایی‌شده؛ نیازمند بررسی",
            "scope": "country",
        })
    return events


def _build_public_summary(signals: list[dict[str, Any]]) -> dict[str, Any]:
    primary = {
        item.get("signal"): item
        for item in signals
        if item.get("signal") in ("bgp", "ping-slash24")
    }
    bgp = primary.get("bgp")
    ping = primary.get("ping-slash24")
    primary_items = [item for item in (bgp, ping) if item is not None]
    usable_primary = [
        item for item in primary_items
        if item.get("data_state") == "usable"
        and item.get("freshness_status") == "fresh"
    ]
    down = [
        item for item in usable_primary
        if item.get("current_anomaly")
        and item.get("change_percent") is not None
        and item["change_percent"] < 0
    ]

    both_down_together = False
    if len(down) == 2:
        left = _parse_time(down[0].get("last_observed_at"))
        right = _parse_time(down[1].get("last_observed_at"))
        both_down_together = (
            left is not None and right is not None
            and abs((left - right).total_seconds()) <= 1800
        )

    if both_down_together:
        condition = "possible_disruption"
        tone = "danger"
        condition_label = "نشانه‌های اختلال گسترده"
        title = "چند شاخص اصلی هم‌زمان افت کرده‌اند"
        summary = (
            "در هر دو شاخص اصلیِ مسیرهای اینترنت و پاسخ‌گویی شبکه‌ها افت غیرعادی دیده شده است. "
            "این یک هشدار جدی برای بررسی اختلال گسترده است؛ اما قطع کامل یا علت آن هنوز تأیید نشده."
        )
        outage_state = "multiple_indicators"
        outage_label = "نشانهٔ اختلال گسترده دیده می‌شود"
        outage_detail = (
            "دو شاخص اصلی در فاصلهٔ زمانی نزدیک افت کرده‌اند. برای تأیید قطعی، "
            "اندازه‌گیری‌های مستقل و پایدار بیشتری لازم است."
        )
    elif down:
        condition = "attention"
        tone = "warn"
        condition_label = "نیازمند بررسی"
        title = "یک شاخص اصلی افت غیرعادی داشته است"
        affected = "دیدپذیری مسیرهای اینترنت" if down[0].get("signal") == "bgp" else "پاسخ‌گویی شبکه‌ها به پایش فعال"
        summary = (
            f"در شاخص «{affected}» افت غیرعادی دیده شده، اما شاخص اصلی دیگر آن را هم‌زمان تأیید نمی‌کند. "
            "بنابراین فعلاً نمی‌توان از قطع گسترده یا سراسری نتیجه گرفت."
        )
        outage_state = "single_signal_drop"
        outage_label = "یک نشانهٔ افت؛ قطع سراسری تأیید نشده"
        outage_detail = (
            "یک شاخص به‌تنهایی برای اعلام قطعی کافی نیست؛ ممکن است تغییر محدود، وابسته به نقاط اندازه‌گیری "
            "یا ناشی از عامل دیگری باشد."
        )
    elif len(usable_primary) == 2:
        condition = "stable"
        tone = "good"
        condition_label = "فعلاً پایدار"
        title = "شاخص‌های اصلی در محدودهٔ معمول هستند"
        summary = (
            "داده‌های تازهٔ هر دو شاخص اصلی در محدودهٔ معمول قرار دارند و فعلاً نشانه‌ای از افت هم‌زمان دیده نمی‌شود. "
            "این ارزیابی وضعیت کلی شبکه را توصیف می‌کند و تضمین‌کنندهٔ اتصال یا کیفیت یکسان برای همهٔ کاربران نیست."
        )
        outage_state = "no_widespread_signal"
        outage_label = "افت هم‌زمان در شاخص‌های اصلی ثبت نشده است"
        outage_detail = (
            "هر دو شاخص اصلی دادهٔ تازه و قابل استفاده دارند و افت غیرعادی ثبت نکرده‌اند. "
            "این نتیجه نبودِ شواهد در این پایش است، نه اثبات اینکه هیچ کاربری قطعی ندارد."
        )
    else:
        condition = "unknown"
        tone = "neutral"
        condition_label = "قابل قضاوت نیست"
        title = "برای قضاوت دربارهٔ وضعیت شبکه دادهٔ کافی نداریم"
        summary = (
            "برای ارزیابی قابل اتکا باید هر دو شاخص اصلی، دادهٔ تازه و تاریخچهٔ کافی داشته باشند. "
            "دادهٔ ناقص را نمی‌توان به معنی سالم بودن شبکه در نظر گرفت."
        )
        outage_state = "insufficient_data"
        outage_label = "وضعیت قطعی نامشخص است"
        outage_detail = (
            "حداقل یکی از شاخص‌های اصلی قدیمی، محدود یا فاقد تاریخچهٔ کافی است؛ "
            "بنابراین اعلام قطع یا سلامت شبکه مسئولانه نیست."
        )

    trend_items = [
        item for item in primary_items
        if item.get("data_state") == "usable"
        and item.get("trend_1h_direction") in ("improving", "worsening", "stable")
    ]
    directions = [item["trend_1h_direction"] for item in trend_items]
    if len(directions) >= 2:
        if all(direction == "improving" for direction in directions):
            trend_state, trend_label = "improving", "در حال بهبود"
            trend_detail = "هر دو شاخص اصلی در مقایسه با ساعت قبل بهتر شده‌اند."
        elif all(direction == "worsening" for direction in directions):
            trend_state, trend_label = "worsening", "رو به بدتر شدن"
            trend_detail = "هر دو شاخص اصلی در مقایسه با ساعت قبل افت کرده‌اند."
        elif all(direction == "stable" for direction in directions):
            trend_state, trend_label = "stable", "تقریباً ثابت"
            trend_detail = "در یک ساعت اخیر تغییر معناداری در دو شاخص اصلی دیده نمی‌شود."
        else:
            trend_state, trend_label = "mixed", "روند یکدست نیست"
            trend_detail = "شاخص‌های اصلی جهت یکسانی ندارند؛ از اعلام بهبود یا بدترشدن قطعی خودداری می‌کنیم."
    elif len(directions) == 1:
        trend_state = directions[0]
        trend_label = {
            "improving": "یک شاخص رو به بهبود است",
            "worsening": "یک شاخص رو به افت است",
            "stable": "یک شاخص تقریباً ثابت است",
        }[trend_state]
        trend_detail = "این برداشت فقط از یک شاخص به دست آمده و اطمینان کمتری دارد."
    else:
        trend_state, trend_label = "unknown", "روند نامشخص"
        trend_detail = "برای مقایسهٔ یک ساعت اخیر با ساعت قبل، نمونه‌های کافی در دسترس نیست."

    if len(usable_primary) == 2 and all(item.get("sample_count", 0) >= 24 for item in usable_primary):
        confidence = "medium"
        confidence_label = "متوسط"
        confidence_detail = (
            "دو شاخص اصلی دادهٔ تازه و تاریخچهٔ کافی دارند؛ بااین‌حال هر دو از یک ارائه‌دهنده‌اند "
            "و اندازه‌گیری مستقیم تجربهٔ کاربران نیستند."
        )
    elif usable_primary:
        confidence = "low"
        confidence_label = "کم"
        confidence_detail = "فقط بخشی از شاخص‌های اصلی قابل استفاده‌اند یا تاریخچهٔ آن‌ها محدود است."
    else:
        confidence = "low"
        confidence_label = "پایین"
        confidence_detail = "دادهٔ تازه و کافی برای یک نتیجهٔ مطمئن در دسترس نیست."

    stability_label = (
        "پایداری شبکه قابل ارزیابی نیست" if condition == "unknown" else
        "نشانه‌های افت هم‌زمان دیده شده" if condition == "possible_disruption" else
        "یک نشانهٔ نیازمند بررسی دیده شده" if condition == "attention" else
        "شاخص‌های اصلی فعلاً پایدارند"
    )
    return {
        "tone": tone,
        "condition": condition,
        "condition_label": condition_label,
        "title": title,
        "summary": summary,
        "outage_state": outage_state,
        "outage_label": outage_label,
        "outage_detail": outage_detail,
        "stability_label": stability_label,
        "quality_state": "not_measured",
        "quality_label": "کیفیت تجربهٔ کاربران مستقیماً سنجیده نشده",
        "quality_detail": (
            "این نسخه تعداد شبکه‌های قابل مشاهده و پاسخ‌گو را بررسی می‌کند؛ "
            "سرعت، تأخیر و از دست رفتن بسته‌ها را از دستگاه کاربران اندازه نمی‌گیرد."
        ),
        "trend_state": trend_state,
        "trend_label": trend_label,
        "trend_detail": trend_detail,
        "confidence": confidence,
        "confidence_label": confidence_label,
        "confidence_detail": confidence_detail,
        "checked_primary_signals": len(usable_primary),
        "total_primary_signals": 2,
        "reasoning": [
            "برای ارزیابی پایداری زیرساخت، فقط دو شاخص BGP و پایش فعال در نتیجهٔ اصلی اثر داده شده‌اند.",
            "تلسکوپ شبکه یک شاهد کمکی است؛ تغییر آن به‌تنهایی به معنی بهتر یا بدتر شدن اینترنت نیست.",
            "نبود هشدار به معنی اثبات سلامت کامل اینترنت یا وصل بودن همهٔ کاربران نیست.",
        ],
        "scope_note": "این نتیجه در سطح ملی و بر اساس داده‌های عمومی IODA است؛ وضعیت شهر، استان یا اپراتور را مشخص نمی‌کند.",
    }


def analyze_dashboard(
    sources: list[dict[str, Any]],
    observations: list[dict[str, Any]],
    *,
    generated_at: datetime | None = None,
    window_hours: int = 168,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    now = generated_at or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    now = now.astimezone(timezone.utc)
    window_hours = max(1, min(int(window_hours), 168))
    window_start = now - timedelta(hours=window_hours)

    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for observation in observations:
        source_id = observation.get("source_id")
        if isinstance(source_id, str):
            grouped[source_id].append(observation)

    signal_results: list[dict[str, Any]] = []
    events: list[dict[str, Any]] = []
    quality_rows: list[dict[str, Any]] = []
    expected_total = valid_total = 0

    for source in sources:
        source_id = source.get("source_id", "")
        raw_rows = grouped.get(source_id, [])
        rows = _valid_rows(raw_rows)
        rows = [row for row in rows if window_start <= row["_time"] <= now]
        interval = _interval_seconds(source)
        try:
            stale_after = int(source.get("stale_after_seconds") or max(1800, interval * 3))
        except (TypeError, ValueError):
            stale_after = max(1800, interval * 3)
        quality = _source_quality(
            source, rows, raw_rows, now=now, window_hours=window_hours
        )
        quality_rows.append(quality)
        expected_total += int(quality["expected_samples_in_window"])
        valid_total += int(quality["valid_samples"])

        sample_count = len(rows)
        latest = rows[-1] if rows else None
        freshness_status = source.get("freshness_status") or "unknown"
        comparison = _compare_recent_windows(rows, interval)

        if freshness_status == "stale":
            data_state = "stale"
        elif freshness_status != "fresh":
            data_state = "limited"
        elif sample_count < 12 or not comparison["ready"]:
            data_state = "insufficient"
        else:
            data_state = "usable"

        baseline_value = comparison["baseline_value"]
        recent_value = comparison["recent_value"]
        change = comparison["change_percent"]
        z_score = comparison["robust_z_score"]
        current_anomaly = (
            data_state == "usable"
            and change is not None
            and z_score is not None
            and abs(change) >= MIN_CHANGE_PERCENT
            and abs(z_score) >= MIN_ROBUST_Z
        )

        source_events = _history_events(source, rows, interval_seconds=interval)
        latest_time = latest["_time"] if latest else None
        for event in source_events:
            event_end = _parse_time(event.get("end_at"))
            later_observations = [
                row for row in rows
                if event_end is not None and row["_time"] > event_end
            ]
            lifecycle_window = max(stale_after, interval * 3, 900)
            age_after_event = (
                (now - event_end).total_seconds() if event_end is not None else None
            )
            age_to_latest = (
                (latest_time - event_end).total_seconds()
                if latest_time is not None and event_end is not None else None
            )
            if (
                current_anomaly
                and age_to_latest is not None
                and 0 <= age_to_latest <= lifecycle_window
            ):
                event["lifecycle"] = "active"
                event["lifecycle_label"] = "در جریان؛ ناهنجاری جاری است"
            elif data_state == "usable" and later_observations and not current_anomaly:
                event["lifecycle"] = "resolved"
                event["lifecycle_label"] = "پایان‌یافته در داده‌های جدیدتر"
            elif later_observations or (
                age_after_event is not None and age_after_event > lifecycle_window
            ):
                event["lifecycle"] = "historical"
                event["lifecycle_label"] = "سابقهٔ ناهنجاری؛ وضعیت فعلی جداگانه سنجیده می‌شود"
            else:
                event["lifecycle"] = "unknown"
                event["lifecycle_label"] = "زمان وضعیت فعلی نامشخص"
            event["last_observed_at"] = source.get("last_observed_at")
            event["last_collected_at"] = source.get("last_collected_at")
            if source.get("signal") == "merit-nt" and event.get("direction") == "spike":
                event["status_label"] = "انحراف در شاخص کمکی؛ نه شاهد مستقیم افت اینترنت"
                event["description"] += (
                    " این شاخص کمکی است؛ افزایش آن به‌تنهایی نشانهٔ افت اینترنت نیست "
                    "و می‌تواند از تغییر الگوی ترافیک یا پوشش تلسکوپ اثر بگیرد."
                )
        events.extend(source_events)

        if data_state == "stale":
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
                "evidence_score": None,
                "robust_z_score": None,
                "sample_count": sample_count,
                "corroboration": "operational",
                "status": "detected",
                "status_label": "هشدار عملیاتی؛ نه رخداد شبکه",
                "lifecycle": "operational",
                "lifecycle_label": "دادهٔ منبع قدیمی",
                "last_observed_at": source.get("last_observed_at"),
                "last_collected_at": source.get("last_collected_at"),
                "scope": "country",
            })
        elif source.get("last_run_status") in ("error", "no_data"):
            run_status = source.get("last_run_status")
            events.append({
                "event_id": f"collector-{run_status}:{source_id}:{source.get('last_run_started_at')}",
                "event_type": "collector_error",
                "source_id": source_id,
                "source_name": source.get("display_name") or source_id,
                "title": "جمع‌آوری داده نیازمند بررسی است",
                "description": "آخرین اجرای ثبت‌شدهٔ جمع‌آوری موفق به دریافت دادهٔ تازه نشده است.",
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
                "evidence_score": None,
                "robust_z_score": None,
                "sample_count": sample_count,
                "corroboration": "operational",
                "status": "detected",
                "status_label": "هشدار عملیاتی؛ نه رخداد شبکه",
                "lifecycle": "operational",
                "lifecycle_label": "اجرای جمع‌آوری ناموفق",
                "last_observed_at": source.get("last_observed_at"),
                "last_collected_at": source.get("last_collected_at"),
                "scope": "country",
            })

        trend_info = _signal_trend(rows, source.get("signal", ""), interval, now)
        if freshness_status != "fresh":
            trend_info = {
                "trend_1h_change_percent": None,
                "trend_1h_direction": "unknown",
                "trend_1h_label": "دادهٔ تازه برای محاسبهٔ روند یک‌ساعته در دسترس نیست",
            }
        plain_explanation = _plain_signal_explanation(
            source.get("signal", ""), data_state, current_anomaly, change
        )
        signal_title, _ = PRIMARY_SIGNAL_GUIDANCE.get(
            source.get("signal", ""), ("شاخص کمکی", "")
        )

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
            "last_run_error_code": source.get("last_run_error_code"),
            "latest_value": source.get("latest_value"),
            "expected_interval_seconds": interval,
            "stale_after_seconds": stale_after,
            "sample_count": sample_count,
            "recent_samples": comparison["recent_samples"],
            "baseline_samples": comparison["baseline_samples"],
            "minimum_value": round(min((r["_value"] for r in rows)), 2) if rows else None,
            "maximum_value": round(max((r["_value"] for r in rows)), 2) if rows else None,
            "median_value": round(median([r["_value"] for r in rows]), 2) if rows else None,
            "baseline_value": round(baseline_value, 2) if baseline_value is not None else None,
            "recent_value": round(recent_value, 2) if recent_value is not None else None,
            "change_percent": round(change, 1) if change is not None else None,
            "robust_z_score": round(z_score, 2) if z_score is not None else None,
            "current_anomaly": current_anomaly,
            "data_state": data_state,
            "data_state_label": {
                "usable": "دادهٔ تازه و مقایسه‌پذیر",
                "insufficient": "نمونهٔ کافی در پنجره‌های اخیر نیست",
                "stale": "دادهٔ قدیمی",
                "limited": "جمع‌آوری یا تازگی داده نیازمند بررسی است",
            }[data_state],
            "event_count": len(source_events),
            "plain_title": signal_title,
            "plain_explanation": plain_explanation,
            "data_quality": quality,
            **trend_info,
        })

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

    primary = {
        item["signal"]: item
        for item in signal_results
        if item["signal"] in ("bgp", "ping-slash24")
    }
    usable_primary = [
        primary[signal] for signal in ("bgp", "ping-slash24")
        if signal in primary and primary[signal]["data_state"] == "usable"
    ]
    primary_anomalies = [item for item in usable_primary if item["current_anomaly"]]
    primary_drops = [
        item for item in primary_anomalies
        if item["change_percent"] is not None and item["change_percent"] < 0
    ]

    both_primary_down = False
    if len(primary_drops) == 2:
        left = _parse_time(primary_drops[0].get("last_observed_at"))
        right = _parse_time(primary_drops[1].get("last_observed_at"))
        both_primary_down = (
            left is not None and right is not None
            and abs((left - right).total_seconds()) <= 1800
        )

    if both_primary_down:
        assessment = "elevated_attention"
        summary = (
            "دو شاخص اصلی در پنجره‌های زمانی هم‌طول، افت غیرعادی و نزدیک به هم نشان داده‌اند. "
            "این هشدار چندسیگناله است؛ علت یا گسترهٔ قطعی هنوز تأیید نشده است."
        )
    elif primary_anomalies:
        assessment = "watch"
        summary = (
            "در یکی از شاخص‌های اصلی تغییر غیرعادی دیده شده است. "
            "این تغییر نیازمند بررسی است و به‌تنهایی اختلال سراسری را ثابت نمی‌کند."
        )
    elif len(usable_primary) == 2:
        assessment = "no_anomaly_detected"
        summary = (
            "در دو شاخص اصلیِ تازه و قابل مقایسه، افت غیرعادی شناسایی نشده است. "
            "این نتیجه نبودِ شواهد در این پایش است، نه اثبات سلامت کامل اینترنت."
        )
    else:
        assessment = "insufficient_data"
        summary = (
            "دادهٔ تازه و هم‌زمان از هر دو شاخص اصلی برای قضاوت کافی نیست. "
            "دادهٔ ناقص یا قدیمی به معنی سالم بودن شبکه نیست."
        )

    source_count = len(signal_results)
    usable = [signal for signal in signal_results if signal["data_state"] == "usable"]
    anomalous = [signal for signal in signal_results if signal["current_anomaly"]]
    fresh_count = sum(1 for signal in signal_results if signal["freshness_status"] == "fresh")
    window_coverage = min(100.0, valid_total / expected_total * 100.0) if expected_total else 0.0
    observed_span = (
        sum(float(item["observed_span_percent"]) for item in quality_rows) / len(quality_rows)
        if quality_rows else 0.0
    )
    recent_rows = [row for row in quality_rows if row["samples_last_2h"] > 0]
    data_quality = {
        "window_hours": window_hours,
        "window_start": window_start.isoformat(),
        "window_end": now.isoformat(),
        "total_observations": len(observations),
        "valid_observations": valid_total,
        "invalid_observations": max(0, len(observations) - valid_total),
        "expected_observations": expected_total,
        "window_coverage_percent": round(window_coverage, 1),
        "observed_span_percent": round(observed_span, 1),
        "sources_total": source_count,
        "sources_fresh": fresh_count,
        "sources_usable": len(usable),
        "sources_with_recent_samples": len(recent_rows),
        "sources_with_gaps": sum(1 for item in quality_rows if item["gaps_over_expected_threshold"] > 0),
        "source_details": quality_rows,
        "coverage_label": (
            "تاریخچهٔ کافی در این بازه" if window_coverage >= 80 else
            "بخشی از بازه پوشش دارد" if window_coverage >= 30 else
            "پوشش تاریخی محدود است"
        ),
        "interpretation": (
            "درصد پوشش از تعداد نمونه‌های معتبر نسبت به تعداد مورد انتظار بر اساس فاصلهٔ ثبت‌شدهٔ هر منبع محاسبه می‌شود. "
            "تازگی آخرین نمونه و پیوستگی فاصله‌های بین نمونه‌ها جداگانه سنجیده می‌شوند."
        ),
    }

    analysis = {
        "engine": ASSESSMENT_NAME,
        "engine_type": "network_assessment",
        "assessment": assessment,
        "assessment_label": {
            "elevated_attention": "هشدار چندسیگناله",
            "watch": "نیازمند بررسی",
            "no_anomaly_detected": "افت غیرعادی شناسایی نشد",
            "insufficient_data": "دادهٔ هم‌زمان کافی نیست",
        }[assessment],
        "summary": summary,
        "generated_at": now.isoformat().replace("+00:00", "Z"),
        "data_coverage_percent": round(window_coverage),
        "data_quality": data_quality,
        "fresh_sources": fresh_count,
        "total_sources": source_count,
        "usable_sources": len(usable),
        "anomalous_sources": len(primary_anomalies),
        "supporting_signal_anomalies": len(anomalous),
        "events_count": len(events),
        "signals": signal_results,
        "method": [
            "مقایسهٔ دو پنجرهٔ زمانی ۳۰ دقیقه‌ای هم‌طول برای هر سیگنال",
            "استفاده از میانه و Median Absolute Deviation برای کاهش حساسیت به نقاط پرت",
            "تطبیق آستانهٔ تعداد نمونه با فاصلهٔ اندازه‌گیری هر منبع",
            "بررسی هم‌زمانی فقط میان دو شاخص اصلی و با فاصلهٔ زمانی حداکثر ۳۰ دقیقه",
            "جداسازی پوشش تاریخچه، پیوستگی نمونه‌ها و تازگی آخرین مشاهده",
        ],
        "limitations": [
            "درصد پوشش به بازهٔ انتخاب‌شده و فاصلهٔ مورد انتظار همان منبع وابسته است.",
            "امتیاز شواهد احتمال وقوع اختلال نیست و به‌عنوان احتمال کالیبره‌شده تفسیر نمی‌شود.",
            "داده‌ها در سطح ملی‌اند و وضعیت شهر، استان یا اپراتور را مشخص نمی‌کنند.",
            "یک سیگنال منفرد یا کاهش یک شاخص، فیلترینگ، تحریم یا قطعی را اثبات نمی‌کند.",
            "دادهٔ IODA کیفیت تجربهٔ مستقیم کاربران، سرعت دانلود یا تأخیر انتهابه‌انتها را اندازه‌گیری نمی‌کند.",
        ],
    }
    analysis["public_summary"] = _build_public_summary(signal_results)
    return analysis, events
