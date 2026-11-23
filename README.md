# NetGuard

**Evidence-based monitoring and analysis of Iran's internet connectivity.**

[Live dashboard](https://netguard-dashboard-63d8.onrender.com) · [Repository](https://github.com/Kian-kianmehr/NetGuard)

NetGuard brings together network measurements, censorship-test results, provider status, and infrastructure context in one public dashboard. Its goal is to make changes in connectivity easier to inspect without overstating what the available data can prove.

> **Current scope:** National-level monitoring. NetGuard does not currently provide reliable province-level or ISP-level visibility. An anomaly is a signal for investigation—not proof of censorship or a nationwide outage.

## What it includes

- National connectivity overview and historical trends
- Data-quality, freshness, and measurement-coverage indicators
- IODA network measurements and OONI Web Connectivity results
- Candidate domains from Citizen Lab
- Global provider-status context
- An inventory of Iranian data-center and hosting locations
- Statistical analysis, anomaly detection, and short-term forecasting
- Evidence-linked analytical summaries and an incident log
- Data-source notes, methodology, and known limitations

## Data sources

| Source | Use | Limitation |
| --- | --- | --- |
| [IODA](https://ioda.inetintel.cc.gatech.edu/) | National BGP, ping-slash24, and merit-nt measurements | Does not independently represent every province or ISP |
| [OONI](https://ooni.org/) | Web Connectivity measurements from volunteer probes in Iran | Coverage depends on participating probes; missing results do not mean a service is accessible |
| [Citizen Lab](https://citizenlab.ca/) | Candidate domains for measurement | A candidate domain is not, by itself, evidence that it is blocked |
| Official provider status pages | Global service-status context | Global status does not establish reachability from Iran |
| Infrastructure inventory | Context about Iranian data-center and hosting locations | Not live operational monitoring of those facilities |

NetGuard distinguishes observations, data-quality issues, and analytical signals. Each result should be interpreted with its source, timestamp, and coverage in mind.

## How it works

The collection pipeline and public dashboard are separated:

```text
Supabase pg_cron / pg_net
  ├── IODA collector
  ├── OONI collector
  ├── Provider-status collector
  └── Authenticated request to the API for snapshot generation

Browser
  └── React / Vite dashboard
        └── FastAPI service
              └── Supabase PostgreSQL (prepared snapshots)
```

| Component | Technology | Responsibility |
| --- | --- | --- |
| Frontend | React, Vite | Public dashboard and visualizations |
| API | FastAPI, Python | Read-only data API and protected snapshot generation |
| Database | Supabase PostgreSQL | Measurement data and prepared dashboard snapshots |
| Collectors | Supabase Edge Functions | Collection from external data sources |
| Scheduling | Supabase pg_cron / pg_net | Scheduled collection and snapshot jobs |

The browser reads prepared data; it does not trigger collection. Collection is scheduled independently, while the dashboard refreshes its data periodically.

## AI and analytical methods

NetGuard uses machine-learning models as analytical tools—not as an unrestricted chatbot or a source of ground truth.

- **Anomaly detection:** Isolation Forest models identify unusual patterns in individual signals and, when coverage permits, across multiple signals. Robust-deviation checks provide an additional reference.
- **Short-term forecasting:** A NumPy-based multilayer perceptron (MLP) forecasts near-term changes from sequences of historical observations. It is evaluated against a last-value baseline; weaker forecasts are withheld.
- **Evidence-based summaries:** Dashboard explanations are built from measured signals, model outputs, and data-quality checks. They are not free-form generated claims.

Models require sufficient, continuous, and recent observations. Scores and forecasts are analytical indicators, not calibrated probabilities of an outage. NetGuard does not currently estimate recovery time because it lacks a sufficiently labeled historical incident dataset.

For model architecture, evaluation details, and limitations, see [AI architecture](docs/AI_ARCHITECTURE_FA.md).

## API

The FastAPI service exposes these public read endpoints:

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/health` | Process health and configuration-presence check |
| `GET` | `/api/dashboard?hours=24` | Dashboard data for the last 24 hours |
| `GET` | `/api/dashboard?hours=72` | Dashboard data for the last 72 hours |
| `GET` | `/api/dashboard?hours=168` | Dashboard data for the last 168 hours |
| `GET` | `/api/censorship` | Censorship-measurement snapshot |
| `GET` | `/api/providers/status` | Provider-status snapshot |
| `GET` | `/api/iran/datacenters` | Iranian data-center inventory |

The protected `POST /internal/collect-snapshots` endpoint is reserved for the scheduled snapshot workflow and requires the `x-netguard-token` header.

## Run locally

### Requirements

- Python
- Node.js and npm
- A Supabase project configured with the database schema, views, and Edge Functions used by NetGuard

### 1. Configure and run the API

```bash
python -m venv .venv
source .venv/bin/activate

pip install -r requirements.txt
cp .env.example .env
```

Set the required server-side values in `.env`:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`

Set `NETGUARD_COLLECTOR_TOKEN` when using the protected snapshot-generation endpoint. The optional `SUPABASE_SECRET_KEY` is only for the local IODA collection script; production collection runs through Supabase Edge Functions.

Start the API:

```bash
uvicorn app.main:app --reload
```

The API is available at `http://127.0.0.1:8000`. Interactive API documentation is available at `/docs`.

### 2. Configure and run the frontend

In a second terminal:

```bash
cd frontend
cp .env.example .env.local
npm install
npm test
npm run dev
```

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in `frontend/.env.local`. Use a publishable key only; never put a Supabase secret or service-role key in browser-visible configuration.

## Security and operations

- Row Level Security (RLS) restricts public database access to the intended read paths.
- Collector credentials and secret keys must remain server-side.
- The internal snapshot endpoint is protected by a shared token.
- The snapshot-writing RPC validates the internal token and restricts writes to the supported datasets.
- Python tests and frontend tests/build are run through GitHub Actions.
- The collection schedule is best-effort, not an availability guarantee. Free-tier infrastructure and upstream providers can affect timing.

Never commit real credentials, tokens, or populated environment files.

## Known limitations

- Measurements are currently national-level; there are no independent probes providing representative coverage across provinces and ISPs.
- National measurements must not be interpreted as city- or operator-specific results.
- OONI coverage depends on volunteer probes.
- A failed endpoint, isolated anomaly, or model score does not establish censorship or a nationwide outage.
- Global provider status is contextual information, not a measurement of reachability from Iran.
- The infrastructure inventory is not live facility monitoring.
- Forecasts and anomaly scores are signals for investigation, not definitive incident classifications.
- Data collection cadence is best-effort and may vary.

## Roadmap

The next major milestone is independent measurement coverage across multiple provinces and network operators. Geographic comparisons should only be added when real measurement vantage points are available.

Further work includes stronger incident datasets, out-of-sample model evaluation, and more advanced time-series analysis. Planned capabilities will not be presented as active features until they are implemented and supported by data.

See the [project roadmap](docs/ROADMAP_FA.md).

## Contributing

Bug reports, issues, and focused contributions are welcome. When reporting a data or measurement problem, include the affected endpoint or dataset, an approximate timestamp, and relevant source context. Please distinguish a single anomaly from a confirmed incident.

## License

NetGuard is released under the [MIT License](LICENSE).
