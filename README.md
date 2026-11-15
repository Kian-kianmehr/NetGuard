# NetGuard — نسخهٔ اولیهٔ ۱.۰.۰

NetGuard داشبورد عمومی فارسی برای پایش و توضیح شواهد وضعیت اینترنت ایران است.

**داشبورد زنده:** https://netguard-dashboard-63d8.onrender.com  
**مخزن:** https://github.com/Kian-kianmehr/NetGuard

## محدودهٔ MVP

ده بخش محصول: نمای کلی ملی، کیفیت داده، دامنه‌ها و OONI، دیتاسنترهای ایران و وضعیت جهانی ارائه‌دهندگان، هوش مصنوعی، تحلیل، سیگنال‌ها، رخدادها، منابع و روش‌شناسی.

منابع فعال:
- IODA: BGP، ping-slash24 و merit-nt در سطح ملی.
- OONI Web Connectivity: آزمون‌های داوطلبانه از ایران؛ نتیجهٔ تأییدشده از anomaly جداست.
- Citizen Lab: فهرست نامزدهای آزمون، نه شاهد قطعی فیلترینگ.
- صفحه‌های رسمی جهانی ارائه‌دهندگان.
- موجودی اولیهٔ ۱۳ مرکز یا محل میزبانی ایران با سطح شواهد؛ پایش زندهٔ مراکز فعال نیست.

## معماری production

```text
Supabase pg_cron / pg_net
  ├─ هر ۱۰ دقیقه: netguard-collector (IODA)
  ├─ هر ۱۰ دقیقه: netguard-censorship-collector (OONI)
  ├─ هر ۱۰ دقیقه: netguard-provider-collector
  └─ دقیقه‌های 03,13,23,33,43,53:
       POST محافظت‌شده به FastAPI برای ساخت Snapshot

Browser → Supabase REST SELECT → netguard_snapshots
          Publishable Key + RLS + cache مرورگر
```

Frontend: React/Vite روی Render Static Site. Backend: FastAPI روی Render Free برای API خواندنی و تولید Snapshot. Database: Supabase PostgreSQL. Collectorها سه Supabase Edge Function مستقل‌اند. بازدیدکننده باعث شروع جمع‌آوری نمی‌شود.

شش Snapshot: `dashboard_24`، `dashboard_72`، `dashboard_168`، `censorship`، `providers_status` و `iran_datacenters`. مرورگر دادهٔ آماده را می‌خواند و هر پنج دقیقه یا هنگام بازگشت تب تازه‌سازی می‌کند.

## API
- `GET /health` — سلامت پردازه و وجود تنظیمات؛ نه آزمون کامل پایگاه داده.
- `GET /api/dashboard?hours=24|72|168`
- `GET /api/censorship`
- `GET /api/providers/status`
- `GET /api/iran/datacenters`
- `POST /internal/collect-snapshots` — فقط با `x-netguard-token` معتبر.

## اجرای محلی

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload

# ترمینال دوم
cd frontend
cp .env.example .env.local
npm install
npm test
npm run dev
```

FastAPI برای خواندن Snapshot از `SUPABASE_URL` و `SUPABASE_PUBLISHABLE_KEY` استفاده می‌کند. Vite به `VITE_SUPABASE_URL` و `VITE_SUPABASE_PUBLISHABLE_KEY` نیاز دارد. Collector دستی `scripts/collect_ioda.py` فقط برای توسعه است و به `SUPABASE_SECRET_KEY` سمت سرور نیاز دارد؛ production از Edge Functionها استفاده می‌کند.

## امنیت و عملیات
- RLS روی جدول‌های exposed فعال است؛ نقش‌های عمومی فقط SELECT روی داده‌های عمومی دارند.
- جدول اعتبارنامهٔ Collector policy عمومی ندارد.
- Secret Key و Service Role Key در مرورگر قرار نمی‌گیرند.
- RPC `netguard_save_snapshot` با `SECURITY DEFINER` در schema عمومی قابل فراخوانی است، اما توکن داخلی بلند را با hash ذخیره‌شده تطبیق می‌دهد و فقط شش dataset مجاز را می‌پذیرد. Supabase Advisor به دلیل callable بودن آن هشدار می‌دهد؛ این مسیر نوشتن Snapshot فعلی عمدی است و باید در هر بازطراحی دسترسی دوباره بررسی شود.
- تست‌های Python و تست/Build فرانت‌اند در GitHub Actions اجرا می‌شوند.

## محدودیت‌های نسخهٔ اول
- ارزیابی ملی است؛ دو شاخص اصلی BGP و Ping از IODA می‌آیند و probe مستقل از چند استان/ISP وجود ندارد.
- دادهٔ ملی به شهر یا اپراتور تعمیم داده نمی‌شود.
- OONI فقط آزمون‌های probeهای داوطلب را پوشش می‌دهد؛ نبود نتیجه به معنی دسترسی آزاد نیست.
- خطای endpoint یا anomaly به‌تنهایی اثبات فیلترینگ، تحریم یا قطعی نیست.
- وضعیت جهانی ارائه‌دهندگان دسترسی از داخل ایران را ثابت نمی‌کند.
- موجودی دیتاسنترها پایش زندهٔ عملیاتی نیست.
- پیش‌بینی کوتاه‌مدت با شبکهٔ عصبی MLP دو لایهٔ پنهان روی توالی ۱۲ مشاهده انجام می‌شود و با ۲۰٪ انتهایی تاریخچه ارزیابی می‌شود؛ اگر از خط مبنای ساده بهتر نباشد، منتشر نمی‌شود. خروجی احتمال کالیبره‌شده نیست و مدل زمان بازیابی تا داشتن رخدادهای تاریخی برچسب‌خورده عددی نمی‌دهد.
- cadence ده‌دقیقه‌ای هدف عملیاتی است نه SLA؛ Render Free و منابع بالادستی بر آن اثر دارند.
- فایل LICENSE هنوز تعریف نشده است؛ مجوز استفادهٔ مجدد باید از سوی صاحب پروژه انتخاب شود.

## گام بعدی

MVP ملی بسته می‌شود. نسخهٔ بعدی باید probeهای مستقل در چند استان و اپراتور راه‌اندازی کند؛ فقط پس از فراهم شدن vantage point واقعی، نقشهٔ استانی و مقایسهٔ ISP ساخته می‌شود. نقشهٔ راه در `docs/ROADMAP_FA.md` آمده است.


## مدل‌های هوش مصنوعی

NetGuard از Isolation Forest برای تشخیص ناهنجاری و یک شبکهٔ عصبی MLP دو لایهٔ پنهان برای پیش‌بینی سری زمانی استفاده می‌کند. معماری، شیوهٔ آموزش، ارزیابی، محدودیت‌ها و نقشهٔ راه در [مستند معماری AI](docs/AI_ARCHITECTURE_FA.md) آمده است.
