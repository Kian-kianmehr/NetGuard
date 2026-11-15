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


def test_stable_series_is_not_reported_as_an_anomaly():
    rows = observations("ioda:IR:bgp", [1000 + (index % 3) for index in range(36)])
    result, events = analyze_dashboard([source()], rows, generated_at=NOW)
    assert result["assessment"] == "no_anomaly_detected"
    assert result["signals"][0]["data_state"] == "usable"
    assert events == []


def test_large_sudden_drop_creates_explained_event():
    values = [1000 + (index % 3) for index in range(30)] + [500, 480, 470]
    rows = observations("ioda:IR:bgp", values)
    result, events = analyze_dashboard([source()], rows, generated_at=NOW)
    assert result["assessment"] == "watch"
    assert result["signals"][0]["current_anomaly"] is True
    assert any(
        event["event_type"] == "signal_anomaly"
        and event["direction"] == "drop"
        and event["evidence_score"] > 0
        for event in events
    )


def test_stale_source_creates_operational_event_and_is_not_healthy():
    rows = observations("ioda:IR:bgp", [1000] * 20)
    result, events = analyze_dashboard(
        [source(freshness="stale")], rows, generated_at=NOW
    )
    assert result["assessment"] == "insufficient_data"
    assert any(event["event_type"] == "source_stale" for event in events)


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
    rows = observations(first, [1000] * 30 + [500, 480, 470])
    rows += observations(second, [800] * 30 + [400, 390, 380])
    result, events = analyze_dashboard(
        [source(first), source(second)], rows, generated_at=NOW
    )
    assert result["assessment"] == "elevated_attention"
    flagged = [event for event in events if event["event_type"] == "signal_anomaly"]
    assert len(flagged) >= 2
    assert all(event["status"] == "suspected" for event in flagged)
    assert all(event["status"] != "confirmed" for event in flagged)
