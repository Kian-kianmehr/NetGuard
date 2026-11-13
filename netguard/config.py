from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Source:
    source_id: str
    signal: str
    display_name: str
    unit: str
    description: str
    expected_interval_seconds: int = 300
    stale_after_seconds: int = 1800


SOURCES = (
    Source("ioda:IR:bgp", "bgp", "دیدپذیری BGP", "Visible IPv4 /24 networks",
           "شبکه‌های IPv4 قابل مشاهده از مسیر BGP؛ نمایندهٔ تجربهٔ همهٔ کاربران نیست."),
    Source("ioda:IR:ping-slash24", "ping-slash24", "پایش فعال شبکه", "Reachable IPv4 /24 networks",
           "سیگنال probe فعال IODA؛ نتیجهٔ یک نقطه به تمام کاربران تعمیم داده نمی‌شود."),
    Source("ioda:IR:merit-nt", "merit-nt", "تلسکوپ شبکه", "Unique source IPs",
           "مشاهدات تلسکوپ شبکهٔ Merit؛ تغییر آن به‌تنهایی علت اختلال را اثبات نمی‌کند.",
           stale_after_seconds=7200),
)


@dataclass(frozen=True, slots=True)
class Settings:
    supabase_url: str
    supabase_secret_key: str
    ioda_base_url: str
    country_code: str
    lookback_hours: int
    max_points: int
    timeout_seconds: float

    @classmethod
    def from_env(cls) -> "Settings":
        url = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
        key = (os.getenv("SUPABASE_SECRET_KEY", "").strip()
               or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip())
        if not url.startswith("https://"):
            raise ValueError("SUPABASE_URL must be an HTTPS project URL.")
        if not key:
            raise ValueError("SUPABASE_SECRET_KEY is not configured.")
        country = os.getenv("NETGUARD_COUNTRY_CODE", "IR").strip().upper()
        if len(country) != 2 or not country.isalpha():
            raise ValueError("NETGUARD_COUNTRY_CODE must be a two-letter country code.")
        lookback = int(os.getenv("IODA_LOOKBACK_HOURS", "4"))
        max_points = int(os.getenv("IODA_MAX_POINTS", "240"))
        timeout = float(os.getenv("IODA_TIMEOUT_SECONDS", "20"))
        if not 1 <= lookback <= 744:
            raise ValueError("IODA_LOOKBACK_HOURS must be between 1 and 744.")
        if not 10 <= max_points <= 10000:
            raise ValueError("IODA_MAX_POINTS must be between 10 and 10000.")
        if not 1 <= timeout <= 60:
            raise ValueError("IODA_TIMEOUT_SECONDS must be between 1 and 60.")
        return cls(url, key,
                   os.getenv("IODA_BASE_URL", "https://api.ioda.inetintel.cc.gatech.edu/v2").strip().rstrip("/"),
                   country, lookback, max_points, timeout)
