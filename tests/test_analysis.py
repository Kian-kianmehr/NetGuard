from datetime import datetime, timezone

from netguard.analysis import analyze_dashboard


NOW = datetime(2026, 11, 15, 12, 0, tzinfo=timezone.utc)


def source(source_id="ioda:IR:bgp", freshness="fresh", run_status="success"):
    return {
        "source_id": source_id,
        "display_name": source_id,
        "provider": "IODA",
        "signal": source_id.rsplit(":", 1)[-1],
        "unit": "count",
        "freshness_status": freshness,
        "last_run_status": run_status,
        "last_observed_at": "2026-11-15T11:55:00Z",
        "last_collected_at": "2026-11-15T12:00:00Z",
    }


def observations(source_id, values, step=300):
    start = int(datetime(2026, 11, 15, 9, 0, tzinfo=timezone.utc).timestamp())
    return [
        {
            "source_id": source_id,
            "observed_at": datetime.fromtimestamp(
                start + index * step, timezone.utc
            ).isoformat().replace("+00:00", "Z"),
            "value": value,
            "quality": "valid",
        }
        for index, value in enumerate(values)
    ]


def test_observations_far_behind_source_cadence_are_limited_and_operational():
    item = source()
    item["expected_interval_seconds"] = 300
    rows = observations(item["source_id"], [1000 + (index % 2) for index in range(33)])
    item["last_observed_at"] = rows[-1]["observed_at"]
    result, events = analyze_dashboard([item], rows, generated_at=NOW)
    signal = result["signals"][0]
    delayed = [event for event in events if event["event_type"] == "source_delayed"]
    assert signal["freshness_status"] == "fresh"
    assert signal["display_freshness_status"] == "delayed"
    assert signal["data_state"] == "limited"
    assert result["assessment"] == "insufficient_data"
    assert delayed
    assert delayed[0]["evidence_score"] is None
    assert delayed[0]["lifecycle"] == "operational"
    assert "اجرای موفق جمع‌آوری" in delayed[0]["description"]


def test_stable_series_is_not_reported_as_an_anomaly():
    first = "ioda:IR:bgp"
    second = "ioda:IR:ping-slash24"
    values = [1000 + (index % 3) for index in range(36)]
    rows = observations(first, values) + observations(second, [800 + (index % 2) for index in range(36)])
    result, events = analyze_dashboard([source(first), source(second)], rows, generated_at=NOW)
    assert result["assessment"] == "no_anomaly_detected"
    assert result["usable_sources"] == 2
    assert all(signal["data_state"] == "usable" for signal in result["signals"])
    assert events == []


def test_large_sudden_drop_creates_explained_event():
    values = [1000 + (index % 3) for index in range(27)] + [500, 480, 470, 450, 430, 410]
    rows = observations("ioda:IR:bgp", values)
    result, events = analyze_dashboard([source()], rows, generated_at=NOW)
    assert result["assessment"] == "watch"
    assert result["signals"][0]["current_anomaly"] is True
    anomaly_events = [
        event for event in events
        if event["event_type"] == "signal_anomaly" and event["direction"] == "drop"
    ]
    assert anomaly_events
    assert any(event["evidence_score"] > 0 for event in anomaly_events)
    assert any(event["lifecycle"] == "active" for event in anomaly_events)


def test_stale_source_creates_operational_event_and_is_not_healthy():
    rows = observations("ioda:IR:bgp", [1000] * 20)
    result, events = analyze_dashboard(
        [source(freshness="stale")], rows, generated_at=NOW
    )
    assert result["assessment"] == "insufficient_data"
    stale_events = [event for event in events if event["event_type"] == "source_stale"]
    assert stale_events
    assert stale_events[0]["evidence_score"] is None
    assert stale_events[0]["status_label"] == "هشدار عملیاتی؛ نه رخداد شبکه"


def test_collector_error_is_operational_and_has_no_network_evidence_score():
    rows = observations("ioda:IR:bgp", [1000] * 20)
    _, events = analyze_dashboard(
        [source(run_status="error")], rows, generated_at=NOW
    )
    collector_events = [event for event in events if event["event_type"] == "collector_error"]
    assert collector_events
    assert collector_events[0]["evidence_score"] is None
    assert collector_events[0]["status_label"] == "هشدار عملیاتی؛ نه رخداد شبکه"
    assert collector_events[0]["lifecycle"] == "operational"


def test_merit_positive_spike_is_explained_as_auxiliary_not_network_drop():
    source_id = "ioda:IR:merit-nt"
    rows = observations(source_id, [50] * 27 + [70] * 6)
    _, events = analyze_dashboard([source(source_id)], rows, generated_at=NOW)
    merit_events = [
        event for event in events
        if event["event_type"] == "signal_anomaly" and event["direction"] == "spike"
    ]
    assert merit_events
    assert "به‌تنهایی نشانهٔ افت اینترنت نیست" in merit_events[0]["description"]
    assert "شاخص کمکی" in merit_events[0]["status_label"]


def test_missing_and_invalid_observations_are_not_zero_filled():
    rows = observations("ioda:IR:bgp", [1000] * 10)
    rows.extend([
        {"source_id": "ioda:IR:bgp", "observed_at": "invalid", "value": 0},
        {"source_id": "ioda:IR:bgp", "observed_at": "2026-11-15T11:00:00Z", "value": None},
    ])
    result, _ = analyze_dashboard([source()], rows, generated_at=NOW)
    assert result["signals"][0]["sample_count"] == 10
    assert result["assessment"] == "insufficient_data"


def test_two_independent_simultaneous_drops_are_only_suspected():
    first = "ioda:IR:bgp"
    second = "ioda:IR:ping-slash24"
    rows = observations(first, [1000] * 27 + [500, 480, 470, 450, 430, 410])
    rows += observations(second, [800] * 27 + [400, 390, 380, 360, 340, 320])
    result, events = analyze_dashboard(
        [source(first), source(second)], rows, generated_at=NOW
    )
    assert result["assessment"] == "elevated_attention"
    flagged = [event for event in events if event["event_type"] == "signal_anomaly"]
    assert len(flagged) >= 2
    assert all(event["status"] == "suspected" for event in flagged)
    assert all(event["status"] != "confirmed" for event in flagged)

def test_old_corroborated_events_do_not_keep_current_status_elevated():
    first = "ioda:IR:bgp"
    second = "ioda:IR:ping-slash24"
    first_values = [1000] * 12 + [500, 480, 470, 450, 430, 410] + [1000] * 18
    second_values = [800] * 12 + [400, 390, 380, 360, 340, 320] + [800] * 18
    rows = observations(first, first_values) + observations(second, second_values)
    result, events = analyze_dashboard(
        [source(first), source(second)], rows, generated_at=NOW
    )
    assert any(event["event_type"] == "signal_anomaly" for event in events)
    assert result["assessment"] == "no_anomaly_detected"
    assert result["anomalous_sources"] == 0
    historical = [event for event in events if event["event_type"] == "signal_anomaly"]
    assert historical
    assert all(event["lifecycle"] == "resolved" for event in historical)



def test_public_summary_does_not_claim_full_internet_health():
    first = "ioda:IR:bgp"
    second = "ioda:IR:ping-slash24"
    rows = observations(first, [1000 + (index % 2) for index in range(36)])
    rows += observations(second, [800 + (index % 2) for index in range(36)])
    result, _ = analyze_dashboard(
        [source(first), source(second)], rows, generated_at=NOW
    )
    public = result["public_summary"]
    assert public["condition"] == "stable"
    assert public["outage_state"] == "no_widespread_signal"
    assert public["quality_state"] == "not_measured"
    assert public["confidence"] == "medium"
    assert "شهر" in public["scope_note"]


def test_public_summary_detects_worsening_trend_without_confirming_outage():
    first = "ioda:IR:bgp"
    second = "ioda:IR:ping-slash24"
    first_values = [1000] * 24 + [850] * 6 + [400] * 6
    second_values = [900] * 24 + [760] * 6 + [350] * 6
    rows = observations(first, first_values) + observations(second, second_values)
    result, _ = analyze_dashboard(
        [source(first), source(second)], rows, generated_at=NOW
    )
    public = result["public_summary"]
    assert public["trend_state"] == "worsening"
    assert public["condition"] == "possible_disruption"
    assert public["outage_state"] == "multiple_indicators"
    assert "تأیید" in public["summary"]


def test_public_summary_does_not_call_a_single_signal_a_national_outage():
    first = "ioda:IR:bgp"
    values = [1000] * 27 + [500, 480, 470, 450, 430, 410]
    result, _ = analyze_dashboard(
        [source(first)], observations(first, values), generated_at=NOW
    )
    public = result["public_summary"]
    assert public["condition"] == "attention"
    assert public["outage_state"] == "single_signal_drop"
    assert public["confidence"] == "low"


def test_one_hour_trend_labels_improvement_when_both_primary_signals_rise():
    first = "ioda:IR:bgp"
    second = "ioda:IR:ping-slash24"
    rows = observations(first, [1000] * 12 + [1100] * 12)
    rows += observations(second, [800] * 12 + [900] * 12)
    result, _ = analyze_dashboard(
        [source(first), source(second)], rows, generated_at=NOW
    )
    assert result["public_summary"]["trend_state"] == "improving"


def test_quality_report_separates_window_coverage_and_observed_span():
    bgp = "ioda:IR:bgp"
    ping = "ioda:IR:ping-slash24"
    rows = observations(bgp, [1000 + (index % 2) for index in range(36)])
    rows += observations(ping, [800 + (index % 2) for index in range(36)])
    result, _ = analyze_dashboard(
        [source(bgp), source(ping)], rows, generated_at=NOW, window_hours=168
    )
    quality = result["data_quality"]
    assert quality["window_hours"] == 168
    assert quality["valid_observations"] == 72
    assert quality["window_coverage_percent"] < 10
    details = {item["signal"]: item for item in quality["source_details"]}
    assert details["bgp"]["expected_interval_seconds"] == 300
    assert details["ping-slash24"]["expected_interval_seconds"] == 600
    assert details["bgp"]["observed_span_hours"] > 2
    assert details["ping-slash24"]["median_gap_seconds"] == 300


def test_quality_report_does_not_treat_missing_samples_as_zero():
    bgp = "ioda:IR:bgp"
    sparse = observations(bgp, [1000, 1000, 1000, 1000], step=1800)
    result, _ = analyze_dashboard([source(bgp)], sparse, generated_at=NOW, window_hours=24)
    quality = result["data_quality"]["source_details"][0]
    assert quality["valid_samples"] == 4
    assert quality["invalid_samples"] == 0
    assert quality["gaps_over_expected_threshold"] >= 1
    assert result["signals"][0]["current_anomaly"] is False
