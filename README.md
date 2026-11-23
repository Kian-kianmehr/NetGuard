# NetGuard

**An open-source platform for monitoring and explaining evidence about Iran's internet connectivity and censorship signals.**

[Live Dashboard](https://netguard-dashboard-63d8.onrender.com) · [GitHub Repository](https://github.com/Kian-kianmehr/NetGuard)

NetGuard brings together network reachability, internet measurement, censorship-test results, provider status, and infrastructure information in one public dashboard. It is designed to make changes in connectivity easier to inspect while keeping the limits of each data source explicit.

> **Scope:** NetGuard currently provides national-level monitoring. It does not claim reliable province-level or ISP-level visibility, and an anomaly is not, by itself, proof of censorship or an outage.

## Features

The MVP is organized around ten product areas:

- National overview
- Data quality and measurement coverage
- Domains and OONI results
- Iranian data centers and global provider status
- AI-assisted analysis
- Network and connectivity analysis
- Signals and indicators
- Incident log
- Data sources
- Methodology and limitations

### Data sources

| Source | What NetGuard uses it for | Important limitation |
| --- | --- | --- |
| [IODA](https://ioda.inetintel.cc.gatech.edu/) | National BGP, ping-slash24, and merit-nt signals | These measurements do not provide independent coverage of every ISP or province |
| [OONI](https://ooni.org/) Web Connectivity | Volunteer probe measurements originating from Iran | Results represent participating probes; missing measurements do not imply unrestricted access |
| [Citizen Lab](https://citizenlab.ca/) | Candidate domains for testing | A candidate list is not conclusive evidence that a domain is blocked |
| Official provider status pages | Global service-status context | Global status does not establish reachability from inside Iran |
| Initial infrastructure inventory | Evidence-qualified inventory of 13 Iranian data-center or hosting locations | This is not live operational monitoring of those facilities |

NetGuard keeps confirmed observations separate from anomalies and contextual signals. A failed endpoint, unusual measurement, or model output should be interpreted alongside its source, coverage, and timestamp.

## Architecture

```text
Supabase pg_cron / pg_net
  ├─ Every 10 minutes: netguard-collector (IODA)
  ├─ Every 10 minutes: netguard-censorship-collector (OONI)
  ├─ Every 10 minutes: netguard-provider-collector
  └─ At minutes 03, 13, 23, 33, 43, 53:
       Authenticated request to FastAPI to build snapshots

Browser
  └─ Render Static Site (React / Vite)
       └─ Render FastAPI (Frankfurt)
            └─ Supabase REST SELECT
                 └─ netguard_snapshots
```

| Component | Technology | Responsibility |
| --- | --- | --- |
| Frontend | React, Vite, Render Static Site | Public dashboard and visualizations |
| API | FastAPI, Render | Read-only snapshot API and snapshot generation |
| Database | Supabase PostgreSQL | Stores prepared dashboard snapshots and collector credentials |
| Collectors | Supabase Edge Functions | Independently collect IODA, OONI, and provider data |
| Scheduling | Supabase pg_cron / pg_net | Runs collectors and triggers snapshot generation |

The browser reads prepared snapshots; it does not start data collection. The API uses a short-lived cache, and the browser refreshes data every five minutes or when a background tab becomes active.

### Snapshot datasets

The current API reads six prepared datasets:

- `dashboard_24`
- `dashboard_72`
- `dashboard_168`
- `censorship`
- `providers_status`
- `iran_datacenters`

## API

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/health` | Process health and configuration-presence check; not a full database connectivity test |
| `GET` | `/api/dashboard?hours=24` | Dashboard snapshot for the last 24 hours |
| `GET` | `/api/dashboard?hours=72` | Dashboard snapshot for the last 72 hours |
| `GET` | `/api/dashboard?hours=168` | Dashboard snapshot for the last 168 hours |
| `GET` | `/api/censorship` | Censorship measurement snapshot |
| `GET` | `/api/providers/status` | Provider status snapshot |
| `GET` | `/api/iran/datacenters` | Iranian data-center inventory |
| `POST` | `/internal/collect-snapshots` | Protected endpoint for generating snapshots |

The internal snapshot endpoint requires a valid `x-netguard-token` header.

## Getting started

### Prerequisites

- Python and pip
- Node.js and npm
- A Supabase project with the required schema and functions configured

### 1. Start the API

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload
```

The API reads prepared snapshots using `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`.

### 2. Start the frontend

In a separate terminal:

```bash
cd frontend
cp .env.example .env.local
npm install
npm test
npm run dev
```

The browser communicates with the FastAPI service. `VITE_API_BASE_URL` is optional; when set, it overrides the default API base URL.

### 3. Collect IODA data manually (development only)

The `scripts/collect_ioda.py` script is intended for local development and requires the server-side `SUPABASE_SECRET_KEY`. Production collection is handled by the Supabase Edge Functions.

> Do not expose the Supabase secret key, service-role credentials, or the internal collection token in frontend code or public repositories.

## AI and analytical methods

NetGuard currently uses two complementary approaches:

- **Anomaly detection:** a multi-signal Isolation Forest model, alongside robust-deviation checks.
- **Short-term forecasting:** an MLP with two hidden layers (12–24–12–1), trained on sequences of 12 observations.

The forecasting pipeline requires at least 48 continuous sequences and reserves the final 20% of the history for time-ordered validation. A forecast is published only when it competes with the last-value baseline. Its output is not a calibrated probability.

The system does not produce a numeric recovery-time estimate because there is not yet a sufficiently labeled historical incident dataset. AI summaries are evidence-linked reports, not unrestricted chatbot responses; when fresh data is unavailable, the dashboard should state that limitation.

For implementation details, training and evaluation methodology, limitations, and planned work, see the [AI architecture document](docs/AI_ARCHITECTURE_FA.md).

## Security and operations

- Row Level Security (RLS) is enabled on exposed tables; public roles are limited to reading public data.
- The collector-credentials table has no public access policy.
- Supabase Secret Keys and service-role credentials must remain server-side.
- The `netguard_save_snapshot` RPC is callable in the public schema but validates a long internal token against a stored hash and accepts only the six permitted datasets. Supabase Advisor may flag the callable function; this write path is intentional in the current architecture and must be reassessed if the snapshot-writing design changes.
- Python tests and frontend tests/build run through GitHub Actions.
- The ten-minute collection cadence is an operational target, not an SLA. Render Free resources and upstream data providers can affect timing.

## Known limitations

- Monitoring is national-level. The two primary network indicators, BGP and ping, come from IODA; NetGuard does not yet operate independent probes across multiple provinces and ISPs.
- National measurements are not extrapolated to individual cities or operators.
- OONI coverage depends on volunteer probes. No result does not mean a service is accessible.
- An endpoint failure or anomaly alone does not prove censorship, sanctions-related disruption, or a nationwide outage.
- Global provider status does not prove that a service is reachable from Iran.
- The current inventory of Iranian data centers is not live operational monitoring.
- Forecasts and anomaly scores are analytical signals, not definitive incident classifications.
- The deployed collection interval is best-effort and is not guaranteed.

## Roadmap

The national-level MVP is the current scope. The next major step is deploying independent measurement probes across multiple provinces and network operators. Province-level maps and ISP comparisons should only be introduced when real measurement vantage points are available.

See the [roadmap](docs/ROADMAP_FA.md) for the current plan.

## Contributing

Issues, bug reports, and thoughtful contributions are welcome. When reporting a measurement issue, include the affected endpoint or dataset, the approximate time, and any relevant source context. Please avoid presenting a single anomaly as conclusive evidence without corroboration.

## License

NetGuard is released under the [MIT License](LICENSE).
