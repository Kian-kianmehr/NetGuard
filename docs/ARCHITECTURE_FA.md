# معماری عملیاتی NetGuard — نسخهٔ اول

بازدیدکننده نه جمع‌آوری را شروع می‌کند و نه منتظر اجرای مدل می‌ماند. چرخهٔ داده در پس‌زمینه اجرا می‌شود:

```text
Supabase pg_cron / pg_net
  ├─ هر ۱۰ دقیقه: IODA Edge Collector
  ├─ هر ۱۰ دقیقه: OONI Edge Collector
  ├─ هر ۱۰ دقیقه: Provider Status Edge Collector
  └─ دقیقه‌های 03,13,23,33,43,53:
       x-netguard-token → Render FastAPI
                           /internal/collect-snapshots
                               │
                      خواندن viewها + تحلیل
                               │
                      netguard_snapshots
                               ▲
                Supabase REST SELECT + RLS
                               │
                 Render Static Site / Browser
```

## اجزا
- Frontend: React و Vite روی Render Static Site.
- Backend: FastAPI روی Render Free برای API خواندنی و ساخت Snapshot.
- Database: Supabase PostgreSQL.
- Collectors: سه Supabase Edge Function برای IODA، OONI و وضعیت رسمی ارائه‌دهندگان.
- Scheduler: Supabase pg_cron و pg_net.

## چرخهٔ داده
1. Edge Functionها هر ۱۰ دقیقه دادهٔ خام را دریافت می‌کنند.
2. observed_at زمان مشاهده و collected_at زمان دریافت را جدا نگه می‌دارند.
3. job تجمیع به endpoint داخلی Render درخواست محافظت‌شده می‌فرستد.
4. FastAPI تاریخچه‌های ۲۴، ۷۲ و ۱۶۸ ساعت را می‌خواند، تحلیل آماری/ML را اجرا می‌کند و شش Snapshot عمومی را می‌سازد.
5. Snapshotها از طریق RPC netguard_save_snapshot با توکن داخلی ذخیره می‌شوند.
6. مرورگر Snapshotهای لازم را با Publishable Key و RLS می‌خواند و cache می‌کند.

## Snapshot و تازگی
| کلید | محتوا | آستانهٔ stale |
|---|---|---:|
| dashboard_24 | ۲۴ ساعت | ۱۵ دقیقه |
| dashboard_72 | ۳ روز | ۱۵ دقیقه |
| dashboard_168 | ۷ روز | ۱۵ دقیقه |
| censorship | شواهد OONI | ۳۰ دقیقه |
| providers_status | وضعیت جهانی | ۱۵ دقیقه |
| iran_datacenters | موجودی دیتاسنتر | ۳۰ دقیقه |

اگر Snapshot کهنه باشد با is_stale مشخص می‌شود؛ دادهٔ قدیمی به‌عنوان تازه معرفی نمی‌شود.

## API
- GET /health: سلامت پردازه و وجود تنظیمات؛ نه آزمون کامل پایگاه داده.
- GET /api/dashboard?hours=24|72|168
- GET /api/censorship
- GET /api/providers/status
- GET /api/iran/datacenters
- POST /internal/collect-snapshots: فقط با x-netguard-token معتبر.

## امنیت
- RLS روی جدول‌های exposed فعال است.
- anon و authenticated فقط SELECT روی داده‌های عمومی دارند.
- netguard_collector_credentials policy عمومی ندارد.
- Edge Functionها کلید نوشتن را از secret محیط اجرا می‌گیرند.
- RPC netguard_save_snapshot از SECURITY DEFINER استفاده می‌کند، اما توکن بلند را با hash تطبیق می‌دهد و datasetها را whitelist می‌کند. این طراحی دلیل هشدار Supabase Advisor دربارهٔ callable بودن RPC است و باید در بازطراحی دسترسی دوباره ارزیابی شود.
- هیچ Secret Key یا Service Role Key در Frontend نیست.

## محدودیت
- Render Free ممکن است بخوابد؛ SLA تضمین‌شده وجود ندارد.
- موفقیت Collector تضمین نمی‌کند منبع بالادستی مشاهدهٔ تازه منتشر کرده باشد.
- دادهٔ قدیمی، تأخیر cadence و خطای Collector جدا هستند.
- در شکست تجمیع ممکن است Snapshot قبلی باقی بماند؛ collected_at و is_stale باید بررسی شوند.
- مراکز دادهٔ ایران در v1 پایش زندهٔ سلامت ندارند.