from datetime import datetime, timedelta, timezone

from netguard.ai_worker import build_dashboard_payloads


def test_ai_worker_publishes_all_windows_from_one_cycle_and_one_model_run(monkeypatch):
    generated_at = datetime(2026, 11, 16, 12, 0, tzinfo=timezone.utc)
    stage = {
        "cycle_id": "cycle-2026-11-16T12:00:00Z",
        "generated_at": generated_at.isoformat(),
        "sources": [{"source_id": "ioda:IR:bgp", "signal": "bgp"}],
        "observations": [
            {
                "source_id": "ioda:IR:bgp",
                "observed_at": (generated_at - timedelta(hours=hours)).isoformat(),
                "collected_at": generated_at.isoformat(),
                "value": 1000 - hours,
                "quality": "valid",
            }
            for hours in (1, 30, 100)
        ],
    }
    model_calls = []
    window_calls = []

    def fake_intelligence(sources, observations, now):
        model_calls.append((sources, observations, now))
        return {"analysis_brief": {"headline": "same-cycle result"}, "signals": []}

    def fake_dashboard(sources, observations, generated_at, window_hours):
        window_calls.append((window_hours, [row["value"] for row in observations]))
        return {"window_hours": window_hours}, []

    monkeypatch.setattr("netguard.ai_worker.analyze_intelligence", fake_intelligence)
    monkeypatch.setattr("netguard.ai_worker.analyze_dashboard", fake_dashboard)
    payloads = build_dashboard_payloads(stage, analysis_completed_at=generated_at + timedelta(minutes=2))

    assert len(model_calls) == 1
    assert model_calls[0][2] == generated_at
    assert [item[0] for item in window_calls] == [24, 72, 168]
    assert set(payloads) == {"dashboard_24", "dashboard_72", "dashboard_168"}
    assert {item["cycle_id"] for item in payloads.values()} == {stage["cycle_id"]}
    assert {item["analysis_cycle_id"] for item in payloads.values()} == {stage["cycle_id"]}
    assert all(item["analysis"]["intelligence"] is payloads["dashboard_168"]["analysis"]["intelligence"]
               for item in payloads.values())
    assert all(item["analysis_status"] == "complete" for item in payloads.values())



def test_celery_task_delegates_to_the_existing_ai_pipeline(monkeypatch):
    from netguard.tasks import analyze_dashboard_cycle_task

    expected = {"status": "published", "cycle_id": "cycle-test"}
    monkeypatch.setattr("netguard.tasks.run_once", lambda: expected)

    assert analyze_dashboard_cycle_task.run() == expected
