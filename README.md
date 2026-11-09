# NetGuard

NetGuard is a research project for monitoring and analyzing internet connectivity in Iran using public network-measurement data and deep learning.

The goal is to identify unusual network conditions—such as widespread connectivity disruptions, routing changes, and possible access restrictions—while avoiding the assumption that every failed measurement is evidence of censorship.

## Project goals

- Build a historical dataset of publicly observable internet measurements related to Iran.
- Collect new measurements periodically.
- Detect unusual changes in connectivity and routing.
- Compare independent signals to better understand network events.
- Evaluate detection results and communicate uncertainty.

## Architecture

NetGuard is organized around two services:

- **Collector:** retrieves, validates, and stores measurements from public data sources.
- **AI:** processes datasets, trains models, and detects unusual patterns.

## Data source

### IODA

The initial historical dataset is collected from [IODA (Internet Outage Detection and Analysis)](https://ioda.inetintel.cc.gatech.edu/), which provides country-level signals related to internet outages.

The initial collection focuses on Iran (country code `IR`) and uses:

- **`bgp`:** changes in visible BGP routing announcements.
- **`ping-slash24`:** active-probing observations across IPv4 /24 network blocks.
- **`merit-nt`:** observations from the Merit Network Telescope.

These signals describe different aspects of network activity. No single signal is sufficient to prove that an event was caused by filtering or censorship.

IODA API documentation: https://api.ioda.inetintel.cc.gatech.edu/v2/docs

## Repository structure

```text
NetGuard/
├── data/
│   └── raw/
│       └── ioda/
├── scripts/
│   └── download_ioda.py
├── .gitignore
└── README.md
```

The downloader saves each IODA response as a separate JSON file under `data/raw/ioda/`.

## Getting started

### Requirements

- Python 3.10 or newer
- Internet access to reach the IODA API

The historical downloader uses only Python's standard library.

### Setup

```bash
git clone https://github.com/Kian-kianmehr/NetGuard.git
cd NetGuard

python -m venv .venv
source .venv/bin/activate
```

### Download historical data

Run:

```bash
python scripts/download_ioda.py
```

The script requests data in consecutive windows of up to 31 days and saves each response under `data/raw/ioda/`. Existing files are skipped, allowing an interrupted download to be resumed by running the script again.

The default collection period is the two years preceding the time the script is run.

## Data interpretation

- IODA country-level signals are aggregate observations; they do not provide complete visibility into every ISP, city, or user.
- A failed measurement can have causes other than a national outage, including local network problems, routing changes, or destination-side failures.
- Analyses should preserve source data and timestamps and document any transformations.
- Independent signals should be compared before drawing conclusions about a network event.

## Project status

NetGuard is in its initial data-collection and validation stage. The current focus is building and inspecting the historical IODA dataset before developing the model.

## Disclaimer

NetGuard is a research project. Its outputs should be treated as measurements and analytical estimates, not definitive attribution of the cause or actor behind a network event.
