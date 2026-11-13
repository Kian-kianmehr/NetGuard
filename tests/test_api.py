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
