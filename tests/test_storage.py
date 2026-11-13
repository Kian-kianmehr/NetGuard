import httpx
from netguard.storage import SupabaseREST


class CaptureTransport(httpx.BaseTransport):
    def __init__(self):
        self.requests = []

    def handle_request(self, request):
        self.requests.append(request)
        return httpx.Response(201, request=request)


def test_new_secret_key_only_uses_apikey_header():
    transport = CaptureTransport()
    client = httpx.Client(transport=transport)
    store = SupabaseREST("https://example.supabase.co", "sb_secret_example", client)
    store.insert_run({"status": "success"})
    request = transport.requests[0]
    assert request.headers["apikey"] == "sb_secret_example"
    assert "authorization" not in request.headers
    client.close()


def test_legacy_service_role_jwt_also_uses_bearer():
    transport = CaptureTransport()
    client = httpx.Client(transport=transport)
    store = SupabaseREST("https://example.supabase.co", "eyJlegacy.jwt.key", client)
    store.insert_run({"status": "success"})
    assert transport.requests[0].headers["authorization"] == "Bearer eyJlegacy.jwt.key"
    client.close()


def test_empty_batch_sends_no_request():
    transport = CaptureTransport()
    client = httpx.Client(transport=transport)
    store = SupabaseREST("https://example.supabase.co", "sb_secret_example", client)
    assert store.upsert_observations([]) == 0
    assert not transport.requests
    client.close()
