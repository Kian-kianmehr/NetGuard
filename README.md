# NetGuard

مرکز پایش و تحلیل شواهد عمومی وضعیت اینترنت ایران.

## معماری نسخهٔ اول

- **Dashboard:** React + Vite، رابط فارسی و راست‌چین روی Render Static Site.
- **API:** FastAPI فقط‌خواندنی روی Render Free Web Service.
- **Database:** Supabase PostgreSQL با Row Level Security.
- **Collectors:** دو تابع Edge مستقل برای داده‌های IODA و آزمون‌های دسترسی OONI.
- **Scheduler:** دریافت IODA هر پنج دقیقه و همگام‌سازی OONI هر شش ساعت با `pg_cron` و `pg_net`.
- **Data sources:** سه سیگنال ملی IODA (`bgp`، `ping-slash24` و `merit-nt`) و اندازه‌گیری‌های Web Connectivity پروژهٔ OONI از شبکه‌های داخل ایران.

Collector از خوابیدن Web Service در Render مستقل است؛ برنامهٔ زمان‌بندی در خود Supabase اجرا می‌شود. API فقط Viewهای عمومی داشبورد را می‌خواند و عملیات نوشتن را انجام نمی‌دهد.

## داده‌ها و API

- `GET /health`: سلامت پردازهٔ API و وجود تنظیمات اتصال دیتابیس.
- `GET /api/dashboard?hours=168`: منابع، وضعیت تازگی و مشاهدات بازهٔ درخواستی (۶ تا ۱۶۸ ساعت).
- `GET /api/censorship`: همهٔ دامنه‌های دارای نتیجهٔ تأییدشده یا ناهنجاری OONI در ۹۰ روز اخیر، همراه با پوشش شبکه‌ها و تازگی داده.
- تحلیل یادگیری ماشین در پاسخ داشبورد: Isolation Forest بدون‌نظارت و شاخص ریسک آزمایشی ۳۰ دقیقه‌ای.
- داشبورد هر ۶۰ ثانیه API را بازخوانی می‌کند.
- جدول‌های `sources`، `observations` و `collector_runs` با RLS محافظت شده‌اند.
- نقش‌های عمومی فقط دسترسی خواندن Viewهای داشبورد را دارند؛ جدول اعتبارنامهٔ Collector برای نقش‌های عمومی قابل خواندن نیست.

## راه‌اندازی دیتابیس و Collector

فایل‌های SQL به‌ترتیب اجرا می‌شوند:

1. `sql/001_initial_schema.sql`
2. `sql/002_collector_scheduler.sql`
3. `sql/003_schedule_ioda_collector.sql`

تابع Edge در `supabase/functions/netguard-collector/index.ts` نگهداری می‌شود.

سه نام Secret در Supabase Vault استفاده می‌شود: `netguard_project_url`، `netguard_publishable_key` و `netguard_collector_token`. مقدارها محرمانه‌اند و نباید در Git یا فایل‌های عمومی ذخیره شوند. خود تابع از کلید Secret داخلی محیط Edge Function برای نوشتن در دیتابیس استفاده می‌کند؛ کلید سطح‌بالا به مرورگر یا سرویس فرانت‌اند داده نمی‌شود.

## راه‌اندازی محلی

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload

cd frontend
npm install
npm run dev
```

برای API محلی، `SUPABASE_URL` و `SUPABASE_PUBLISHABLE_KEY` را در محیط اجرا تنظیم کنید. برای اجرای دستی Collector پایتون در توسعه، کلید نوشتن باید فقط در محیط سرور محلی نگهداری شود؛ این مسیر در production فعال نیست.

## Deploy

- Render API: `pip install -r requirements.txt` و `uvicorn app.main:app --host 0.0.0.0 --port $PORT`.
- Render Dashboard: `cd frontend && npm install && npm run build`، خروجی `frontend/dist`.
- متغیر `VITE_API_URL` در Static Site به URL سرویس API اشاره می‌کند.
- `SUPABASE_URL` و `SUPABASE_PUBLISHABLE_KEY` فقط در محیط سرویس API استفاده می‌شوند.
- GitHub Actions تست‌های Python و build فرانت‌اند را روی شاخه‌های فعال اجرا می‌کند.

## محدودیت‌های نسخهٔ اول

- داده‌های فعلی IODA در این نسخه در سطح ملی‌اند؛ از آن‌ها وضعیت شهر، استان یا ISP استنتاج نمی‌شود.
- داده‌های OONI در صفحهٔ مستقل وب‌سایت‌های فیلترشده استفاده می‌شوند و در ارزیابی پایداری زیرساخت با سیگنال‌های IODA ادغام نمی‌شوند.
- تشخیص انحراف آماری «مورد نیازمند بررسی» است، نه اثبات قطعی خاموشی، فیلترینگ، تحریم یا علت اختلال.
- فهرست دامنه‌ها به allowlist ثابت محدود نیست و همهٔ موارد دارای نتیجهٔ `confirmed` یا `anomaly` در دادهٔ OONI طی ۹۰ روز را نشان می‌دهد. ناهنجاری به‌تنهایی اثبات فیلترینگ نیست.
- پوشش OONI به شبکه‌های داوطلب و آزمون‌های اجراشده محدود است؛ نبود دامنه در فهرست به معنی دسترسی آزاد نیست.
- مدل Isolation Forest برای تشخیص ناهنجاری بدون‌نظارت فعال است. برآورد ۳۰ دقیقه‌ای شاخص آزمایشی است، نه احتمال کالیبره‌شدهٔ اختلال.
- اجرای زمان‌بندی‌شده هر پنج دقیقه هدف سیستم است، نه SLA پایش ۲۴ساعته؛ دسترس‌پذیری تابع سهمیه و وضعیت سرویس‌های رایگان و خود منبع IODA است.

## اصول کیفیت داده

- دادهٔ گم‌شده صفر نیست.
- زمان مشاهده از زمان دریافت جدا نگهداری می‌شود.
- وضعیت هر منبع می‌تواند تازه، قدیمی، دارای خطا یا نامشخص باشد.
- مقادیر سیگنال‌هایی با واحد متفاوت مستقیماً با هم مقایسه نمی‌شوند.


## مدل هوشمند

جزئیات الگوریتم، ویژگی‌ها، حداقل تاریخچه و محدودیت‌های پیش‌بینی در [مستند مدل هوشمند](docs/INTELLIGENCE_FA.md) آمده است.
