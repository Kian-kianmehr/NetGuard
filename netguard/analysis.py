from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from math import isfinite
from statistics import median
from typing import Any


ASSESSMENT_NAME = "NetGuard Network Assessment"
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

TREND_CHANGE_THRESHOLD = 5.0


def _signal_trend(rows: list[dict[str, Any]], signal: str) -> dict[str, Any]:
    if signal not in ("bgp", "ping-slash24"):
        return {
            "trend_1h_change_percent": None,
            "trend_1h_direction": "context_only" if signal == "merit-nt" else "unknown",
            "trend_1h_label": (
                "شاخص کمکی؛ جهت تغییر آن به‌تنهایی کیفیت را مشخص نمی‌کند"
                if signal == "merit-nt" else "روند قابل محاسبه نیست"
            ),
        }
    if len(rows) < 6:
        return {
            "trend_1h_change_percent": None,
            "trend_1h_direction": "unknown",
            "trend_1h_label": "برای مقایسهٔ یک‌ساعته دادهٔ کافی نیست",
        }

    latest_at = rows[-1]["_time"]
    recent_start = latest_at - timedelta(hours=1)
    previous_start = latest_at - timedelta(hours=2)
    recent = [row["_value"] for row in rows if recent_start <= row["_time"] <= latest_at]
    previous = [
        row["_value"] for row in rows
        if previous_start <= row["_time"] < recent_start
    ]
    if len(recent) < 3 or len(previous) < 3:
        return {
            "trend_1h_change_percent": None,
            "trend_1h_direction": "unknown",
            "trend_1h_label": "برای مقایسهٔ یک‌ساعته دادهٔ کافی نیست",
        }

    previous_median = median(previous)
    recent_median = median(recent)
    if abs(previous_median) < 1e-9:
        change = None
    else:
        change = (recent_median - previous_median) / abs(previous_median) * 100.0
    if change is None:
        direction = "unknown"
        label = "روند قابل محاسبه نیست"
    elif change >= TREND_CHANGE_THRESHOLD:
        direction = "improving"
        label = "بهبود در شاخص دسترسی/دیدپذیری"
    elif change <= -TREND_CHANGE_THRESHOLD:
        direction = "worsening"
        label = "افت در شاخص دسترسی/دیدپذیری"
    else:
        direction = "stable"
        label = "تقریباً بدون تغییر محسوس"
    return {
        "trend_1h_change_percent": round(change, 1) if change is not None else None,
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
        return meaning + " در اندازه‌گیری‌های اخیر افت غیرعادی دیده شده و باید در کنار شاخص‌های دیگر بررسی شود."
    if current_anomaly and change_percent is not None and change_percent > 0:
        return meaning + " مقدار اخیر افزایش غیرعادی داشته؛ افزایش این شاخص به‌خودی‌خود نشانهٔ اختلال نیست."
    return meaning + " در داده‌های اخیر افتی بالاتر از آستانهٔ تشخیص ثبت نشده است."


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
            and abs((left - right).total_seconds()) <= 3600
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
            "دو شاخص مستقل در فاصلهٔ زمانی نزدیک افت کرده‌اند. برای تأیید قطعی، "
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
            "یک شاخص به‌تنهایی برای اعلام قطعی کافی نیست؛ ممکن است تغییر محدود، محلی به نقاط اندازه‌گیری "
            "یا ناشی از عامل دیگری باشد."
        )
    elif len(usable_primary) == 2:
        condition = "stable"
        tone = "good"
        condition_label = "فعلاً پایدار"
        title = "فعلاً نشانه‌ای از اختلال گسترده دیده نمی‌شود"
        summary = (
            "در دو شاخص اصلیِ پایش، افت غیرعادیِ هم‌زمان مشاهده نشده است. "
            "پس داده‌های فعلی نشانه‌ای از قطع گسترده نشان نمی‌دهند؛ این به معنی تضمین اتصال یا کیفیت یکسان برای همه نیست."
        )
        outage_state = "no_widespread_signal"
        outage_label = "نشانه‌ای از قطع گسترده دیده نمی‌شود"
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
            trend_state = "improving"
            trend_label = "در حال بهبود"
            trend_detail = "هر دو شاخص اصلی در مقایسه با ساعت قبل بهتر شده‌اند."
        elif all(direction == "worsening" for direction in directions):
            trend_state = "worsening"
            trend_label = "رو به بدتر شدن"
            trend_detail = "هر دو شاخص اصلی در مقایسه با ساعت قبل افت کرده‌اند."
        elif all(direction == "stable" for direction in directions):
            trend_state = "stable"
            trend_label = "تقریباً ثابت"
            trend_detail = "در یک ساعت اخیر تغییر معناداری در دو شاخص اصلی دیده نمی‌شود."
        else:
            trend_state = "mixed"
            trend_label = "روند یکدست نیست"
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
        trend_state = "unknown"
        trend_label = "روند نامشخص"
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

    if condition == "unknown":
        stability_label = "پایداری شبکه قابل ارزیابی نیست"
    elif condition == "possible_disruption":
        stability_label = "نشانه‌های افت هم‌زمان دیده شده"
    elif condition == "attention":
        stability_label = "یک نشانهٔ نیازمند بررسی دیده شده"
    else:
        stability_label = "شاخص‌های اصلی فعلاً پایدارند"

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
            "سرعت دانلود و آپلود، تأخیر، نوسان و از دست رفتن بسته‌ها را از دستگاه کاربران اندازه نمی‌گیرد."
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
        "scope_note": "این نتیجه در سطح ملی و بر اساس داده‌های عمومی IODA است؛ وضعیت شهر، اپراتور یا تجربهٔ یک کاربر را مشخص نمی‌کند.",
    }


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

        trend_info = _signal_trend(rows, source.get("signal", ""))
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
            "plain_title": signal_title,
            "plain_explanation": plain_explanation,
            **trend_info,
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
    current_drops = [
        signal for signal in signal_results
        if signal["current_anomaly"]
        and signal["change_percent"] is not None
        and signal["change_percent"] < 0
        and _parse_time(signal.get("last_observed_at")) is not None
    ]
    current_corroboration = any(
        left["source_id"] != right["source_id"]
        and abs(
            (_parse_time(left["last_observed_at"]) - _parse_time(right["last_observed_at"])).total_seconds()
        ) <= 3600
        for index, left in enumerate(current_drops)
        for right in current_drops[index + 1:]
    )
    fresh_count = sum(1 for signal in signal_results if signal["freshness_status"] == "fresh")
    if current_corroboration:
        assessment = "elevated_attention"
        summary = (
            "چند شاخص مستقل در داده‌های تازه کاهش غیرعادی و هم‌زمان نشان داده‌اند. "
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
        "engine": ASSESSMENT_NAME,
        "engine_type": "network_assessment",
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
            "ارزیابی با مقایسهٔ آماری هر شاخص با سابقهٔ خودش و بررسی هم‌زمانی شاخص‌های مستقل انجام می‌شود.",
            "امتیاز شواهد احتمال وقوع اختلال نیست و به‌عنوان احتمال کالیبره‌شده تفسیر نمی‌شود.",
            "داده‌ها در سطح ملی‌اند و وضعیت شهر، استان یا اپراتور را مشخص نمی‌کنند.",
            "یک سیگنال منفرد یا کاهش یک شاخص، فیلترینگ، تحریم یا قطعی را اثبات نمی‌کند.",
        ],
    }
    analysis["public_summary"] = _build_public_summary(signal_results)
    return analysis, events
