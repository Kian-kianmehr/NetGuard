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


def test_model_accepts_data_within_source_specific_freshness_window():
    source, rows = make_data([1000 + (index % 2) for index in range(60)], "ioda:IR:bgp", "bgp")
    source["stale_after_seconds"] = 1800
    latest = datetime.fromisoformat(max(row["observed_at"] for row in rows))
    result = analyze_intelligence([source], rows, now=latest + timedelta(minutes=20))
    signal = result["signals"][0]
    assert signal["status"] == "ready"
    assert signal["score"] is not None
    assert signal["observation_age_seconds"] == 20 * 60


def test_model_does_not_score_a_reading_beyond_source_freshness_window():
    source, rows = make_data([1000 + (index % 2) for index in range(60)], "ioda:IR:bgp", "bgp")
    source["stale_after_seconds"] = 1800
    latest = datetime.fromisoformat(max(row["observed_at"] for row in rows))
    result = analyze_intelligence([source], rows, now=latest + timedelta(minutes=35))
    signal = result["signals"][0]
    assert signal["status"] == "stale_data"
    assert signal["score"] is None
    assert signal["observation_age_seconds"] == 35 * 60
    assert "مهلت 30 دقیقه‌ای" in signal["interpretation"]


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
        source, source_rows = make_data([base] * 150 + [base * 0.95] * 6, source_id, signal)
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
    assert all(item["method"] == "neural_mlp_recursive" for item in projections)


def test_forecast_uses_fresh_ping_when_bgp_observation_is_too_old():
    sources, rows = [], []
    for source_id, signal, base in (
        ("ioda:IR:bgp", "bgp", 1000),
        ("ioda:IR:ping-slash24", "ping-slash24", 900),
    ):
        source, source_rows = make_data([base] * 120, source_id, signal)
        sources.append(source)
        rows.extend(source_rows)
    sources[0]["stale_after_seconds"] = 1800
    sources[1]["stale_after_seconds"] = 2400
    latest = datetime.fromisoformat(max(row["observed_at"] for row in rows))
    result = analyze_intelligence(sources, rows, now=latest + timedelta(minutes=35))
    forecast = result["forecast"]
    by_signal = {item["signal"]: item for item in forecast["components"]}
    assert forecast["available"] is False
    assert forecast["risk_index"] is None
    assert by_signal["bgp"]["available"] is False
    assert "مهلت 30 دقیقه‌ای" in by_signal["bgp"]["reason"]
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
    assert forecast["components"][0]["reason"] == "Collector این منبع را در وضعیت تازه/سالم گزارش نکرده است"



def test_joint_model_fuses_aligned_primary_and_merit_signals():
    sources, rows = [], []
    for source_id, signal, base in (
        ("ioda:IR:bgp", "bgp", 1000),
        ("ioda:IR:ping-slash24", "ping-slash24", 900),
        ("ioda:IR:merit", "merit-nt", 700),
    ):
        values = [base + ((index % 9) - 4) * 0.8 for index in range(160)]
        source, source_rows = make_data(values, source_id, signal)
        sources.append(source)
        rows.extend(source_rows)

    joint = analyze_intelligence(sources, rows)["joint_model"]
    assert joint["available"] is True, joint
    assert joint["sample_count"] >= 45
    assert joint["active_signals"] == ["bgp", "ping-slash24", "merit-nt"]
    assert 0.0 <= joint["score"] <= 1.0
    assert joint["dominant_feature_label"] in joint["active_signal_labels"]


def test_joint_model_refuses_stale_primary_signal():
    sources, rows = [], []
    for source_id, signal, base in (
        ("ioda:IR:bgp", "bgp", 1000),
        ("ioda:IR:ping-slash24", "ping-slash24", 900),
    ):
        source, source_rows = make_data([base] * 120, source_id, signal)
        sources.append(source)
        rows.extend(source_rows)
    sources[0]["stale_after_seconds"] = 1800
    sources[1]["stale_after_seconds"] = 2400
    latest = datetime.fromisoformat(max(row["observed_at"] for row in rows))
    joint = analyze_intelligence(sources, rows, now=latest + timedelta(minutes=35))["joint_model"]
    assert joint["available"] is False
    assert joint["status"] == "stale_data"
    assert joint["score"] is None

def test_stale_signal_is_excluded_from_trend_cause_analysis_and_brief():
    bgp, bgp_rows = make_data([1000] * 100, "ioda:IR:bgp", "bgp", step_minutes=5)
    ping, ping_rows = make_data([900] * 100, "ioda:IR:ping-slash24", "ping-slash24", step_minutes=10)
    bgp["expected_interval_seconds"] = 300
    ping["expected_interval_seconds"] = 600
    bgp["stale_after_seconds"] = 900
    ping["stale_after_seconds"] = 2400
    latest = max(datetime.fromisoformat(row["observed_at"]) for row in bgp_rows + ping_rows)
    result = analyze_intelligence(
        [bgp, ping], bgp_rows + ping_rows, now=latest + timedelta(minutes=20)
    )
    trends = {item["signal"]: item for item in result["cause_analysis"]["observed_changes"]}
    assert trends["bgp"]["status"] == "stale_data"
    assert trends["ping-slash24"]["status"] == "ready"
    assert result["cause_analysis"]["hypothesis_id"] == "insufficient_evidence"
    brief = result["analysis_brief"]
    assert brief["status"] == "limited"
    assert brief["fresh_primary_signals"] == 1
    assert any("BGP" in item for item in brief["limitations"])
    assert any("پایش فعال" in item for item in brief["evidence"])


def test_analysis_brief_explains_two_fresh_primary_signals_without_overclaiming():
    sources, rows = [], []
    for source_id, signal, base, interval, count in (
        ("ioda:IR:bgp", "bgp", 1000, 300, 320),
        ("ioda:IR:ping-slash24", "ping-slash24", 900, 600, 160),
    ):
        source, source_rows = make_data([base + (index % 2) for index in range(count)], source_id, signal,
                                        step_minutes=interval // 60)
        source["expected_interval_seconds"] = interval
        sources.append(source)
        rows.extend(source_rows)
    brief = analyze_intelligence(sources, rows)["analysis_brief"]
    assert brief["status"] == "normal"
    assert brief["fresh_primary_signals"] == 2
    assert "سلامت همهٔ اپراتورها" in brief["summary"]
    assert brief["method"] == "model_evidence_synthesis"


def test_recently_collected_packet_is_not_stale_when_upstream_observation_is_29_minutes_old():
    source, rows = make_data([1000 + (index % 2) for index in range(60)], "ioda:IR:bgp", "bgp")
    source["stale_after_seconds"] = 3600
    latest_observed = max(datetime.fromisoformat(row["observed_at"]) for row in rows)
    collected_at = latest_observed + timedelta(minutes=28)
    for row in rows:
        row["collected_at"] = collected_at.isoformat()
    result = analyze_intelligence([source], rows, now=latest_observed + timedelta(minutes=29))
    signal = result["signals"][0]
    assert signal["status"] == "ready"
    assert signal["observation_age_seconds"] == 29 * 60
    assert signal["collection_age_seconds"] == 60


def test_last_successful_collection_remains_usable_for_one_hour_then_expires():
    source, rows = make_data([1000 + (index % 2) for index in range(60)], "ioda:IR:bgp", "bgp")
    source["stale_after_seconds"] = 3600
    latest_observed = max(datetime.fromisoformat(row["observed_at"]) for row in rows)
    for row in rows:
        row["collected_at"] = latest_observed.isoformat()
    within_grace = analyze_intelligence(
        [source], rows, now=latest_observed + timedelta(minutes=59)
    )["signals"][0]
    after_grace = analyze_intelligence(
        [source], rows, now=latest_observed + timedelta(minutes=61)
    )["signals"][0]
    assert within_grace["status"] == "ready"
    assert within_grace["collection_age_seconds"] == 59 * 60
    assert after_grace["status"] == "stale_data"
    assert after_grace["collection_age_seconds"] == 61 * 60
