from datetime import datetime, timedelta, timezone

from netguard.ml import analyze_intelligence


def make_data(values, source_id, signal):
    start = datetime(2026, 11, 15, tzinfo=timezone.utc)
    source = {"source_id": source_id, "signal": signal, "display_name": source_id}
    rows = [{
        "source_id": source_id,
        "observed_at": (start + timedelta(minutes=5 * index)).isoformat(),
        "value": value,
        "quality": "valid",
    } for index, value in enumerate(values)]
    return source, rows


def test_isolation_forest_scores_sudden_drop_as_more_unusual():
    stable = [1000 + (index % 2) for index in range(60)]
    source, stable_rows = make_data(stable, "ioda:IR:bgp", "bgp")
    stable_score = analyze_intelligence([source], stable_rows)["signals"][0]["score"]
    _, disrupted_rows = make_data(stable[:-1] + [300], "ioda:IR:bgp", "bgp")
    result = analyze_intelligence([source], disrupted_rows)["signals"][0]
    assert result["status"] == "ready"
    assert result["score"] > stable_score
    assert result["score"] >= 0.65
    assert result["is_anomaly"] is True


def test_model_waits_for_real_history_instead_of_making_up_training_data():
    source, rows = make_data([1000] * 20, "ioda:IR:bgp", "bgp")
    result = analyze_intelligence([source], rows)
    assert result["model_status"] == "collecting_history"
    assert result["signals"][0]["score"] is None


def test_forecast_requires_both_primary_signals():
    source, rows = make_data([1000] * 48, "ioda:IR:bgp", "bgp")
    forecast = analyze_intelligence([source], rows)["forecast"]
    assert forecast["available"] is False
    assert forecast["risk_index"] is None


def test_forecast_is_explicitly_not_a_calibrated_probability():
    sources, rows = [], []
    for source_id, signal, base in (
        ("ioda:IR:bgp", "bgp", 1000),
        ("ioda:IR:ping-slash24", "ping-slash24", 800),
    ):
        source, source_rows = make_data([base] * 42 + [base * 0.95] * 6, source_id, signal)
        sources.append(source)
        rows.extend(source_rows)
    forecast = analyze_intelligence(sources, rows)["forecast"]
    assert forecast["available"] is True
    assert forecast["horizon_minutes"] == 30
    assert forecast["calibrated_probability"] is None
    assert forecast["risk_index"] is not None
