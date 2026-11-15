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


def test_dashboard_reads_the_expected_views(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test")
    calls = []

    def fake_read_view(client, project_url, key, view, params):
        calls.append((project_url, key, view, params))
        if view == "dashboard_sources":
            return [{"source_id": "ioda:IR:bgp"}]
        return []

    monkeypatch.setattr("app.main._read_view", fake_read_view)
    with TestClient(app) as client:
        response = client.get("/api/dashboard?hours=24")

    assert response.status_code == 200
    assert response.json()["sources"][0]["source_id"] == "ioda:IR:bgp"
    assert response.json()["observations"] == []
    assert {call[2] for call in calls} == {
        "dashboard_sources", "dashboard_observations"
    }
    assert all(call[1] == "sb_publishable_test" for call in calls)


def test_dashboard_rejects_out_of_range_window():
    with TestClient(app) as client:
        response = client.get("/api/dashboard?hours=240")
    assert response.status_code == 422



def test_censorship_api_returns_cached_ooni_results(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test")

    def fake_read_view(client, project_url, key, view, params):
        if view == "censored_domains":
            return [
                {"domain": "youtube.com", "confirmed_blocked": True, "confirmed_measurements": 3, "anomaly_measurements": 1, "measurement_count": 4},
                {"domain": "example-news.net", "confirmed_blocked": True, "confirmed_measurements": 1, "anomaly_measurements": 0, "measurement_count": 1},
            ]
        if view == "censorship_sync_runs":
            return [{
                "status": "success",
                "finished_at": "2026-11-15T10:00:00Z",
                "records_received": 4,
            }]
        if view == "censorship_coverage":
            return [{"domain_count": 2, "measurement_count": 5, "probe_networks": 2, "confirmed_measurements": 4, "anomaly_measurements": 1}]
        raise AssertionError(f"Unexpected view: {view}")

    monkeypatch.setattr("app.main._read_view", fake_read_view)
    with TestClient(app) as client:
        response = client.get("/api/censorship")

    assert response.status_code == 200
    payload = response.json()
    assert payload["domains"][0]["domain"] == "youtube.com"
    assert {item["domain"] for item in payload["domains"]} == {"youtube.com", "example-news.net"}
    assert payload["total_domains_observed"] == 2
    assert payload["coverage"]["probe_networks"] == 2
    assert payload["domains"][0]["confirmed_blocked"] is True
    assert payload["domains"][0]["source_url"].startswith(
        "https://explorer.ooni.org/search?probe_cc=IR&domain="
    )
    assert payload["sync"]["status"] == "success"
    assert payload["lookback_days"] == 90


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
