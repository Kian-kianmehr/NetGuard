import pytest
from netguard.config import Settings


def test_missing_secret_is_rejected(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.delenv("SUPABASE_SECRET_KEY", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    with pytest.raises(ValueError, match="SUPABASE_SECRET_KEY"):
        Settings.from_env()


def test_valid_settings(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SECRET_KEY", "sb_secret_test")
    monkeypatch.setenv("IODA_LOOKBACK_HOURS", "3")
    settings = Settings.from_env()
    assert settings.country_code == "IR"
    assert settings.lookback_hours == 3
    assert settings.max_points == 240
