# NetGuard

مرکز پایش و تحلیل شواهد عمومی وضعیت اینترنت ایران.

## نسخه ۱
- داشبورد فارسی و راست‌چین با شش بخش: نمای کلی، تحلیل، سیگنال‌ها، رخدادها، منابع و روش‌شناسی.
- دریافت سه سیگنال ملی IODA برای ایران: `bgp`، `ping-slash24` و `merit-nt`.
- Collector مستقل پایتون و ذخیرهٔ تاریخچه در Supabase PostgreSQL.
- اجرای هدف‌گذاری‌شده هر پنج دقیقه از GitHub Actions؛ زمان‌بندی best-effort است و SLA ندارد.
- ثبت زمان مشاهدهٔ upstream و زمان دریافت به‌صورت جداگانه.
- دادهٔ خالی، قدیمی و خطادار «سالم» فرض نمی‌شود.

## اجرای محلی
```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python -m pytest -q
python scripts/collect_ioda.py

cd frontend
npm install
npm run dev
```

## راه‌اندازی آنلاین
1. یک بار فایل `sql/001_initial_schema.sql` را در SQL Editor پروژهٔ Supabase اجرا کنید.
2. در GitHub → Settings → Secrets and variables → Actions یک repository secret با نام `SUPABASE_SECRET_KEY` بسازید.
3. در Render یک Static Site از همین repository و شاخهٔ `master` بسازید. Build command: `cd frontend && npm install && npm run build`؛ Publish directory: `frontend/dist`.
4. در environment variables سایت Render این دو مقدار را تنظیم کنید:
   - `VITE_SUPABASE_URL`: آدرس پروژه
   - `VITE_SUPABASE_PUBLISHABLE_KEY`: کلید publishable یا anon عمومی
5. در GitHub Actions، workflow با نام NetGuard IODA collection را یک بار دستی اجرا کنید.

کلید secret فقط در GitHub Actions قرار می‌گیرد؛ آن را هرگز در frontend یا فایل عمومی repository نگذارید.

## محدودیت‌های اندازه‌گیری
IODA دادهٔ زیرساختی ملی است، نه سنجش تجربهٔ تک‌تک کاربران یا تمام ISPها. تغییر یک سیگنال به‌تنهایی قطعی، سانسور، تحریم یا علت اختلال را اثبات نمی‌کند. دادهٔ ملی به استان یا شهر تعمیم داده نمی‌شود. پیش‌بینی تا زمانی که تاریخچهٔ کافی و ارزیابی معتبر وجود نداشته باشد فعال نیست.
