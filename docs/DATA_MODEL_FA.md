# مدل داده NetGuard

- `sources`: registry منبع، signal، واحد، توضیح، URL مستندات، cadence و stale threshold.
- `collector_runs`: زمان شروع/پایان، وضعیت، تعداد رکورد، مدت و خطای پاک‌سازی‌شده.
- `observations`: source_id، observed_at، collected_at، value، unit، geographic_scope، quality، external_id و metadata.
- unique constraint روی `(source_id, observed_at)` اجرای مجدد را idempotent می‌کند.
- viewهای `dashboard_sources` و `dashboard_observations` فیلدهای موردنیاز داشبورد را ارائه می‌کنند.

کلید secret فقط سمت Collector است. RLS خواندن عمومی را به داده‌های تعریف‌شده محدود می‌کند.
