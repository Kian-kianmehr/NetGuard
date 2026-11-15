# مدل دادهٔ NetGuard

## دادهٔ خام
- `sources`: registry منبع، سیگنال، واحد، cadence مورد انتظار، آستانهٔ stale و وضعیت فعال بودن.
- `collector_runs`: زمان شروع/پایان، وضعیت اجرا، تعداد رکورد دریافت/ثبت‌شده، مدت و کد خطای پاک‌سازی‌شده.
- `observations`: source_id، observed_at، collected_at، value، unit، geographic_scope، quality، external_id و metadata.
- قید یکتا روی `(source_id, observed_at)` اجرای مجدد را idempotent می‌کند.

## پایش دامنه‌ها
- `censorship_measurements`: نتیجه‌های OONI به تفکیک دامنه، classification، زمان آزمون و probe ASN.
- `censorship_sync_runs`: تاریخچهٔ اجرای همگام‌سازی OONI و وضعیت/خطا.
- `censorship_test_domains`: فهرست نامزدهای Citizen Lab، مستقل از نتیجهٔ OONI.
- Viewهای `censored_domains` و `censorship_coverage` شواهد و پوشش اندازه‌گیری را برای تحلیل آماده می‌کنند.

## خروجی عمومی و اعتبارنامه
- `netguard_snapshots`: شش Snapshot ازپیش‌محاسبه‌شده برای داشبورد، OONI، ارائه‌دهندگان و موجودی مراکز داده.
- `netguard_snapshot_runs`: تاریخچهٔ ساخت Snapshotها و وضعیت موفق/ناقص/ناموفق.
- `netguard_collector_credentials`: فقط hash توکن داخلی Collector؛ RLS فعال و بدون policy عمومی.
- `iran_datacenters`: موجودی اطلاعاتی مراکز/مکان‌های میزبانی با سطح اعتبار منبع و وضعیت پایش.

## دسترسی
RLS روی جدول‌های exposed فعال است. نقش‌های عمومی فقط SELECT روی داده‌های عمومی و تعریف‌شده دارند. نوشتن دادهٔ خام با کلید محرمانهٔ Edge Function انجام می‌شود؛ نوشتن Snapshot از RPC محدودشدهٔ `netguard_save_snapshot` و اعتبارنامهٔ داخلی عبور می‌کند. هیچ Secret Key یا Service Role Key به فرانت‌اند داده نمی‌شود.
