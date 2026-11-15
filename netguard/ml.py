from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from math import ceil, exp, isfinite, log1p, log2
from random import Random
from statistics import median
from typing import Any


MODEL_NAME = "Hybrid Isolation Forest"
FEATURE_NAMES = ("سطح سیگنال", "تغییر نرمال‌شده در ساعت", "فاصله از خط مبنا")
MIN_RAW_POINTS = 45
MIN_TRAINING_POINTS = 32
FEATURE_WINDOW_MINUTES = 60
FORECAST_WINDOW_MINUTES = 30
TREE_COUNT = 64
MAX_SAMPLE_SIZE = 128
ANOMALY_THRESHOLD = 0.65


def _parse_time(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed.astimezone(timezone.utc)
    except ValueError:
        return None


def _valid_rows(source_id: str, observations: list[dict[str, Any]]) -> list[tuple[datetime, float]]:
    rows = []
    for row in observations:
        if row.get("source_id") != source_id or row.get("quality", "valid") != "valid":
            continue
        timestamp = _parse_time(row.get("observed_at"))
        try:
            value = float(row.get("value"))
        except (TypeError, ValueError):
            continue
        if timestamp is not None and isfinite(value) and value >= 0:
            rows.append((timestamp, value))
    return sorted(rows, key=lambda item: item[0])


def _interval_seconds(source: dict[str, Any]) -> int:
    try:
        value = int(source.get("expected_interval_seconds") or 0)
    except (TypeError, ValueError):
        value = 0
    if value > 0:
        return value
    return 600 if source.get("signal") == "ping-slash24" else 300


def _window_values(
    rows: list[tuple[datetime, float]],
    start: datetime,
    end: datetime,
) -> list[float]:
    return [value for timestamp, value in rows if start <= timestamp <= end]


def _minimum_window_samples(interval_seconds: int, window_minutes: int) -> int:
    expected = (window_minutes * 60) / max(interval_seconds, 1)
    return max(2, ceil(expected * 0.4))


def _features(
    rows: list[tuple[datetime, float]],
    interval_seconds: int,
) -> list[list[float]]:
    output: list[list[float]] = []
    required_baseline = max(3, ceil((FEATURE_WINDOW_MINUTES * 60 / interval_seconds) * 0.35))
    for index, (timestamp, current) in enumerate(rows):
        baseline_start = timestamp - timedelta(minutes=FEATURE_WINDOW_MINUTES)
        baseline = [
            value for old_time, value in rows[:index]
            if baseline_start <= old_time < timestamp
        ]
        if len(baseline) < required_baseline:
            continue
        center = median(baseline)
        mad = median([abs(value - center) for value in baseline])
        scale = max(1.4826 * mad, abs(center) * 0.02, 1.0)
        if index == 0:
            continue
        previous_time, previous_value = rows[index - 1]
        elapsed = max(1.0, (timestamp - previous_time).total_seconds())
        rate_per_hour = (
            (current - previous_value) / max(abs(previous_value), 1.0)
            * 3600.0 / elapsed * 100.0
        )
        deviation = (current - center) / scale
        output.append([
            log1p(current),
            max(-300.0, min(300.0, rate_per_hour)),
            max(-12.0, min(12.0, deviation)),
        ])
    return output


def _average_path_length(size: int) -> float:
    if size <= 1:
        return 0.0
    if size == 2:
        return 1.0
    harmonic = sum(1.0 / value for value in range(1, size))
    return 2.0 * harmonic - (2.0 * (size - 1) / size)


def _build_tree(samples, depth, max_depth, rng, split_counts):
    size = len(samples)
    leaf = {"feature": None, "split": None, "left": None, "right": None, "size": size}
    if size <= 1 or depth >= max_depth:
        return leaf
    candidates = []
    for feature in range(len(FEATURE_NAMES)):
        values = [row[feature] for row in samples]
        low, high = min(values), max(values)
        if high > low:
            candidates.append((feature, low, high))
    if not candidates:
        return leaf
    feature, low, high = rng.choice(candidates)
    split = rng.uniform(low, high)
    left_rows = [row for row in samples if row[feature] <= split]
    right_rows = [row for row in samples if row[feature] > split]
    if not left_rows or not right_rows:
        return leaf
    split_counts[feature] += 1
    return {
        "feature": feature,
        "split": split,
        "left": _build_tree(left_rows, depth + 1, max_depth, rng, split_counts),
        "right": _build_tree(right_rows, depth + 1, max_depth, rng, split_counts),
        "size": size,
    }


def _path_length(point, node, depth=0):
    feature = node["feature"]
    if feature is None:
        return depth + _average_path_length(int(node["size"]))
    child = node["left"] if point[int(feature)] <= float(node["split"]) else node["right"]
    return _path_length(point, child, depth + 1)


def _isolation_score(current, training, seed):
    rng = Random(seed)
    sample_size = min(len(training), MAX_SAMPLE_SIZE)
    max_depth = ceil(log2(max(sample_size, 2)))
    split_counts = [0 for _ in FEATURE_NAMES]
    paths = []
    for _ in range(TREE_COUNT):
        sample = training if len(training) <= sample_size else rng.sample(training, sample_size)
        tree = _build_tree(sample, 0, max_depth, rng, split_counts)
        paths.append(_path_length(current, tree))
    normalizer = _average_path_length(sample_size)
    if normalizer <= 0:
        return 0.5, split_counts
    score = 2.0 ** (-(sum(paths) / len(paths)) / normalizer)
    return max(0.0, min(1.0, score)), split_counts


def _reference_now(
    sources: list[dict[str, Any]],
    observations: list[dict[str, Any]],
    supplied: datetime | None,
) -> datetime:
    if supplied is not None:
        return supplied.replace(tzinfo=timezone.utc) if supplied.tzinfo is None else supplied.astimezone(timezone.utc)
    latest = [
        parsed for row in observations
        if (parsed := _parse_time(row.get("observed_at"))) is not None
    ]
    return max(latest) if latest else datetime.now(timezone.utc)


def _is_fresh(source: dict[str, Any], rows: list[tuple[datetime, float]], now: datetime) -> bool:
    if not rows or source.get("freshness_status", "fresh") != "fresh":
        return False
    latest = rows[-1][0]
    interval = _interval_seconds(source)
    try:
        stale_after = int(source.get("stale_after_seconds") or max(1800, interval * 3))
    except (TypeError, ValueError):
        stale_after = max(1800, interval * 3)
    return max(0.0, (now - latest).total_seconds()) <= stale_after


def _signal_model(
    source: dict[str, Any],
    observations: list[dict[str, Any]],
    now: datetime,
) -> dict[str, Any]:
    source_id = str(source.get("source_id") or "")
    interval = _interval_seconds(source)
    rows = _valid_rows(source_id, observations)
    features = _features(rows, interval)
    fresh = _is_fresh(source, rows, now)
    result = {
        "source_id": source_id,
        "signal": source.get("signal"),
        "display_name": source.get("display_name") or source_id,
        "sample_count": len(rows),
        "training_samples": max(0, len(features) - 1),
        "expected_interval_seconds": interval,
        "score": None,
        "status": "collecting_history" if fresh else "stale_data",
        "status_label": "در حال جمع‌آوری تاریخچه" if fresh else "دادهٔ تازه برای امتیازدهی موجود نیست",
        "is_anomaly": False,
        "dominant_feature": None,
        "dominant_feature_label": "هنوز قابل تعیین نیست",
        "interpretation": (
            f"برای آموزش اولیهٔ مدل حداقل {MIN_RAW_POINTS} مشاهدهٔ معتبر و تاریخچهٔ پیوسته لازم است."
            if fresh else "آخرین مشاهدهٔ معتبر برای امتیازدهی فعلی به‌اندازهٔ کافی تازه نیست."
        ),
    }
    if not fresh or len(rows) < MIN_RAW_POINTS or len(features) - 1 < MIN_TRAINING_POINTS:
        return result

    seed = sum((index + 1) * ord(char) for index, char in enumerate(source_id))
    forest_score, split_counts = _isolation_score(features[-1], features[:-1], seed)
    latest_features = features[-1]
    robust_distance = max(
        abs(latest_features[1]) / 10.0,
        abs(latest_features[2]) / 3.0,
    )
    robust_score = 0.5 + 0.5 * (1.0 - exp(-robust_distance))
    score = 0.55 * forest_score + 0.45 * robust_score
    dominant = max(range(len(split_counts)), key=lambda index: split_counts[index])
    flagged = score >= ANOMALY_THRESHOLD
    if flagged:
        label = "رفتار غیرمعمول"
        interpretation = (
            "ترکیب سطح سیگنال، نرخ تغییر نرمال‌شده و فاصله از خط مبنای یک‌ساعته "
            "با رفتار تاریخی این شاخص تفاوت دارد؛ این امتیاز به‌تنهایی اثبات اختلال نیست."
        )
    elif score >= 0.58:
        label = "نیازمند توجه"
        interpretation = "مدل تغییری برای بررسی دیده، اما شدت آن به آستانهٔ ناهنجاری نرسیده است."
    else:
        label = "در محدودهٔ معمول تاریخچه"
        interpretation = "رفتار فعلی از دید مدل بدون‌نظارت به الگوی معمول تاریخی نزدیک است."
    result.update({
        "score": round(score, 3),
        "status": "ready",
        "status_label": label,
        "is_anomaly": flagged,
        "dominant_feature": FEATURE_NAMES[dominant],
        "dominant_feature_label": FEATURE_NAMES[dominant],
        "feature_split_counts": {FEATURE_NAMES[i]: split_counts[i] for i in range(len(FEATURE_NAMES))},
        "isolation_forest_score": round(forest_score, 3),
        "robust_deviation_score": round(robust_score, 3),
        "interpretation": interpretation,
    })
    return result


def _forecast_component(
    signal: str,
    rows: list[tuple[datetime, float]],
    model: dict[str, Any],
    source: dict[str, Any],
    now: datetime,
) -> dict[str, Any]:
    interval = _interval_seconds(source)
    if not _is_fresh(source, rows, now):
        return {
            "signal": signal,
            "available": False,
            "reason": "دادهٔ تازه برای این شاخص موجود نیست",
            "sample_count": len(rows),
        }
    latest_time = rows[-1][0]
    recent_start = latest_time - timedelta(minutes=FORECAST_WINDOW_MINUTES)
    previous_start = recent_start - timedelta(minutes=FORECAST_WINDOW_MINUTES)
    previous = _window_values(rows, previous_start, recent_start - timedelta(microseconds=1))
    recent = _window_values(rows, recent_start, latest_time)
    minimum = _minimum_window_samples(interval, FORECAST_WINDOW_MINUTES)
    age_seconds = max(0.0, (now - latest_time).total_seconds())
    if len(previous) < minimum or len(recent) < minimum:
        return {
            "signal": signal,
            "available": False,
            "reason": "در هر دو پنجرهٔ ۳۰ دقیقه‌ای نمونهٔ کافی وجود ندارد",
            "sample_count": len(rows),
            "previous_window_samples": len(previous),
            "recent_window_samples": len(recent),
            "observation_age_seconds": round(age_seconds),
        }

    previous_median = median(previous)
    recent_median = median(recent)
    latest = rows[-1][1]
    if abs(previous_median) < 1e-9:
        return {
            "signal": signal,
            "available": False,
            "reason": "خط مبنای نزدیک صفر اجازهٔ محاسبهٔ درصد تغییر نمی‌دهد",
            "sample_count": len(rows),
        }
    change = (recent_median - previous_median) / abs(previous_median) * 100.0
    change = max(-80.0, min(80.0, change))
    projected = max(0.0, latest * (1.0 + change / 100.0))
    return {
        "signal": signal,
        "available": True,
        "current_value": round(latest, 2),
        "previous_window_median": round(previous_median, 2),
        "recent_window_median": round(recent_median, 2),
        "projected_value_30m": round(projected, 2),
        "projected_change_30m_percent": round(change, 1),
        "anomaly_score": model.get("score"),
        "sample_count": len(rows),
        "previous_window_samples": len(previous),
        "recent_window_samples": len(recent),
        "observation_age_seconds": round(age_seconds),
        "expected_interval_seconds": interval,
    }


def _signal_trend(
    source: dict[str, Any],
    observations: list[dict[str, Any]],
    now: datetime,
) -> dict[str, Any]:
    signal = source.get("signal")
    source_id = str(source.get("source_id") or "")
    rows = _valid_rows(source_id, observations)
    interval = _interval_seconds(source)
    result = {
        "signal": signal,
        "source_id": source_id,
        "display_name": source.get("display_name") or source_id,
        "sample_count": len(rows),
        "change_percent": None,
        "status": "insufficient_history",
    }
    if not _is_fresh(source, rows, now):
        result["status"] = "stale_data"
        return result
    latest_time = rows[-1][0]
    recent_start = latest_time - timedelta(minutes=FORECAST_WINDOW_MINUTES)
    previous_start = recent_start - timedelta(minutes=FORECAST_WINDOW_MINUTES)
    previous = _window_values(rows, previous_start, recent_start - timedelta(microseconds=1))
    recent = _window_values(rows, recent_start, latest_time)
    minimum = _minimum_window_samples(interval, FORECAST_WINDOW_MINUTES)
    if len(previous) < minimum or len(recent) < minimum:
        return result
    previous_median = median(previous)
    if abs(previous_median) < 1e-9:
        return result
    result.update({
        "change_percent": round((median(recent) - previous_median) / abs(previous_median) * 100.0, 1),
        "status": "ready",
        "previous_window_samples": len(previous),
        "recent_window_samples": len(recent),
        "observation_age_seconds": round((now - latest_time).total_seconds()),
    })
    return result


def _cause_analysis(trends: list[dict[str, Any]]) -> dict[str, Any]:
    by_signal = {item.get("signal"): item for item in trends}
    bgp = by_signal.get("bgp", {})
    ping = by_signal.get("ping-slash24", {})
    merit = by_signal.get("merit-nt", {})

    def declining(item: dict[str, Any]) -> bool:
        value = item.get("change_percent")
        return item.get("status") == "ready" and isinstance(value, (int, float)) and value <= -8.0

    bgp_drop = declining(bgp)
    ping_drop = declining(ping)
    merit_drop = declining(merit)
    corroborating = [
        name for name, active in (("BGP", bgp_drop), ("Ping", ping_drop), ("Merit", merit_drop))
        if active
    ]

    if bgp_drop and ping_drop:
        hypothesis = "widespread_connectivity_degradation"
        label = "افت هم‌زمان دیدپذیری مسیرها و پاسخ‌گویی شبکه"
        strength = "strong" if merit_drop else "corroborated"
        description = (
            "دو شاخص اصلی در دو پنجرهٔ ۳۰ دقیقه‌ای هم‌طول افت کرده‌اند. "
            "این الگو با کاهش گستردهٔ دسترسی سازگار است؛ اما علت یا گسترهٔ قطعی را اثبات نمی‌کند."
        )
    elif bgp_drop:
        hypothesis = "routing_visibility_change"
        label = "کاهش دیدپذیری مسیرهای BGP"
        strength = "limited"
        description = "افت در BGP دیده شده، اما شاخص پایش فعال آن را هم‌زمان تأیید نمی‌کند."
    elif ping_drop:
        hypothesis = "active_reachability_change"
        label = "کاهش پاسخ‌گویی در پایش فعال"
        strength = "limited"
        description = "افت در پایش فعال دیده شده، اما BGP آن را هم‌زمان تأیید نمی‌کند."
    elif merit_drop:
        hypothesis = "telemetry_or_traffic_change"
        label = "تغییر در سیگنال تلسکوپ شبکه"
        strength = "weak"
        description = "تغییر فقط در تلسکوپ شبکه دیده شده؛ این شاهد به‌تنهایی علت اختلال را مشخص نمی‌کند."
    else:
        hypothesis = "insufficient_evidence"
        label = "علت مشخصی از داده‌های فعلی قابل استنتاج نیست"
        strength = "none"
        description = (
            "در پنجره‌های هم‌طول شواهد کافی برای یک فرضیهٔ علّی هم‌زمان وجود ندارد. "
            "نبود شواهد، اثبات سلامت کامل شبکه نیست."
        )

    alternatives = []
    if bgp_drop and not ping_drop:
        alternatives = ["تغییر دیدپذیری یا مسیریابی", "تغییر پوشش یا کیفیت دادهٔ BGP"]
    elif ping_drop and not bgp_drop:
        alternatives = ["تغییر دسترس‌پذیری نقاط پایش فعال", "ناپایداری مسیر یا مقصدهای آزمون"]
    elif bgp_drop and ping_drop:
        alternatives = ["کاهش گستردهٔ اتصال", "اختلال هم‌زمان در چند منبع اندازه‌گیری"]
    elif merit_drop:
        alternatives = ["تغییر ترافیک مشاهده‌شده", "تغییر پوشش تلسکوپ شبکه"]

    return {
        "status": "hypothesis" if strength != "none" else "insufficient_evidence",
        "hypothesis_id": hypothesis,
        "hypothesis_label": label,
        "evidence_strength": strength,
        "evidence_strength_label": {
            "strong": "سه سیگنال هم‌جهت",
            "corroborated": "دو شاخص اصلی هم‌راستا",
            "limited": "فقط یک شاخص اصلی",
            "weak": "فقط یک شاخص کمکی",
            "none": "شواهد ناکافی",
        }[strength],
        "description": description,
        "corroborating_signals": corroborating,
        "observed_changes": trends,
        "alternative_explanations": alternatives,
        "scope_note": (
            "این‌ها فرضیه‌های مبتنی بر تغییرات زمانی هم‌طول‌اند، نه تشخیص علت قطعی. "
            "داده‌های فعلی برای تفکیک فیلترینگ، خرابی زیرساخت، مشکل اپراتور یا محدودیت جغرافیایی کافی نیستند."
        ),
    }


def analyze_intelligence(
    sources: list[dict[str, Any]],
    observations: list[dict[str, Any]],
    *,
    now: datetime | None = None,
) -> dict[str, Any]:
    reference_now = _reference_now(sources, observations, now)
    models = [_signal_model(source, observations, reference_now) for source in sources]
    trained = [item for item in models if item["status"] == "ready"]
    trends = [_signal_trend(source, observations, reference_now) for source in sources]
    causes = _cause_analysis(trends)
    by_signal = {source.get("signal"): source for source in sources}
    rows_by_signal = {
        source.get("signal"): _valid_rows(str(source.get("source_id") or ""), observations)
        for source in sources
    }
    model_by_signal = {item.get("signal"): item for item in models}
    components = [
        _forecast_component(
            signal,
            rows_by_signal.get(signal, []),
            model_by_signal.get(signal, {}),
            by_signal.get(signal, {}),
            reference_now,
        )
        for signal in ("bgp", "ping-slash24")
    ]
    available_components = [item for item in components if item.get("available")]
    available = len(available_components) == 2
    risk_index = None
    risk_level = "unknown"
    risk_label = "دادهٔ هم‌زمان کافی برای برآورد وجود ندارد"
    if available:
        pressures = [
            min(100.0, max(0.0, -float(item["projected_change_30m_percent"])) * 2.5)
            for item in available_components
        ]
        model_pressure = [
            min(100.0, max(0.0, (float(item["anomaly_score"] or 0.5) - 0.5) * 200.0))
            for item in available_components
        ]
        agreement_bonus = (
            15.0
            if all(float(item["projected_change_30m_percent"]) <= -8.0 for item in available_components)
            else 0.0
        )
        risk = (
            0.65 * max(pressures)
            + 0.20 * sum(pressures) / len(pressures)
            + 0.15 * sum(model_pressure) / len(model_pressure)
            + agreement_bonus
        )
        risk_index = round(min(100.0, max(0.0, risk)))
        if risk_index >= 60:
            risk_level, risk_label = "elevated", "نشانه‌های افت قوی‌تر؛ نیازمند بررسی فوری"
        elif risk_index >= 30:
            risk_level, risk_label = "watch", "نشانه‌هایی برای پایش نزدیک‌تر"
        else:
            risk_level, risk_label = "low", "در پنجره‌های فعلی افت پرقدرتی مشاهده نمی‌شود"

    note = (
        "شاخص ریسک، احتمال آماری کالیبره‌شده نیست. امتداد روند از دو پنجرهٔ ۳۰ دقیقه‌ای هم‌طول، "
        "همراه با امتیاز ناهنجاری ساخته می‌شود؛ ممکن است با تغییر منبع یا پوشش خطا کند."
        if available else
        "برای برآورد، هر دو شاخص اصلی باید دادهٔ تازه و نمونهٔ کافی در دو پنجرهٔ ۳۰ دقیقه‌ای داشته باشند. "
        "دادهٔ ناکافی به معنی ریسک صفر نیست."
    )
    return {
        "model_name": MODEL_NAME,
        "model_family": "unsupervised_anomaly_detection",
        "model_status": "ready" if trained else "collecting_history",
        "model_status_label": (
            f"مدل فعال برای {len(trained)} شاخص"
            if trained else "در حال جمع‌آوری تاریخچهٔ تازه برای آموزش اولیه"
        ),
        "trained_signals": len(trained),
        "minimum_raw_points": MIN_RAW_POINTS,
        "feature_window_minutes": FEATURE_WINDOW_MINUTES,
        "signals": models,
        "cause_analysis": causes,
        "recovery_estimate": {
            "available": False,
            "estimated_duration_minutes": None,
            "status": "insufficient_labeled_events",
            "note": (
                "برای تخمین زمان بازیابی به رخدادهای تاریخیِ تأییدشده با زمان شروع و پایان، "
                "شدت و ارزیابی خارج از نمونه نیاز است؛ دادهٔ فعلی چنین برچسبی ندارد."
            ),
        },
        "forecast": {
            "available": available,
            "horizon_minutes": FORECAST_WINDOW_MINUTES,
            "comparison_window_minutes": FORECAST_WINDOW_MINUTES,
            "risk_index": risk_index,
            "risk_level": risk_level,
            "risk_label": risk_label,
            "components": components,
            "calibrated_probability": None,
            "note": note,
        },
        "method_note": (
            "ترکیب Isolation Forest بدون‌نظارت و انحراف مقاوم؛ تغییر هر نمونه بر حسب زمان واقعی "
            "به نرخ ساعتی تبدیل می‌شود و فاصله از خط مبنا در پنجرهٔ ۶۰ دقیقه‌ای سنجیده می‌شود."
        ),
    }
