from netguard.collector import collect_one
from netguard.config import SOURCES


class FakeIODA:
    def __init__(self, error=None):
        self.error = error

    def fetch(self, source, *, now=None):
        if self.error:
            raise self.error
        return []


class FakeStorage:
    def __init__(self):
        self.runs = []

    def upsert_observations(self, rows):
        return len(list(rows))

    def insert_run(self, row):
        self.runs.append(row)


def test_empty_response_is_recorded_as_no_data():
    storage = FakeStorage()
    result = collect_one(SOURCES[0], FakeIODA(), storage)
    assert result["status"] == "no_data"
    assert result["records_received"] == 0
    assert storage.runs[0]["source_id"] == SOURCES[0].source_id


def test_collector_error_message_does_not_leak_response_body():
    storage = FakeStorage()
    result = collect_one(
        SOURCES[0], FakeIODA(ValueError("private secret body")), storage
    )
    assert result["status"] == "error"
    assert result["error_code"] == "invalid_payload"
    assert "private secret body" not in result["error_message"]
