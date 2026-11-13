# NetGuard

مرکز پایش و تحلیل شواهد عمومی وضعیت اینترنت ایران.

## معماری نسخهٔ اول
- React/Vite فارسی به‌صورت Render Static Site.
- FastAPI به‌صورت Render Free Web Service برای API فقط‌خواندنی.
- Collector پایتون در همان سرویس API؛ چرخهٔ هدف پنج‌دقیقه‌ای هنگام بیداربودن سرویس.
- Supabase PostgreSQL برای ثبت تاریخچه، و RLS برای خواندن عمومی.
- سه سیگنال ملی IODA: `bgp`، `ping-slash24` و `merit-nt`.

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

## راه‌اندازی Supabase
1. فایل `sql/001_initial_schema.sql` را یک‌بار در SQL Editor پروژه اجرا کنید.
2. کلیدهای Supabase را فقط در Environment سرویس API در Render قرار دهید:
   - `SUPABASE_URL`
   - `SUPABASE_PUBLISHABLE_KEY` (یا کلید قدیمی anon)
   - `SUPABASE_SECRET_KEY` (یا کلید قدیمی service_role؛ فقط برای Collector)
3. کلید secret را هرگز به فرانت‌اند ندهید.

## Deploy روی Render
- سرویس `netguard-api`: Python Web Service، build: `pip install -r requirements.txt`، start: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`، health: `/health`.
- سرویس `netguard-dashboard`: Static Site، build: `cd frontend && npm install && npm run build`، publish: `frontend/dist`.
- مقدار `VITE_API_URL` در Static Site برابر URL عمومی سرویس API است.

## محدودیت اجرا
پلن رایگان Render برای Web Service پس از دورهٔ بی‌درخواست به حالت خواب می‌رود. Collector در همان پردازه اجرا می‌شود؛ بنابراین زمان‌بندی پنج‌دقیقه‌ای فقط تا وقتی سرویس بیدار است ادامه دارد و SLA یا پایش ۲۴ساعته نیست. Static Site مستقل از خواب API در CDN قابل‌دسترسی می‌ماند.

## محدودیت اندازه‌گیری
IODA دادهٔ زیرساختی ملی است، نه سنجش تجربهٔ تک‌تک کاربران یا همهٔ ISPها. تغییر یک سیگنال به‌تنهایی قطعی، سانسور، تحریم یا علت اختلال را اثبات نمی‌کند. دادهٔ ملی به استان یا شهر تعمیم داده نمی‌شود.
