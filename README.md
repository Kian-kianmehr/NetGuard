# NetGuard

**Internet observability for Iran.**

NetGuard is an open-source dashboard for exploring public internet measurement signals for Iran. It currently reads country-level time-series data from the [IODA API](https://ioda.inetintel.cc.gatech.edu/) operated by Georgia Tech.

> **Measurement note:** NetGuard is an independent presentation of upstream measurements, not a measurement from every Iranian ISP or end-user. A missing observation is not zero. A change in one signal alone does not prove censorship, sanctions-related blocking, or the cause of a disruption.

## MVP status

The first public MVP includes:

- A responsive dashboard with a compact, dark visual theme.
- Country-level BGP visibility, active probing, and network-telescope measurements.
- Selectable 24-hour to 7-day time windows.
- A small JSON API and health endpoint.
- Short-lived in-process caching to reduce upstream requests.
- Explicit missing-data handling and source attribution.
- A lightweight SVG identity and automated tests.

The dashboard does **not** yet provide continuous independent probes, user-specific connection tests, confirmed censorship classification, outage prediction, or a historical database maintained by NetGuard. Those require separate data collection and validation work.

## Run locally

Python 3.12 or newer is recommended.

```bash
git clone https://github.com/Kian-kianmehr/NetGuard.git
cd NetGuard
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Open http://127.0.0.1:8000.

## API

- `GET /api/health` — service health.
- `GET /api/dashboard?hours=24` — normalized IODA observations.
- Supported windows: 6–168 hours.

Optional environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `IODA_BASE_URL` | IODA API v2 | Upstream API base URL |
| `NETGUARD_COUNTRY_CODE` | `IR` | ISO country code |
| `CACHE_TTL_SECONDS` | `90` | In-process response cache |

## Tests

```bash
pytest -q
```

## Free deployment

A Render Blueprint is included in `render.yaml`. Connect the repository to Render and deploy the Blueprint to create a free web service with a `.onrender.com` address.

Render's free web services may sleep after inactivity. The dashboard fetches upstream measurements when requested; this MVP does not run an always-on collector. Availability and free-plan limits are controlled by the hosting provider.

## Data and attribution

Measurements are provided by IODA, Georgia Tech. NetGuard is not affiliated with or endorsed by IODA or Georgia Tech.

- [IODA project](https://ioda.inetintel.cc.gatech.edu/)
- [IODA API documentation](https://api.ioda.inetintel.cc.gatech.edu/v2/docs)

## License

MIT
