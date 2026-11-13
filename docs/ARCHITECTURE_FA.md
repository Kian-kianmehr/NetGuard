# معماری نسخهٔ اول

```text
IODA public API
     |
GitHub Actions (target: every 5 min, best effort)
     |
Python collector -> normalize -> deduplicate
     |
Supabase Postgres / PostgREST
     |
React + Vite dashboard on Render Static Site
```

- Collector مستقل از درخواست‌های مرورگر اجرا می‌شود.
- داشبورد هر ۶۰ ثانیه viewهای Supabase را refresh می‌کند.
- کلید secret فقط در GitHub Actions است.
- کلید publishable/anon فقط دسترسی خواندن عمومی از طریق RLS دارد.
- Static Site برای روشن‌ماندن به Web Service نیاز ندارد.
- زمان‌بندی Actions تضمین لحظه‌ای یا SLA نیست.
