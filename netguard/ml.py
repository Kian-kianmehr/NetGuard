from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from math import ceil, exp, isfinite, log1p, log2
from random import Random
from statistics import median
from typing import Any

from netguard.deep_learning import forecast_series


MODEL_NAME = "Neural Temporal MLP + Isolation Forest Ensemble"
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
    feature_count = len(samples[0]) if samples else len(FEATURE_NAMES)
    for feature in range(feature_count):
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
    split_counts = [0 for _ in range(len(current))]
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


def _stale_after_seconds(source: dict[str, Any]) -> int:
    interval = _interval_seconds(source)
    try:
        return max(1, int(source.get("stale_after_seconds") or max(1800, interval * 3)))
    except (TypeError, ValueError):
        return max(1800, interval * 3)


def _is_fresh(source: dict[str, Any], rows: list[tuple[datetime, float]], now: datetime) -> bool:
    if not rows or source.get("freshness_status", "fresh") != "fresh":
        return False
    latest = rows[-1][0]
    return max(0.0, (now - latest).total_seconds()) <= _stale_after_seconds(source)


def _signal_model(
    source: dict[str, Any],
    observations: list[dict[str, Any]],
    now: datetime,
) -> dict[str, Any]:
    source_id = str(source.get("source_id") or "")
    interval = _interval_seconds(source)
    rows = _valid_rows(source_id, observations)
    features = _features(rows, interval)
    source_fresh = _is_fresh(source, rows, now)
    observation_age = (
        max(0.0, (now - rows[-1][0]).total_seconds()) if rows else None
    )
    stale_after = _stale_after_seconds(source)
    fresh = source_fresh
    result = {
        "source_id": source_id,
        "signal": source.get("signal"),
        "display_name": source.get("display_name") or source_id,
        "sample_count": len(rows),
        "training_samples": max(0, len(features) - 1),
        "expected_interval_seconds": interval,
        "observation_age_seconds": round(observation_age) if observation_age is not None else None,
        "cadence_delay_after_seconds": stale_after,
        "score": None,
        "status": "collecting_history" if fresh else "stale_data",
        "status_label": (
            "در حال جمع‌آوری تاریخچه" if fresh
            else "آخرین مشاهده از پنجرهٔ تازگی منبع عبور کرده است"
        ),
        "is_anomaly": False,
        "dominant_feature": None,
        "dominant_feature_label": "هنوز قابل تعیین نیست",
        "interpretation": (
            f"برای آموزش اولیهٔ مدل حداقل {MIN_RAW_POINTS} مشاهدهٔ معتبر و تاریخچهٔ پیوسته لازم است."
            if fresh else (
                f"آخرین مشاهده {round(observation_age / 60)} دقیقه قبل ثبت شده و از پنجرهٔ "
                f"تازگی {round(stale_after / 60)} دقیقه‌ای این منبع عبور کرده است."
                if observation_age is not None else
                "آخرین مشاهدهٔ معتبر برای امتیازدهی فعلی به‌اندازهٔ کافی تازه نیست."
            )
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
    if not rows or source.get("freshness_status", "fresh") != "fresh":
        return {
            "signal": signal,
            "available": False,
            "reason": "Collector این منبع را در وضعیت تازه/سالم گزارش نکرده است",
            "sample_count": len(rows),
        }
    latest_time = rows[-1][0]
    age_seconds = max(0.0, (now - latest_time).total_seconds())
    maximum_forecast_age = _stale_after_seconds(source)
    if age_seconds > maximum_forecast_age:
        return {
            "signal": signal,
            "available": False,
            "reason": (
                f"آخرین مشاهده {round(age_seconds / 60)} دقیقه قبل ثبت شده و از "
                f"آستانهٔ تازگی {round(maximum_forecast_age / 60)} دقیقه‌ای این منبع عبور کرده است"
            ),
            "sample_count": len(rows),
            "observation_age_seconds": round(age_seconds),
            "expected_interval_seconds": interval,
        }
    recent_start = latest_time - timedelta(minutes=FORECAST_WINDOW_MINUTES)
    previous_start = recent_start - timedelta(minutes=FORECAST_WINDOW_MINUTES)
    previous = _window_values(rows, previous_start, recent_start - timedelta(microseconds=1))
    recent = _window_values(rows, recent_start, latest_time)
    minimum = _minimum_window_samples(interval, FORECAST_WINDOW_MINUTES)
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
            "reason": "خط مبنای نزدیک صفر اجازهٔ محاسبهٔ درصد تغییر را نمی‌دهد",
            "sample_count": len(rows),
        }

    neural = forecast_series(
        [value for _, value in rows],
        [timestamp.timestamp() for timestamp, _ in rows],
        interval,
    )
    if not neural.get("available"):
        return {
            "signal": signal,
            "available": False,
            "reason": neural.get("reason") or "مدل یادگیری عمیق هنوز آماده نیست",
            "sample_count": len(rows),
            "previous_window_samples": len(previous),
            "recent_window_samples": len(recent),
            "observation_age_seconds": round(age_seconds),
            "expected_interval_seconds": interval,
            "neural_model": neural,
        }

    horizon_projections = []
    for point in neural.get("projections", []):
        projected_value = float(point["projected_value"])
        projected_change = (
            (projected_value - latest) / max(abs(latest), 1e-9) * 100.0
        )
        horizon_projections.append({
            **point,
            "projected_change_percent": round(projected_change, 2),
        })
    projection_30 = next(
        (item for item in horizon_projections if item["minutes"] == 30),
        horizon_projections[0] if horizon_projections else None,
    )
    if projection_30 is None:
        return {
            "signal": signal,
            "available": False,
            "reason": "مدل برای افق درخواستی خروجی تولید نکرد",
            "sample_count": len(rows),
            "neural_model": neural,
        }
    change = projection_30["projected_change_percent"]
    return {
        "signal": signal,
        "available": True,
        "current_value": round(latest, 2),
        "previous_window_median": round(previous_median, 2),
        "recent_window_median": round(recent_median, 2),
        "projected_value_30m": round(float(projection_30["projected_value"]), 2),
        "projected_change_30m_percent": round(change, 2),
        "horizon_projections": horizon_projections,
        "anomaly_score": model.get("score"),
        "sample_count": len(rows),
        "previous_window_samples": len(previous),
        "recent_window_samples": len(recent),
        "observation_age_seconds": round(age_seconds),
        "expected_interval_seconds": interval,
        "forecast_model": neural.get("model_name"),
        "forecast_architecture": neural.get("architecture"),
        "validation_mae_percent": neural.get("validation_mae_percent"),
        "baseline_mae_percent": neural.get("baseline_mae_percent"),
        "model_skill_percent": neural.get("model_skill_percent"),
        "neural_model": neural,
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
    observation_age = max(0.0, (now - latest_time).total_seconds())
    result["observation_age_seconds"] = round(observation_age)
    if observation_age > _stale_after_seconds(source):
        result["status"] = "stale_data"
        result["stale_reason"] = "آخرین مشاهده از پنجرهٔ تازگی تعریف‌شده برای منبع عبور کرده است"
        return result
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


def _joint_signal_model(
    sources: list[dict[str, Any]],
    observations: list[dict[str, Any]],
    now: datetime,
) -> dict[str, Any]:
    """Detect unusual co-movement across aligned 10-minute signal buckets."""
    source_by_signal = {str(source.get("signal")): source for source in sources}
    required = ("bgp", "ping-slash24")
    bucketed: dict[str, dict[int, list[float]]] = {}

    for signal in ("bgp", "ping-slash24", "merit-nt"):
        source = source_by_signal.get(signal)
        if source is None:
            continue
        rows = _valid_rows(str(source.get("source_id") or ""), observations)
        if not rows or not _is_fresh(source, rows, now):
            if signal in required:
                return {"available": False, "status": "stale_data", "status_label": "دادهٔ تازهٔ هر دو شاخص اصلی لازم است", "reason": f"دادهٔ تازهٔ {signal} موجود نیست", "score": None}
            continue
        interval = _interval_seconds(source)
        if max(0.0, (now - rows[-1][0]).total_seconds()) > _stale_after_seconds(source):
            if signal in required:
                return {"available": False, "status": "stale_data", "status_label": "آخرین مشاهدهٔ یکی از شاخص‌های اصلی از پنجرهٔ تازگی عبور کرده است", "reason": f"آخرین مشاهدهٔ {signal} از آستانهٔ تازگی همان منبع عبور کرده است", "score": None}
            continue
        buckets: dict[int, list[float]] = defaultdict(list)
        for timestamp, value in rows:
            buckets[int(timestamp.timestamp() // 600)].append(value)
        bucketed[signal] = buckets

    if any(signal not in bucketed for signal in required):
        return {"available": False, "status": "insufficient_history", "status_label": "تاریخچهٔ هم‌زمان BGP و Ping کافی نیست", "reason": "هر دو شاخص اصلی برای ساخت بردار مشترک لازم‌اند", "score": None}

    common = sorted(set(bucketed["bgp"]).intersection(bucketed["ping-slash24"]))
    if not common:
        return {"available": False, "status": "insufficient_history", "status_label": "نمونهٔ هم‌زمانی پیدا نشد", "reason": "تاریخچهٔ دو شاخص اصلی در بازه‌های ۱۰ دقیقه‌ای هم‌تراز نیست", "score": None}

    latest_bucket_end = datetime.fromtimestamp((common[-1] + 1) * 600, tz=timezone.utc)
    aligned_age = max(0.0, (now - latest_bucket_end).total_seconds())
    joint_freshness_limit = min(
        _stale_after_seconds(source_by_signal[signal]) for signal in required
    )
    if aligned_age > joint_freshness_limit:
        return {"available": False, "status": "stale_data", "status_label": "آخرین پنجرهٔ مشترک از پنجرهٔ تازگی شاخص‌های اصلی عبور کرده است", "reason": "آخرین بازهٔ مشترک خارج از آستانهٔ تازگی BGP یا پایش فعال است", "score": None}

    active = list(required)
    merit = bucketed.get("merit-nt", {})
    if merit and sum(1 for bucket in common if bucket in merit) / len(common) >= 0.70:
        active.append("merit-nt")

    aligned = []
    for bucket in common:
        if all(bucket in bucketed[signal] for signal in active):
            aligned.append((bucket, {signal: median(bucketed[signal][bucket]) for signal in active}))

    features: list[list[float]] = []
    for previous, current in zip(aligned, aligned[1:]):
        previous_bucket, previous_values = previous
        current_bucket, current_values = current
        elapsed_minutes = (current_bucket - previous_bucket) * 10.0
        if elapsed_minutes <= 0 or elapsed_minutes > 30:
            continue
        vector = []
        for signal in active:
            before, after = previous_values[signal], current_values[signal]
            rate = ((after - before) / max(abs(before), 1.0)) * 3600.0 / (elapsed_minutes * 60.0) * 100.0
            vector.append(max(-300.0, min(300.0, rate)))
        features.append(vector)

    if len(features) < MIN_RAW_POINTS or len(features) - 1 < MIN_TRAINING_POINTS:
        return {
            "available": False,
            "status": "insufficient_history",
            "status_label": "تاریخچهٔ هم‌زمان برای مدل چندشاخصی کافی نیست",
            "reason": f"{len(features)} بردار ساخته شد؛ حداقل {MIN_RAW_POINTS} بردار لازم است",
            "score": None,
            "sample_count": len(features),
            "active_signals": active,
        }

    forest, splits = _isolation_score(features[-1], features[:-1], 9142026 + len(active) * 101)
    robust_distances = []
    for index in range(len(active)):
        history = [row[index] for row in features[:-1]]
        center = median(history)
        mad = median([abs(value - center) for value in history])
        robust_distances.append(abs(features[-1][index] - center) / max(1.4826 * mad, 1.0))
    robust = 0.5 + 0.5 * (1.0 - exp(-max(robust_distances, default=0.0)))
    score = 0.65 * forest + 0.35 * robust
    dominant = max(range(len(splits)), key=lambda index: splits[index])
    labels = {"bgp": "تغییر دیدپذیری BGP", "ping-slash24": "تغییر پاسخ‌گویی Ping", "merit-nt": "تغییر تلسکوپ شبکه"}
    flagged = score >= ANOMALY_THRESHOLD
    return {
        "available": True,
        "status": "ready",
        "status_label": "ناهنجاری هم‌زمان چندشاخصی" if flagged else "الگوی مشترک نزدیک به تاریخچه",
        "score": round(score, 3),
        "is_anomaly": flagged,
        "threshold": ANOMALY_THRESHOLD,
        "isolation_forest_score": round(forest, 3),
        "robust_deviation_score": round(robust, 3),
        "sample_count": len(features),
        "training_samples": len(features) - 1,
        "bucket_minutes": 10,
        "active_signals": active,
        "active_signal_labels": [labels[signal] for signal in active],
        "dominant_feature_label": labels[active[dominant]],
        "feature_split_counts": {labels[signal]: splits[index] for index, signal in enumerate(active)},
        "observation_age_seconds": round(aligned_age),
        "interpretation": (
            "مدل بدون‌نظارت در تغییرات هم‌زمان شاخص‌ها الگوی متفاوتی دیده است؛ این امتیاز علت یا خاموشی را اثبات نمی‌کند."
            if flagged else
            "تغییرات هم‌زمان شاخص‌های موجود به الگوی تاریخی نزدیک است؛ این نتیجه سلامت کامل اینترنت را ثابت نمی‌کند."
        ),
    }



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



def _analysis_brief(
    models: list[dict[str, Any]],
    joint_model: dict[str, Any],
    forecast: dict[str, Any],
    now: datetime,
) -> dict[str, Any]:
    """Turn model outputs into a concise, evidence-linked public assessment."""
    ready = [item for item in models if item.get("status") == "ready"]
    stale = [item for item in models if item.get("status") == "stale_data"]
    anomalies = [item for item in ready if item.get("is_anomaly")]
    primary = {item.get("signal"): item for item in models if item.get("signal") in {"bgp", "ping-slash24"}}
    ready_primary = [
        primary[signal] for signal in ("bgp", "ping-slash24")
        if signal in primary and primary[signal].get("status") == "ready"
    ]
    forecast_components = [
        item for item in forecast.get("components", []) if item.get("available")
    ]
    evidence: list[str] = []
    limitations: list[str] = []

    for item in anomalies:
        evidence.append(
            f"{item.get('display_name')}: امتیاز ناهنجاری {float(item.get('score') or 0):.2f} "
            f"از آستانهٔ {ANOMALY_THRESHOLD:.2f} عبور کرده است."
        )
    if joint_model.get("available"):
        evidence.append(
            f"مدل هم‌زمانی، {int(joint_model.get('sample_count') or 0)} بازهٔ هم‌تراز را "
            f"در {len(joint_model.get('active_signals') or [])} شاخص بررسی کرده است؛ "
            f"امتیاز {float(joint_model.get('score') or 0):.2f}."
        )
    for item in forecast_components:
        delta = float(item.get("projected_change_30m_percent") or 0)
        direction = "افزایش" if delta > 0.05 else "کاهش" if delta < -0.05 else "تغییر ناچیز"
        signal_label = (
            "پایش فعال شبکه" if item.get("signal") == "ping-slash24"
            else "دیدپذیری BGP" if item.get("signal") == "bgp"
            else str(item.get("signal"))
        )
        evidence.append(
            f"پیش‌بینی ۳۰ دقیقه‌ای {signal_label}: {direction} حدود {abs(delta):.2f}٪ "
            "در مقدار همان شاخص؛ این پیش‌بینی، احتمال اختلال نیست."
        )
    for item in ready:
        if not item.get("is_anomaly") and item.get("signal") in {"bgp", "ping-slash24"}:
            evidence.append(
                f"{item.get('display_name')}: امتیاز {float(item.get('score') or 0):.2f} "
                f"و پایین‌تر از آستانهٔ ناهنجاری {ANOMALY_THRESHOLD:.2f}."
            )
    for item in stale:
        age = item.get("observation_age_seconds")
        age_text = f"{round(float(age) / 60)} دقیقه" if age is not None else "زمان نامشخص"
        limitations.append(f"{item.get('display_name')}: دادهٔ آخر {age_text} قبل ثبت شده و برای نتیجه‌گیری جاری کافی نیست.")

    if anomalies or (joint_model.get("available") and joint_model.get("is_anomaly")):
        status = "alert"
        headline = "تغییر غیرمعمولی برای بررسی شناسایی شد"
        names = "، ".join(item.get("display_name") or item.get("signal") for item in anomalies)
        summary = (
            f"مدل در {names or 'الگوی هم‌زمان شاخص‌ها'} تفاوتی با رفتار تاریخی دیده است. "
            "این یک هشدار برای بررسی است؛ نه تأیید قطعی اختلال یا تعیین علت آن."
        )
    elif len(ready_primary) == 2:
        status = "normal"
        headline = "در شاخص‌های اصلی نشانهٔ هم‌زمانِ غیرعادی دیده نشد"
        summary = (
            "هر دو شاخص اصلی دادهٔ تازه و امتیاز قابل ارزیابی دارند و از آستانهٔ ناهنجاری عبور نکرده‌اند. "
            "این نتیجه فقط به شاخص‌های ملیِ موجود مربوط است و سلامت همهٔ اپراتورها و مناطق را ثابت نمی‌کند."
        )
    elif forecast_components:
        status = "limited"
        headline = "روند قابل تحلیل است، اما تصویر ملی هنوز کامل نیست"
        names = "، ".join(
            "پایش فعال" if item.get("signal") == "ping-slash24" else "دیدپذیری BGP"
            for item in forecast_components
        )
        summary = (
            f"در حال حاضر فقط {names} برای پیش‌بینی مستقل شرایط لازم را دارد. "
            "خروجی آن برای دنبال‌کردن روند کوتاه‌مدت مفید است، اما برای نتیجه‌گیری ملی باید شاخص‌های اصلی دیگر نیز تازه شوند."
        )
    elif ready:
        status = "limited"
        headline = "فقط بخشی از شواهد قابل ارزیابی است"
        summary = (
            "برای بعضی شاخص‌ها امتیاز جاری موجود است، اما دادهٔ هم‌زمان کافی برای پیش‌بینی یا جمع‌بندی ملی فراهم نیست."
        )
    else:
        status = "insufficient"
        headline = "دادهٔ تازه برای یک جمع‌بندی قابل اتکا کافی نیست"
        summary = (
            "مدل به‌جای حدس‌زدن، نتیجهٔ قطعی منتشر نمی‌کند. با رسیدن مشاهده‌های تازه و هم‌زمان، "
            "ارزیابی ناهنجاری و روند دوباره محاسبه می‌شود."
        )

    if stale:
        limitations.append("تا تازه‌شدن این منابع، نبود هشدار را نباید معادل نبود اختلال دانست.")
    if not forecast.get("available"):
        limitations.append("امتیاز ترکیبی ملی منتشر نشده؛ برای آن دادهٔ تازهٔ BGP و پایش فعال به‌طور هم‌زمان لازم است.")
    confidence = (
        "قوی‌تر؛ چند شاخص اصلی تازه" if len(ready_primary) == 2 and joint_model.get("available")
        else "متوسط؛ دو شاخص اصلی تازه" if len(ready_primary) == 2
        else "محدود؛ فقط بخشی از شاخص‌ها تازه‌اند" if ready_primary or ready
        else "ناکافی؛ دادهٔ تازه در دسترس نیست"
    )
    return {
        "status": status,
        "headline": headline,
        "summary": summary,
        "confidence_label": confidence,
        "evidence": evidence[:5],
        "limitations": limitations[:4],
        "fresh_primary_signals": len(ready_primary),
        "evaluated_signals": len(ready),
        "anomalous_signals": len(anomalies),
        "generated_at": now.isoformat(),
        "method": "model_evidence_synthesis",
        "scope_note": (
            "این جمع‌بندی از خروجی مدل‌های ناهنجاری، هم‌زمانی شاخص‌ها و پیش‌بینی سری زمانی ساخته شده است؛ "
            "متن آزادِ یک مدل زبانی یا تشخیص قطعی علت اختلال نیست."
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
    joint_model = _joint_signal_model(sources, observations, reference_now)
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
        if joint_model.get("available"):
            model_pressure.append(
                min(100.0, max(0.0, (float(joint_model["score"]) - 0.5) * 200.0))
            )
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

    unavailable_reasons = [
        (
            "BGP" if item.get("signal") == "bgp" else "پایش فعال",
            item.get("reason") or "دادهٔ کافی موجود نیست",
        )
        for item in components if not item.get("available")
    ]
    note = (
        "شاخص ریسک، احتمال آماری کالیبره‌شده نیست. امتداد روند از دو پنجرهٔ ۳۰ دقیقه‌ای هم‌طول، "
        "همراه با امتیاز ناهنجاری ساخته می‌شود؛ ممکن است با تغییر منبع یا پوشش خطا کند."
        if available else
        "برای انتشار امتیاز ترکیبی، هر دو شاخص اصلی باید تازه و دارای نمونهٔ کافی باشند. "
        + " ".join(f"{name}: {reason}." for name, reason in unavailable_reasons)
        + " دادهٔ ناکافی به معنی ریسک صفر نیست؛ پیش‌بینی مستقل شاخص واجد شرایط جداگانه نمایش داده می‌شود."
    )
    brief = _analysis_brief(models, joint_model, {
        "available": available,
        "components": components,
    }, reference_now)
    return {
        "analysis_brief": brief,
        "model_name": MODEL_NAME,
        "model_family": "per_signal_and_multivariate_anomaly_detection_plus_deep_learning_forecasting",
        "model_status": "ready" if trained else "collecting_history",
        "model_status_label": (
            f"مدل آمادهٔ امتیازدهی برای {len(trained)} شاخص"
            if trained else (
                "تاریخچه وجود دارد؛ برای امتیاز جاری باید مشاهدهٔ تازه برسد"
                if any(item.get("status") == "stale_data" and item.get("observation_age_seconds") is not None for item in models)
                else "در حال جمع‌آوری تاریخچهٔ تازه برای آموزش اولیه"
            )
        ),
        "trained_signals": len(trained),
        "minimum_raw_points": MIN_RAW_POINTS,
        "feature_window_minutes": FEATURE_WINDOW_MINUTES,
        "signals": models,
        "joint_model": joint_model,
        "deep_learning": {
            "model_name": "Two-hidden-layer temporal MLP",
            "architecture": "12-24-12-1",
            "sequence_length": 12,
            "hidden_layers": [24, 12],
            "minimum_training_sequences": 48,
            "validation_split_percent": 20,
            "available_signals": sum(1 for item in components if item.get("available")),
            "trained_signals": sum(1 for item in components if item.get("neural_model", {}).get("available")),
            "training_method": "chronological_holdout_with_persistence_baseline",
        },
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
            "تشخیص ناهنجاری مستقل و چندشاخصی با Isolation Forest و انحراف مقاوم؛ پیش‌بینی کوتاه‌مدت با شبکهٔ عصبی MLP دارای دو لایهٔ پنهان و توالی ورودی ۱۲ نمونه‌ای. "
            "مدل با ۸۰٪ توالی‌های قدیمی‌تر آموزش می‌بیند و با ۲۰٪ انتهاییِ کنارگذاشته‌شده ارزیابی می‌شود. "
            "پیش‌بینی ۱۵، ۳۰ و ۶۰ دقیقه‌ای به‌صورت بازگشتی از خروجی شبکهٔ عصبی ساخته می‌شود؛ "
            "این برآوردها احتمال آماری کالیبره‌شده نیستند."
        ),
    }
