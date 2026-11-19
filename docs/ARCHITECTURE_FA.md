# معماری عملیاتی NetGuard — چرخهٔ داده و تحلیل مستقل

بازدیدکننده هیچ پردازش جمع‌آوری یا مدل را آغاز نمی‌کند و منتظر اجرای آن نمی‌ماند. سایت فقط آخرین Snapshot کامل و منتشرشده را می‌خواند:

```text
هر ۱۰ دقیقه — Supabase pg_cron
  ├─ Edge Collector: IODA
  ├─ Edge Collector: OONI
  └─ Edge Collector: provider status

دقیقهٔ 03
  └─ Render FastAPI /internal/collect-snapshots
       ├─ خواندن دادهٔ آماده‌شده
       ├─ ساخت cycle_id
       ├─ ذخیرهٔ dashboard_staging (فقط داده، بدون AI)
       └─ ساخت Snapshotهای مستقل OONI و مراکز داده

دقیقهٔ 05
  └─ Render FastAPI /internal/analyze-dashboard-cycle
       └─ subprocess: python -m netguard.ai_worker
            ├─ خواندن همان dashboard_staging و cycle_id
            ├─ اجرای مدل‌ها یک بار روی تاریخچهٔ کامل
            ├─ ساخت پنجره‌های 24/72/168 ساعته
            └─ یک RPC تراکنشی برای انتشار هر سه Snapshot

سایت
  └─ GET /api/dashboard?hours=24|72|168
       └─ فقط آخرین Snapshot کامل؛ بدون اجرای Collector یا AI
```

## اجزا
- Frontend: React و Vite روی Render Static Site.
- Backend/API: FastAPI روی Render Free برای API خواندنی و اجرای درخواست‌های زمان‌بندی‌شده.
- AI worker: پردازش Python مستقل در یک child process کوتاه‌عمر روی همان میزبان Backend؛ بدون سرویس یا هزینهٔ زیرساخت جدید.
- Database: Supabase PostgreSQL.
- Collectors: سه Supabase Edge Function مستقل برای IODA، OONI و وضعیت جهانی ارائه‌دهندگان.
- Scheduler: Supabase pg_cron و pg_net.

## چرخهٔ داده
1. Edge Functionها هر ۱۰ دقیقه دادهٔ خام را دریافت و در Supabase ذخیره می‌کنند.
2. زمان مشاهدهٔ منبع (`observed_at`) از زمان دریافت (`collected_at`) جداست.
3. job تجمیع در دقیقه‌های 03،13،23،33،43 و 53 یک `cycle_id` می‌سازد و تاریخچهٔ همان چرخه را در `dashboard_staging` قرار می‌دهد؛ این مرحله مدل AI را اجرا نمی‌کند.
4. job مستقل AI در دقیقه‌های 05،15،25،35،45 و 55 همان `cycle_id` را می‌خواند. مدل فقط یک بار اجرا می‌شود و خروجی آن به پنجره‌های 24،72 و 168 ساعت متصل می‌شود.
5. یک RPC تراکنشی هر سه Snapshot را با همان `cycle_id` منتشر می‌کند. تا پایان تحلیل، Snapshot قبلی دست‌نخورده می‌ماند؛ در خطا، آخرین بستهٔ سالم روی سایت می‌ماند.
6. داشبورد برای هر درخواست فقط Snapshot از پیش محاسبه‌شده را می‌خواند و هیچ‌وقت منتظر اجرای مدل یا Collector نیست.

## تازگی داده و چرخه
- زمان اجرای چرخه، زمان مرجع تحلیل است؛ چند دقیقه فاصلهٔ اجرای job تحلیل باعث قدیمی‌تر شمردن داده نمی‌شود.
- آستانهٔ اعتبار هر منبع از `stale_after_seconds` همان منبع می‌آید، نه یک شرط عمومیِ سخت‌گیرانه‌تر از سه برابر cadence.
- `observed_at` و `collected_at` هر دو حفظ می‌شوند. اجرای موفق Collector به‌تنهایی ثابت نمی‌کند منبع بالادستی نمونهٔ تازه‌ای منتشر کرده است.
- اگر یک منبع واقعاً از پنجرهٔ اعتبار خودش عبور کند، فقط همان منبع از نتیجهٔ مربوط کنار گذاشته می‌شود؛ سایر شاخص‌های معتبر همچنان تحلیل می‌شوند.

## API
- GET /health: سلامت پردازه و وجود تنظیمات؛ نه آزمون کامل پایگاه داده.
- GET /api/dashboard?hours=24|72|168
- GET /api/censorship
- GET /api/providers/status
- GET /api/iran/datacenters
- POST /internal/collect-snapshots: دریافت و stage داده، فقط با `x-netguard-token`.
- POST /internal/analyze-dashboard-cycle: اجرای subprocess مدل، فقط با `x-netguard-token`.

## محدودیت اجرا
در پلن رایگان، AI به‌صورت process جدا از API request path اجرا می‌شود اما میزبان زیرساخت مشترک است؛ این جداسازی process-level است، نه یک ماشین یا سرویس همیشه‌روشن مستقل. برای جداسازی کامل failure-domain به worker service جدا نیاز است که در این نسخه هزینهٔ جدید ایجاد نمی‌کنیم.
