from __future__ import annotations

from math import ceil, isfinite
from statistics import median
from typing import Any


SEQUENCE_LENGTH = 12
MIN_SEQUENCES = 64
HIDDEN_LAYERS = (24, 12)
MAX_EPOCHS = 120
BATCH_SIZE = 32


def forecast_series(
    values: list[float],
    timestamps: list[float],
    interval_seconds: int,
    *,
    horizons: tuple[int, ...] = (15, 30, 60),
) -> dict[str, Any]:
    """Train a compact two-hidden-layer MLP on real, contiguous observations.

    The final 20% of chronological windows are held out for validation. A
    forecast is published only when the neural model is competitive with a
    persistence baseline. This is a point forecast, not a calibrated outage
    probability.
    """
    try:
        import numpy as np
    except ImportError:
        return {"available": False, "reason": "کتابخانهٔ عددی مدل نصب نشده است"}

    if len(values) != len(timestamps):
        return {"available": False, "reason": "طول تاریخچه و زمان نمونه‌ها یکسان نیست"}

    interval = max(1, int(interval_seconds))
    pairs = []
    for raw_value, raw_time in zip(values, timestamps):
        try:
            value = float(raw_value)
            stamp = float(raw_time)
        except (TypeError, ValueError):
            continue
        if isfinite(value) and isfinite(stamp) and value >= 0:
            pairs.append((stamp, value))
    pairs.sort(key=lambda item: item[0])

    if len(pairs) <= SEQUENCE_LENGTH:
        return {
            "available": False,
            "reason": f"برای آموزش شبکهٔ عصبی حداقل {SEQUENCE_LENGTH + MIN_SEQUENCES + 1} مشاهدهٔ پیوسته لازم است",
            "sample_count": len(pairs),
        }

    latest_gaps = [
        pairs[index][0] - pairs[index - 1][0]
        for index in range(max(1, len(pairs) - SEQUENCE_LENGTH), len(pairs))
    ]
    if len(latest_gaps) != SEQUENCE_LENGTH or any(
        gap < interval * 0.25 or gap > interval * 1.75 for gap in latest_gaps
    ):
        return {
            "available": False,
            "reason": "آخرین ۱۲ مشاهده پیوسته نیستند؛ پیش‌بینی عصبی متوقف شد",
            "sample_count": len(pairs),
        }

    # A sequence is retained only when its samples follow the source cadence.
    windows: list[tuple[list[float], float]] = []
    for end in range(SEQUENCE_LENGTH, len(pairs)):
        segment = pairs[end - SEQUENCE_LENGTH : end + 1]
        gaps = [
            segment[index][0] - segment[index - 1][0]
            for index in range(1, len(segment))
        ]
        if any(gap < interval * 0.25 or gap > interval * 1.75 for gap in gaps):
            continue
        windows.append((
            [item[1] for item in segment[:-1]],
            segment[-1][1],
        ))

    if len(windows) < MIN_SEQUENCES:
        return {
            "available": False,
            "reason": (
                f"فقط {len(windows)} توالی پیوسته ساخته شد؛ "
                f"حداقل {MIN_SEQUENCES} توالی برای آموزش و ارزیابی لازم است"
            ),
            "sample_count": len(pairs),
            "training_sequences": len(windows),
        }

    split = int(len(windows) * 0.8)
    split = min(max(split, 1), len(windows) - 12)
    x_raw = np.asarray([item[0] for item in windows], dtype=np.float64)
    y_raw = np.asarray([item[1] for item in windows], dtype=np.float64).reshape(-1, 1)
    x_train_raw, y_train_raw = x_raw[:split], y_raw[:split]
    x_valid_raw, y_valid_raw = x_raw[split:], y_raw[split:]

    train_distribution = np.concatenate((x_train_raw.reshape(-1), y_train_raw.reshape(-1)))
    center = float(np.median(train_distribution))
    mad = float(np.median(np.abs(train_distribution - center)))
    scale = max(1.4826 * mad, abs(center) * 0.01, 1.0)

    x_train = np.clip((x_train_raw - center) / scale, -8.0, 8.0)
    y_train = np.clip((y_train_raw - center) / scale, -8.0, 8.0)
    x_valid = np.clip((x_valid_raw - center) / scale, -8.0, 8.0)
    y_valid = np.clip((y_valid_raw - center) / scale, -8.0, 8.0)

    rng = np.random.default_rng(20261115)
    input_size = SEQUENCE_LENGTH
    hidden_one, hidden_two = HIDDEN_LAYERS
    parameters = {
        "w1": rng.normal(0.0, (2.0 / input_size) ** 0.5, (input_size, hidden_one)),
        "b1": np.zeros((1, hidden_one)),
        "w2": rng.normal(0.0, (2.0 / hidden_one) ** 0.5, (hidden_one, hidden_two)),
        "b2": np.zeros((1, hidden_two)),
        "w3": rng.normal(0.0, (1.0 / hidden_two) ** 0.5, (hidden_two, 1)),
        "b3": np.zeros((1, 1)),
    }
    first_moment = {key: np.zeros_like(value) for key, value in parameters.items()}
    second_moment = {key: np.zeros_like(value) for key, value in parameters.items()}
    beta_one, beta_two, epsilon = 0.9, 0.999, 1e-8
    best_parameters = {key: value.copy() for key, value in parameters.items()}
    best_loss = float("inf")
    best_epoch = 0
    stale_epochs = 0
    step = 0

    def forward(batch):
        z1 = batch @ parameters["w1"] + parameters["b1"]
        a1 = np.maximum(z1, 0.0)
        z2 = a1 @ parameters["w2"] + parameters["b2"]
        a2 = np.maximum(z2, 0.0)
        output = a2 @ parameters["w3"] + parameters["b3"]
        return output, (batch, z1, a1, z2, a2)

    for epoch in range(MAX_EPOCHS):
        order = rng.permutation(len(x_train))
        for offset in range(0, len(order), BATCH_SIZE):
            indices = order[offset : offset + BATCH_SIZE]
            batch_x, batch_y = x_train[indices], y_train[indices]
            prediction, cache = forward(batch_x)
            batch_x, z1, a1, z2, a2 = cache
            count = max(1, len(batch_x))
            grad_output = (2.0 / count) * (prediction - batch_y)

            gradients = {}
            gradients["w3"] = a2.T @ grad_output + 1e-5 * parameters["w3"]
            gradients["b3"] = grad_output.sum(axis=0, keepdims=True)
            grad_a2 = grad_output @ parameters["w3"].T
            grad_z2 = grad_a2 * (z2 > 0.0)
            gradients["w2"] = a1.T @ grad_z2 + 1e-5 * parameters["w2"]
            gradients["b2"] = grad_z2.sum(axis=0, keepdims=True)
            grad_a1 = grad_z2 @ parameters["w2"].T
            grad_z1 = grad_a1 * (z1 > 0.0)
            gradients["w1"] = batch_x.T @ grad_z1 + 1e-5 * parameters["w1"]
            gradients["b1"] = grad_z1.sum(axis=0, keepdims=True)

            step += 1
            for key, gradient in gradients.items():
                first_moment[key] = beta_one * first_moment[key] + (1.0 - beta_one) * gradient
                second_moment[key] = beta_two * second_moment[key] + (1.0 - beta_two) * (gradient * gradient)
                corrected_first = first_moment[key] / (1.0 - beta_one ** step)
                corrected_second = second_moment[key] / (1.0 - beta_two ** step)
                parameters[key] -= 0.008 * corrected_first / (np.sqrt(corrected_second) + epsilon)

        validation_prediction, _ = forward(x_valid)
        validation_loss = float(np.mean((validation_prediction - y_valid) ** 2))
        if validation_loss < best_loss - 1e-7:
            best_loss = validation_loss
            best_parameters = {key: value.copy() for key, value in parameters.items()}
            best_epoch = epoch + 1
            stale_epochs = 0
        else:
            stale_epochs += 1
            if stale_epochs >= 14:
                break

    parameters.update(best_parameters)

    def predict_normalized(sequence):
        prediction, _ = forward(np.asarray(sequence, dtype=np.float64).reshape(1, -1))
        return float(prediction[0, 0])

    validation_predictions = np.asarray([
        predict_normalized(row) for row in x_valid
    ], dtype=np.float64)
    neural_mae = float(np.mean(np.abs(validation_predictions - y_valid.reshape(-1))))
    baseline_mae = float(np.mean(np.abs(x_valid[:, -1] - y_valid.reshape(-1))))
    # Permit a small tolerance for near-constant signals, but reject a model
    # that is materially worse than simply carrying the last observation.
    if neural_mae > baseline_mae * 1.20 + 0.02:
        return {
            "available": False,
            "reason": "شبکهٔ عصبی در آزمون خارج از نمونه از خط مبنای ساده بهتر یا هم‌سطح نبود؛ پیش‌بینی منتشر نمی‌شود",
            "sample_count": len(pairs),
            "training_sequences": split,
            "validation_sequences": len(x_valid),
            "validation_mae_percent": round(neural_mae * scale / max(abs(center), 1.0) * 100.0, 3),
            "baseline_mae_percent": round(baseline_mae * scale / max(abs(center), 1.0) * 100.0, 3),
        }

    residuals = np.abs(validation_predictions - y_valid.reshape(-1)) * scale
    uncertainty = float(np.quantile(residuals, 0.90)) if len(residuals) else 0.0
    sequence = np.clip((np.asarray(pairs[-SEQUENCE_LENGTH:])[:, 1] - center) / scale, -8.0, 8.0).tolist()
    interval_minutes = interval / 60.0
    max_steps = max(1, ceil(max(horizons) / interval_minutes))
    recursive_predictions = []
    for _ in range(max_steps):
        next_value = predict_normalized(sequence[-SEQUENCE_LENGTH:])
        next_value = max(-8.0, min(8.0, next_value))
        sequence.append(next_value)
        recursive_predictions.append(max(0.0, center + next_value * scale))

    projections = []
    for minutes in horizons:
        position = max(0.0, minutes / interval_minutes)
        lower_step = int(position)
        fraction = position - lower_step
        lower_value = pairs[-1][1] if lower_step == 0 else recursive_predictions[min(lower_step - 1, len(recursive_predictions) - 1)]
        upper_value = recursive_predictions[min(lower_step, len(recursive_predictions) - 1)]
        projected = lower_value + (upper_value - lower_value) * fraction
        projections.append({
            "minutes": int(minutes),
            "projected_value": round(max(0.0, projected), 2),
            "lower_90": round(max(0.0, projected - uncertainty), 2),
            "upper_90": round(max(0.0, projected + uncertainty), 2),
            "uncertainty_90": round(uncertainty, 2),
            "method": "neural_mlp_recursive",
        })

    skill = 1.0 - neural_mae / max(baseline_mae, 1e-8)
    return {
        "available": True,
        "model_name": "Two-hidden-layer temporal MLP",
        "model_family": "deep_learning_time_series_regression",
        "architecture": f"{SEQUENCE_LENGTH}-{hidden_one}-{hidden_two}-1",
        "sequence_length": SEQUENCE_LENGTH,
        "training_sequences": split,
        "validation_sequences": len(x_valid),
        "epochs_trained": best_epoch,
        "validation_mae_percent": round(neural_mae * scale / max(abs(center), 1.0) * 100.0, 3),
        "baseline_mae_percent": round(baseline_mae * scale / max(abs(center), 1.0) * 100.0, 3),
        "model_skill_percent": round(skill * 100.0, 2),
        "uncertainty_method": "90th percentile of chronological validation residuals",
        "projections": projections,
    }
