from datetime import datetime, timedelta, timezone

from netguard.ml import analyze_intelligence


def make_data(values, source_id, signal, step_minutes=5):
    start = datetime(2026, 11, 15, tzinfo=timezone.utc)
    source = {"source_id": source_id, "signal": signal, "display_name": source_id}
    rows = [{
        "source_id": source_id,
        "observed_at": (start + timedelta(minutes=step_minutes * index)).isoformat(),
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


def test_model_does_not_score_a_reading_far_behind_expected_cadence():
    source, rows = make_data([1000 + (index % 2) for index in range(60)], "ioda:IR:bgp", "bgp")
    latest = datetime.fromisoformat(max(row["observed_at"] for row in rows))
    result = analyze_intelligence([source], rows, now=latest + timedelta(minutes=20))
    signal = result["signals"][0]
    assert signal["status"] == "stale_data"
    assert signal["score"] is None
    assert signal["observation_age_seconds"] == 20 * 60
    assert "امتیاز جاری نمایش داده نمی‌شود" in signal["interpretation"]


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
    projections = forecast["components"][0]["horizon_projections"]
    assert [item["minutes"] for item in projections] == [15, 30, 60]
    assert projections[1]["projected_change_percent"] == forecast["components"][0]["projected_change_30m_percent"]
    assert all(item["method"] == "linear_trend_extension" for item in projections)


def test_forecast_uses_fresh_ping_when_bgp_observation_is_too_old():
    sources, rows = [], []
    for source_id, signal, base in (
        ("ioda:IR:bgp", "bgp", 1000),
        ("ioda:IR:ping-slash24", "ping-slash24", 900),
    ):
        source, source_rows = make_data([base] * 48, source_id, signal)
        sources.append(source)
        rows.extend(source_rows)
    latest = datetime.fromisoformat(max(row["observed_at"] for row in rows))
    result = analyze_intelligence(sources, rows, now=latest + timedelta(minutes=20))
    forecast = result["forecast"]
    by_signal = {item["signal"]: item for item in forecast["components"]}
    assert forecast["available"] is False
    assert forecast["risk_index"] is None
    assert by_signal["bgp"]["available"] is False
    assert "سه فاصلهٔ معمول" in by_signal["bgp"]["reason"]
    assert by_signal["ping-slash24"]["available"] is True


def test_cause_analysis_requires_correlated_primary_signals():
    sources, rows = [], []
    for source_id, signal, base in (
        ("ioda:IR:bgp", "bgp", 1000),
        ("ioda:IR:ping", "ping-slash24", 900),
        ("ioda:IR:merit", "merit-nt", 700),
    ):
        source, source_rows = make_data([base] * 6 + [base * 0.8] * 6, source_id, signal)
        sources.append(source)
        rows.extend(source_rows)
    result = analyze_intelligence(sources, rows)
    cause = result["cause_analysis"]
    assert cause["hypothesis_id"] == "widespread_connectivity_degradation"
    assert cause["evidence_strength"] == "strong"
    assert set(cause["corroborating_signals"]) == {"BGP", "Ping", "Merit"}


def test_cause_analysis_does_not_claim_cause_from_single_signal():
    bgp, bgp_rows = make_data([1000] * 6 + [700] * 6, "ioda:IR:bgp", "bgp")
    ping, ping_rows = make_data([900] * 12, "ioda:IR:ping", "ping-slash24")
    cause = analyze_intelligence([bgp, ping], bgp_rows + ping_rows)["cause_analysis"]
    assert cause["hypothesis_id"] == "routing_visibility_change"
    assert cause["evidence_strength"] == "limited"


def test_recovery_duration_is_not_invented_without_labeled_events():
    source, rows = make_data([1000] * 48, "ioda:IR:bgp", "bgp")
    result = analyze_intelligence([source], rows)
    assert result["recovery_estimate"]["available"] is False
    assert result["recovery_estimate"]["estimated_duration_minutes"] is None


def test_forecast_rejects_sparse_time_windows_even_with_many_total_rows():
    sources, rows = [], []
    for source_id, signal, base in (
        ("ioda:IR:bgp", "bgp", 1000),
        ("ioda:IR:ping-slash24", "ping-slash24", 900),
    ):
        source, source_rows = make_data([base] * 60, source_id, signal, step_minutes=60)
        sources.append(source)
        rows.extend(source_rows)
    forecast = analyze_intelligence(sources, rows)["forecast"]
    assert forecast["available"] is False
    assert forecast["risk_index"] is None
    assert any(item["available"] is False for item in forecast["components"])


def test_stale_primary_signal_blocks_forecast_even_when_history_is_long():
    sources, rows = [], []
    for source_id, signal, base in (
        ("ioda:IR:bgp", "bgp", 1000),
        ("ioda:IR:ping-slash24", "ping-slash24", 900),
    ):
        source, source_rows = make_data([base] * 60, source_id, signal)
        sources.append(source)
        rows.extend(source_rows)
    sources[0]["freshness_status"] = "stale"
    forecast = analyze_intelligence(sources, rows)["forecast"]
    assert forecast["available"] is False
    assert forecast["components"][0]["reason"] == "دادهٔ تازه برای این شاخص موجود نیست"
