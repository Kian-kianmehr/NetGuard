# Changelog

## 1.0.0 — National MVP

- Public Persian dashboard with national overview, analysis, signals, events, source health, data quality, OONI evidence, global provider status, Iranian data-center inventory, AI analysis, and methodology.
- Scheduled IODA, OONI, and provider collectors through Supabase Edge Functions and pg_cron.
- Precomputed 24-hour, 3-day, and 7-day dashboard snapshots; read-only browser access with RLS and local cache.
- Source-specific cadence and freshness assessment, including upstream observation delays.
- Historical, current, and operational event lifecycle with cautious multi-signal interpretation.
- Unsupervised anomaly scoring and experimental trend extrapolation.
- Explicit scope and evidence limitations; no inference of province/ISP health from national data.

### Known v1 limitations

- No independent in-country probes by province or ISP.
- Iranian data-center inventory is not live operational monitoring.
- Provider status is global and does not establish reachability from Iran.
- Trend projection is not a calibrated disruption probability; recovery-time estimation is withheld without labelled incident history.
- Scheduled operation on free infrastructure is best-effort, not an uptime SLA.
- No repository license has been selected yet.
