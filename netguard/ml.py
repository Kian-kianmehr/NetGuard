from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from math import ceil, exp, isfinite, log1p, log2
from random import Random
from statistics import median
from typing import Any

MODEL_NAME = "Hybrid Isolation Forest"
FEATURE_NAMES = ("سطح سیگنال", "تغییر کوتاه‌مدت", "فاصله از خط مبنا")
MIN_RAW_POINTS = 45
MIN_TRAINING_POINTS = 32
FEATURE_WINDOW = 12
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


def _features(rows: list[tuple[datetime, float]]) -> list[list[float]]:
    values = [item[1] for item in rows]
    output = []
    for index in range(FEATURE_WINDOW, len(values)):
        baseline = values[index - FEATURE_WINDOW:index]
        center = median(baseline)
        mad = median([abs(item - center) for item in baseline])
        scale = max(1.4826 * mad, abs(center) * 0.02, 1.0)
        previous = values[index - 1]
        change = (values[index] - previous) / max(abs(previous), 1.0) * 100.0
        deviation = (values[index] - center) / scale
        output.append([log1p(values[index]), max(-300.0, min(300.0, change)), max(-12.0, min(12.0, deviation))])
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
        "feature": feature, "split": split,
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


def _signal_model(source, observations):
    source_id = str(source.get("source_id") or "")
    rows = _valid_rows(source_id, observations)
    features = _features(rows)
    result = {
        "source_id": source_id,
        "signal": source.get("signal"),
        "display_name": source.get("display_name") or source_id,
        "sample_count": len(rows),
        "training_samples": max(0, len(features) - 1),
        "score": None,
        "status": "collecting_history",
        "status_label": "در حال جمع‌آوری تاریخچه",
        "is_anomaly": False,
        "dominant_feature": None,
        "dominant_feature_label": "هنوز قابل تعیین نیست",
        "interpretation": f"برای آموزش اولیهٔ مدل حداقل {MIN_RAW_POINTS} مشاهدهٔ معتبر از این شاخص لازم است.",
    }
    if len(rows) < MIN_RAW_POINTS or len(features) - 1 < MIN_TRAINING_POINTS:
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
        interpretation = "ترکیب سطح سیگنال، تغییر کوتاه‌مدت و فاصله از خط مبنا نسبت به تاریخچهٔ این شاخص کمتر معمول است؛ این امتیاز به‌تنهایی اثبات اختلال نیست."
    elif score >= 0.58:
        label = "نیازمند توجه"
        interpretation = "مدل یک تغییر قابل بررسی دیده، اما شدت آن برای برچسب ناهنجاری کافی نیست."
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


def _forecast_component(signal, rows, model):
    if len(rows) < 12:
        return None
    values = [item[1] for item in rows]
    previous = median(values[-12:-6])
    recent = median(values[-6:])
    latest = values[-1]
    if abs(previous) < 1e-9:
        return None
    change = (recent - previous) / abs(previous) * 100.0
    change = max(-80.0, min(80.0, change))
    projected = max(0.0, latest * (1.0 + change / 100.0))
    return {
        "signal": signal,
        "current_value": round(latest, 2),
        "projected_value_30m": round(projected, 2),
        "projected_change_30m_percent": round(change, 1),
        "anomaly_score": model.get("score"),
        "sample_count": len(rows),
    }


def analyze_intelligence(sources: list[dict[str, Any]], observations: list[dict[str, Any]]) -> dict[str, Any]:
    models = [_signal_model(source, observations) for source in sources]
    trained = [item for item in models if item["status"] == "ready"]
    grouped = defaultdict(list)
    for source in sources:
        signal = source.get("signal")
        if signal in {"bgp", "ping-slash24"}:
            grouped[signal] = _valid_rows(str(source.get("source_id") or ""), observations)
    model_by_signal = {item.get("signal"): item for item in models}
    components = [
        component for signal in ("bgp", "ping-slash24")
        if (component := _forecast_component(signal, grouped.get(signal, []), model_by_signal.get(signal, {}))) is not None
    ]
    available = len(components) == 2
    risk_index = None
    risk_level = "unknown"
    risk_label = "دادهٔ کافی برای برآورد وجود ندارد"
    if available:
        pressures = [min(100.0, max(0.0, -float(item["projected_change_30m_percent"])) * 2.5) for item in components]
        model_pressure = [min(100.0, max(0.0, (float(item["anomaly_score"] or 0.5) - 0.5) * 200.0)) for item in components]
        agreement_bonus = 15.0 if all(float(item["projected_change_30m_percent"]) <= -8.0 for item in components) else 0.0
        risk = 0.65 * max(pressures) + 0.20 * sum(pressures) / len(pressures) + 0.15 * sum(model_pressure) / len(model_pressure) + agreement_bonus
        risk_index = round(min(100.0, max(0.0, risk)))
        if risk_index >= 60:
            risk_level, risk_label = "elevated", "ریسک افزوده؛ نیازمند بررسی فوری"
        elif risk_index >= 30:
            risk_level, risk_label = "watch", "نشانه‌هایی برای پایش نزدیک‌تر"
        else:
            risk_level, risk_label = "low", "نشانهٔ پرقدرتی از افت قریب‌الوقوع دیده نمی‌شود"
    note = (
        "این شاخص، احتمال آماری کالیبره‌شده نیست. برآورد ۳۰ دقیقهٔ آینده از روند کوتاه‌مدت دو شاخص اصلی و امتیاز ناهنجاری مدل بدون‌نظارت ساخته می‌شود؛ با تغییر پوشش یا منبع داده ممکن است خطا کند. علت اختلال را تعیین نمی‌کند."
        if available else
        "برای پیش‌بینی هم‌زمان به دست‌کم ۱۲ مشاهدهٔ معتبر از هر دو شاخص اصلی نیاز است. دادهٔ ناکافی به معنی ریسک صفر نیست."
    )
    return {
        "model_name": MODEL_NAME,
        "model_family": "unsupervised_anomaly_detection",
        "model_status": "ready" if trained else "collecting_history",
        "model_status_label": f"مدل فعال برای {len(trained)} شاخص" if trained else "در حال جمع‌آوری تاریخچه برای آموزش اولیه",
        "trained_signals": len(trained),
        "minimum_raw_points": MIN_RAW_POINTS,
        "signals": models,
        "forecast": {
            "available": available,
            "horizon_minutes": 30,
            "risk_index": risk_index,
            "risk_level": risk_level,
            "risk_label": risk_label,
            "components": components,
            "calibrated_probability": None,
            "note": note,
        },
        "method_note": "ترکیب Isolation Forest بدون‌نظارت و فاصلهٔ مقاوم روی سه ویژگیِ سطح سیگنال، تغییر کوتاه‌مدت و فاصله از خط مبنا. آموزش فقط با تاریخچهٔ همان شاخص انجام می‌شود؛ دادهٔ ساختگی یا برچسب رخداد مصنوعی تولید نمی‌شود.",
    }
