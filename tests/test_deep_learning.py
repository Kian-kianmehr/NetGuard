import math

import pytest

from netguard.deep_learning import MIN_SEQUENCES, SEQUENCE_LENGTH, forecast_series


def make_series(count=120, interval=300):
    values = [1000.0 + index * 0.15 + 2.0 * math.sin(index / 5.0) for index in range(count)]
    timestamps = [float(index * interval) for index in range(count)]
    return values, timestamps


def test_mlp_rejects_history_below_minimum_sequence_count():
    values, timestamps = make_series(SEQUENCE_LENGTH + MIN_SEQUENCES - 1)
    result = forecast_series(values, timestamps, 300)
    assert result["available"] is False
    assert result["training_sequences"] == MIN_SEQUENCES - 1


def test_mlp_rejects_a_gap_in_the_latest_input_sequence():
    values, timestamps = make_series()
    timestamps[-1] += 1800
    result = forecast_series(values, timestamps, 300)
    assert result["available"] is False
    assert "پیوسته نیستند" in result["reason"]


def test_mlp_rejects_mismatched_values_and_timestamps():
    values, timestamps = make_series()
    result = forecast_series(values, timestamps[:-1], 300)
    assert result["available"] is False
    assert "یکسان نیست" in result["reason"]


def test_mlp_rejects_invalid_forecast_horizons():
    values, timestamps = make_series()
    result = forecast_series(values, timestamps, 300, horizons=(15, 0, 60))
    assert result["available"] is False
    assert "اعداد صحیح مثبت" in result["reason"]


def test_mlp_training_is_reproducible_and_never_claims_probability():
    pytest.importorskip("numpy")
    values, timestamps = make_series()
    first = forecast_series(values, timestamps, 300)
    second = forecast_series(values, timestamps, 300)
    assert first == second
    if first["available"]:
        assert first["architecture"] == "12-24-12-1"
        assert [item["minutes"] for item in first["projections"]] == [15, 30, 60]
        assert all(item["lower_90"] <= item["projected_value"] <= item["upper_90"] for item in first["projections"])
        assert "uncertainty_method" in first