from __future__ import annotations

from typing import Any, Iterable
import httpx


class SupabaseREST:
    """PostgREST writer. New sb_secret keys are sent only in the apikey header."""

    def __init__(self, project_url: str, secret_key: str,
                 client: httpx.Client | None = None):
        if not project_url.startswith("https://"):
            raise ValueError("Supabase URL must use HTTPS.")
        if not secret_key:
            raise ValueError("Supabase secret key is required.")
        self.base_url = project_url.rstrip("/") + "/rest/v1"
        self._owns_client = client is None
        self.client = client or httpx.Client(timeout=httpx.Timeout(20.0))
        headers = {
            "apikey": secret_key,
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": "NetGuard-Collector/1.0",
        }
        if secret_key.startswith("eyJ"):  # legacy service_role JWT only
            headers["Authorization"] = f"Bearer {secret_key}"
        self.client.headers.update(headers)

    def close(self) -> None:
        if self._owns_client:
            self.client.close()

    def _post(self, table: str, payload: Any, *,
              params: dict[str, str] | None = None,
              prefer: str = "return=minimal") -> None:
        response = self.client.post(
            f"{self.base_url}/{table}", params=params,
            headers={"Prefer": prefer}, json=payload,
        )
        response.raise_for_status()

    def upsert_observations(self, rows: Iterable[dict[str, Any]]) -> int:
        payload = list(rows)
        if not payload:
            return 0
        self._post("observations", payload,
                   params={"on_conflict": "source_id,observed_at"},
                   prefer="resolution=merge-duplicates,return=minimal")
        return len(payload)

    def insert_run(self, row: dict[str, Any]) -> None:
        self._post("collector_runs", row)
