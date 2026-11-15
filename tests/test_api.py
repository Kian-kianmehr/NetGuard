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



def test_censorship_api_separates_ooni_evidence_from_test_candidates(monkeypatch):
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
    with TestClient(app) as client:
        response = client.get("/api/censorship")

    assert response.status_code == 200
    payload = response.json()
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


def test_provider_status_endpoint_returns_official_provider_snapshots(monkeypatch):
    import app.main as main

    monkeypatch.setattr(main, "_fetch_statuspage_provider", lambda provider: {
        "id": provider["id"], "name": provider["name"], "group": provider["group"],
        "status": "operational", "status_label": "عادی", "available": True,
        "description": provider["description"], "url": provider["url"],
        "data_center_count": 12, "components_attention": 1,
        "affected_locations": [{"name": "Example City - (EXM)", "status_label": "اختلال بخشی"}],
        "incidents": [], "technical_components": [], "checked_at": "2026-11-15T10:00:00Z",
    })
    monkeypatch.setattr(main, "_fetch_google_cloud_status", lambda: {
        "id": "google-cloud", "name": "Google Cloud و Vertex AI", "group": "infrastructure",
        "status": "operational", "status_label": "عادی", "available": True,
        "description": "آزمون", "url": "https://status.cloud.google.com/",
        "data_center_count": 0, "components_attention": 0,
        "affected_locations": [], "incidents": [], "technical_components": [],
        "checked_at": "2026-11-15T10:00:00Z",
    })
    main._PROVIDER_CACHE.update({"expires_at": 0, "payload": None})

    with TestClient(app) as client:
        response = client.get("/api/providers/status")

    assert response.status_code == 200
    payload = response.json()
    assert len(payload["providers"]) == 9
    cloudflare = next(item for item in payload["providers"] if item["id"] == "cloudflare")
    assert cloudflare["data_center_count"] == 12
    assert cloudflare["affected_locations"][0]["name"] == "Example City - (EXM)"
    assert "دسترسی از داخل ایران" in payload["scope_note"]


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
