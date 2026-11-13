# معماری نسخهٔ اول

```text
Browser
  |-- Render Static Site (React/Vite)
  |       |-- GET /api/dashboard
  |       v
  |-- Render Free Web Service (FastAPI, API + Collector scheduler)
          |-- read-only requests --> Supabase PostgREST
          |-- every 5 min while awake --> IODA public API
          `-- write observations + collector_runs --> Supabase Postgres
```

- فرانت‌اند و API روی دو سرویس Render مستقر می‌شوند؛ دادهٔ پایدار در Supabase می‌ماند.
- Collector در همان پردازهٔ FastAPI زمان‌بندی می‌شود؛ سرویس رایگان Render در بی‌درخواستی می‌خوابد، بنابراین این چرخه ۲۴/۷ یا SLA تضمین‌شده نیست.
- هنگام استفاده از داشبورد، بازخوانی API هر ۶۰ ثانیه سرویس را بیدار نگه می‌دارد و چرخهٔ هدف پنج‌دقیقه‌ای می‌تواند اجرا شود.
- کلید publishable فقط برای خواندن public و با RLS است؛ کلید secret فقط در متغیر محیطی Web Service و برای نوشتن Collector است.
- هیچ secret در frontend، GitHub یا فایل عمومی repository قرار نمی‌گیرد.
- مناطق جغرافیایی فقط در صورت وجود vantage point معتبر نمایش داده می‌شوند.
