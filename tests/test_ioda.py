from datetime import datetime, timezone
import httpx
import pytest

from netguard.config import SOURCES, Settings
from netguard.ioda import IODAClient, normalize_signal_payload


def test_normalizer_preserves_timestamps_and_missing_points():
    collected = datetime(2026, 11, 13, 12, 5, tzinfo=timezone.utc)
    payload = {"data": [{
        "datasource": "bgp", "from": 1_800_000_000, "step": 60,
        "nativeStep": 60, "values": [10, 11.5, None, 13],
    }]}
    rows = normalize_signal_payload(payload, SOURCES[0], collected_at=collected)
    assert [row.value for row in rows] == [10.0, 11.5, 13.0]
    assert rows[1].observed_at == "2027-01-15T08:01:00Z"
    assert all(row.collected_at == "2026-11-13T12:05:00Z" for row in rows)
    assert all(row.geographic_scope == "country" for row in rows)


def test_object_values_and_invalid_values_are_not_zero_filled():
    payload = {"signal": [{
        "datasource": "bgp", "from": 1_800_000_000, "step": 60,
        "values": [{"value": 2.5}, {"count": 4}, None, -1, float("nan"), True],
    }]}
    rows = normalize_signal_payload(payload, SOURCES[0])
    assert [row.value for row in rows] == [2.5, 4.0]
    assert rows[1].metadata["value_field"] == "count"


def test_duplicate_timestamps_are_deduplicated():
    payload = [
        {"datasource": "bgp", "from": 1_800_000_000, "step": 60, "values": [1, 2]},
        {"datasource": "bgp", "from": 1_800_000_000, "step": 60, "values": [3, 4]},
    ]
    rows = normalize_signal_payload(payload, SOURCES[0])
    assert [row.value for row in rows] == [3.0, 4.0]


def test_client_uses_official_source_parameter():
    settings = Settings("https://example.supabase.co", "sb_secret_test",
                        "https://ioda.example/v2", "IR", 2, 24, 10)
    seen = {}

    def handler(request):
        seen["url"] = str(request.url)
        return httpx.Response(200, json={"data": [{
            "datasource": "bgp", "from": 1_800_000_000, "step": 60, "values": [1]
        }]})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    api = IODAClient(settings, client=client)
    api.fetch(SOURCES[0], now=datetime(2026, 11, 13, tzinfo=timezone.utc))
    assert "/signals/raw/country/IR" in seen["url"]
    assert "source=bgp" in seen["url"]
    assert "datasource=" not in seen["url"]
    client.close()


def test_error_envelope_is_rejected():
    with pytest.raises(ValueError):
        normalize_signal_payload({"error": "upstream failed"}, SOURCES[0])
