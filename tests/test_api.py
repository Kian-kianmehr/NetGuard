from fastapi.testclient import TestClient

from app.main import app, _normalise_series

client = TestClient(app)


def test_health_endpoint():
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_dashboard_page_is_served():
    response = client.get("/")
    assert response.status_code == 200
    assert "NetGuard" in response.text


def test_dashboard_rejects_invalid_time_range():
    response = client.get("/api/dashboard?hours=500")
    assert response.status_code == 422


def test_normalise_series_preserves_missing_values():
    payload = {
        "data": [{
            "datasource": "bgp",
            "from": 1000,
            "step": 60,
            "values": [10, None, 8],
        }]
    }
    result = _normalise_series(payload, "bgp")
    assert result["latest"] == 8.0
    assert result["observations"] == 2
    assert result["missing"] == 1
    assert result["points"][1]["value"] is None


def test_normalise_series_rejects_empty_provider_response():
    try:
        _normalise_series({"data": []}, "bgp")
    except ValueError as error:
        assert "no time series" in str(error)
    else:
        raise AssertionError("Expected an empty provider response to fail.")
