from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app


def test_health_is_available_without_database_secrets(monkeypatch):
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_PUBLISHABLE_KEY", raising=False)
    monkeypatch.delenv("SUPABASE_ANON_KEY", raising=False)
    with TestClient(app) as client:
        response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert response.json()["database_configured"] is False


def test_dashboard_requires_public_supabase_configuration(monkeypatch):
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_PUBLISHABLE_KEY", raising=False)
    monkeypatch.delenv("SUPABASE_ANON_KEY", raising=False)
    with TestClient(app) as client:
        response = client.get("/api/dashboard")
    assert response.status_code == 503


def test_dashboard_snapshot_builder_reads_the_expected_views(monkeypatch):
    from app.main import _build_dashboard_snapshot

    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test")
    calls = []

    def fake_read_view(client, project_url, key, view, params):
        calls.append((project_url, key, view, params))
        if view == "dashboard_sources":
            return [{"source_id": "ioda:IR:bgp"}]
        return []

    monkeypatch.setattr("app.main._read_view", fake_read_view)
    payload = _build_dashboard_snapshot(24)

    assert payload["sources"][0]["source_id"] == "ioda:IR:bgp"
    assert payload["observations"] == []
    assert {call[2] for call in calls} == {"dashboard_sources", "dashboard_observations"}
    assert all(call[1] == "sb_publishable_test" for call in calls)


def test_dashboard_api_reads_only_the_persisted_snapshot(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test")
    calls = []

    def fake_read_view(client, project_url, key, view, params):
        calls.append((view, params))
        return [{
            "payload": {"sources": [{"source_id": "ioda:IR:bgp"}], "observations": [],
                        "analysis": {}, "events": [], "window_hours": 24},
            "collected_at": "2026-11-15T10:00:00Z",
            "status": "success", "source_count": 3, "error_code": None,
        }]

    monkeypatch.setattr("app.main._read_view", fake_read_view)
    with TestClient(app) as client:
        response = client.get("/api/dashboard?hours=24")

    assert response.status_code == 200
    assert response.json()["sources"][0]["source_id"] == "ioda:IR:bgp"
    assert calls[0][0] == "netguard_snapshots"
    assert calls[0][1]["dataset_key"] == "eq.dashboard_24"




def test_dashboard_rejects_out_of_range_window():
    with TestClient(app) as client:
        response = client.get("/api/dashboard?hours=240")
    assert response.status_code == 422


def test_dashboard_rejects_windows_without_precomputed_snapshots():
    with TestClient(app) as client:
        response = client.get("/api/dashboard?hours=48")
    assert response.status_code == 422



def test_censorship_snapshot_builder_separates_ooni_evidence_from_test_candidates(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test")

    def fake_read_view(client, project_url, key, view, params):
        if view == "censored_domains":
            return [
                {"domain": "youtube.com", "category_code": "MMED", "confirmed_blocked": True,
                 "confirmed_measurements": 3, "anomaly_measurements": 1, "measurement_count": 4},
                {"domain": "example-news.net", "category_code": "NEWS", "confirmed_blocked": False,
                 "confirmed_measurements": 0, "anomaly_measurements": 1, "measurement_count": 1},
                {"domain": "excluded.example", "category_code": "PORN", "confirmed_blocked": True,
                 "confirmed_measurements": 1, "anomaly_measurements": 0, "measurement_count": 1},
            ]
        if view == "censorship_test_domains":
            return [
                {"domain": "candidate.example", "category_code": "NEWS",
                 "source_url": "https://github.com/citizenlab/test-lists/blob/master/lists/ir.csv"},
                {"domain": "excluded-test.example", "category_code": "GMB",
                 "source_url": "https://github.com/citizenlab/test-lists/blob/master/lists/ir.csv"},
            ]
        if view == "censorship_sync_runs":
            return [{
                "status": "partial", "finished_at": "2026-11-15T10:00:00Z",
                "records_received": 5, "test_list_records_received": 820,
            }]
        if view == "censorship_coverage":
            return [{"domain_count": 3, "measurement_count": 6, "probe_networks": 2,
                     "confirmed_measurements": 4, "anomaly_measurements": 2}]
        raise AssertionError(f"Unexpected view: {view}")

    monkeypatch.setattr("app.main._read_view", fake_read_view)
    from app.main import _build_censorship_snapshot
    payload = _build_censorship_snapshot()
    domains = {item["domain"]: item for item in payload["domains"]}
    assert set(domains) == {"youtube.com", "example-news.net", "candidate.example"}
    assert domains["youtube.com"]["confirmed_blocked"] is True
    assert domains["youtube.com"]["candidate_only"] is False
    assert domains["youtube.com"]["source_url"].startswith(
        "https://explorer.ooni.org/search?probe_cc=IR&domain="
    )
    assert domains["candidate.example"]["candidate_only"] is True
    assert domains["candidate.example"]["has_measurements"] is False
    assert domains["candidate.example"]["classification_label"] == (
        "در فهرست آزمون؛ هنوز نتیجهٔ تازه‌ای نداریم"
    )
    assert payload["total_domains_observed"] == 2
    assert payload["total_test_domains"] == 1
    assert payload["candidate_domains_not_recently_tested"] == 1
    assert payload["coverage"]["probe_networks"] == 2
    assert payload["sync"]["status"] == "partial"
    assert payload["sync"]["test_list_records_received"] == 820
    assert payload["lookback_days"] == 90


def test_provider_status_endpoint_reads_persisted_snapshot(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test")
    calls = []
    snapshot = {
        "providers": [{
            "id": "cloudflare", "name": "Cloudflare", "group": "infrastructure",
            "status": "operational", "status_label": "عادی", "available": True,
            "description": "شبکه", "url": "https://www.cloudflarestatus.com/",
            "data_center_count": 12,
            "affected_locations": [{"name": "Example City - (EXM)", "status_label": "اختلال بخشی"}],
            "incidents": [], "technical_components": [],
        }],
        "scope_note": "این داده دسترسی از داخل ایران را ثابت نمی‌کند.",
    }

    def fake_read_view(client, project_url, key, view, params):
        calls.append((view, params))
        assert view == "netguard_snapshots"
        return [{
            "payload": snapshot, "collected_at": "2026-11-15T10:00:00Z",
            "status": "partial", "source_count": 9, "error_code": None,
        }]

    monkeypatch.setattr("app.main._read_view", fake_read_view)
    with TestClient(app) as client:
        response = client.get("/api/providers/status")

    assert response.status_code == 200
    payload = response.json()
    assert len(payload["providers"]) == 1
    assert payload["providers"][0]["data_center_count"] == 12
    assert payload["checked_at"] == "2026-11-15T10:00:00Z"
    assert payload["snapshot_status"] == "partial"
    assert "دسترسی از داخل ایران" in payload["scope_note"]
    assert calls[0][1]["dataset_key"] == "eq.providers_status"


def test_read_view_all_paginates_and_preserves_stable_order(monkeypatch):
    from app.main import _read_view_all

    calls = []

    def fake_read_view(client, project_url, key, view, params):
        calls.append((params["limit"], params["offset"], params["order"]))
        offset = int(params["offset"])
        return [{"row": index} for index in range(offset, min(offset + int(params["limit"]), 5))]

    monkeypatch.setattr("app.main._read_view", fake_read_view)
    rows = _read_view_all(
        object(), "https://example.supabase.co", "test", "dashboard_observations",
        {"select": "*", "order": "observed_at.asc,source_id.asc"},
        page_size=2, max_rows=10,
    )
    assert [row["row"] for row in rows] == [0, 1, 2, 3, 4]
    assert calls == [
        ("2", "0", "observed_at.asc,source_id.asc"),
        ("2", "2", "observed_at.asc,source_id.asc"),
        ("2", "4", "observed_at.asc,source_id.asc"),
    ]


def test_iran_datacenters_api_reads_persisted_inventory(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test")
    calls = []

    def fake_read_view(client, project_url, key, view, params):
        calls.append((view, params))
        return [{
            "payload": {
                "sites": [{"site_id": "asia-milad", "name": "Asiatech Milad Tower",
                           "monitoring_status": "unmonitored"}],
                "total_sites": 1, "directly_monitored": 0,
            },
            "collected_at": "2026-11-15T10:00:00Z",
            "status": "success", "source_count": 1, "error_code": None,
        }]

    monkeypatch.setattr("app.main._read_view", fake_read_view)
    with TestClient(app) as client:
        response = client.get("/api/iran/datacenters")

    assert response.status_code == 200
    assert response.json()["total_sites"] == 1
    assert response.json()["directly_monitored"] == 0
    assert calls[0][1]["dataset_key"] == "eq.iran_datacenters"


def test_internal_snapshot_collector_rejects_requests_without_secret(monkeypatch):
    monkeypatch.delenv("NETGUARD_COLLECTOR_TOKEN", raising=False)
    with TestClient(app) as client:
        response = client.post("/internal/collect-snapshots")
    assert response.status_code == 401



def test_dashboard_stage_builder_reads_shared_history_without_running_models(monkeypatch):
    from datetime import datetime, timedelta, timezone
    from app.main import _build_dashboard_stage

    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test")
    now = datetime.now(timezone.utc)
    observations = [
        {"source_id": "ioda:IR:bgp", "observed_at": (now - timedelta(hours=12)).isoformat(), "value": 10},
        {"source_id": "ioda:IR:bgp", "observed_at": (now - timedelta(hours=48)).isoformat(), "value": 20},
    ]
    reads = []

    def fake_read_view(client, project_url, key, view, params):
        reads.append(("view", view, params))
        return [{"source_id": "ioda:IR:bgp", "signal": "bgp"}]

    def fake_read_view_all(client, project_url, key, view, params):
        reads.append(("all", view, params))
        return observations

    monkeypatch.setattr("app.main._read_view", fake_read_view)
    monkeypatch.setattr("app.main._read_view_all", fake_read_view_all)
    stage = _build_dashboard_stage(object())

    assert stage["cycle_id"]
    assert stage["generated_at"]
    assert stage["cycle_interval_seconds"] == 600
    assert stage["observations"] == observations
    assert stage["observation_count"] == 2
    assert {item[1] for item in reads} == {"dashboard_sources", "dashboard_observations"}


def test_snapshot_api_caches_repeated_reads_briefly(monkeypatch):
    import app.main as main

    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test")
    monkeypatch.setattr(main, "_SNAPSHOT_CACHE", {})
    calls = []

    def fake_read_view(client, project_url, key, view, params):
        calls.append((view, params))
        return [{
            "payload": {"sources": [], "observations": [], "analysis": {}, "events": []},
            "collected_at": "2026-11-15T10:00:00Z",
            "status": "success", "source_count": 3, "error_code": None,
        }]

    monkeypatch.setattr(main, "_read_view", fake_read_view)
    with TestClient(app) as client:
        first = client.get("/api/dashboard?hours=24")
        second = client.get("/api/dashboard?hours=24")

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["snapshot_at"] == second.json()["snapshot_at"]
    assert len(calls) == 1

def test_internal_ai_worker_rejects_requests_without_secret(monkeypatch):
    monkeypatch.delenv("NETGUARD_COLLECTOR_TOKEN", raising=False)
    with TestClient(app) as client:
        response = client.post("/internal/analyze-dashboard-cycle")
    assert response.status_code == 401


def test_internal_ai_worker_runs_outside_the_dashboard_request_path(monkeypatch):
    import json
    import app.main as main

    monkeypatch.setenv("NETGUARD_COLLECTOR_TOKEN", "x" * 48)
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test")
    calls = []

    def fake_run(command, **kwargs):
        calls.append((command, kwargs))
        return main.subprocess.CompletedProcess(
            command, 0, stdout=json.dumps({"status": "published", "cycle_id": "cycle-123"}),
            stderr="",
        )

    monkeypatch.setattr(main.subprocess, "run", fake_run)
    monkeypatch.setattr(main, "_SNAPSHOT_CACHE", {"https://example.supabase.co:dashboard_24": (0, {})})
    with TestClient(app) as client:
        response = client.post(
            "/internal/analyze-dashboard-cycle",
            headers={"x-netguard-token": "x" * 48},
        )

    assert response.status_code == 200
    assert response.json()["status"] == "published"
    assert calls[0][0][1:3] == ("-m", "netguard.ai_worker")
    assert calls[0][1]["timeout"] == 105
    assert main._SNAPSHOT_CACHE == {}

