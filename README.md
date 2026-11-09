# NetGuard

NetGuard is an early-stage research project for monitoring and analyzing internet connectivity conditions in Iran using public network-measurement data and machine learning.

The project aims to distinguish different types of network anomalies—such as broad connectivity disruptions, routing changes, and possible access restrictions—rather than treating every failed measurement as evidence of censorship.

> **Status:** Early development. Data collection and validation come before model development.

## Project goals

- Build a historical dataset of publicly observable internet measurements related to Iran.
- Collect new measurements periodically and preserve their timestamps and source metadata.
- Detect unusual changes in network connectivity and routing.
- Compare independent signals before assigning an interpretation to an event.
- Evaluate detection quality and communicate uncertainty.

## Planned architecture

The project is organized around two logical services:

- **Collector:** retrieves, validates, and stores measurements from public data sources.
- **AI:** prepares datasets, trains models, and detects unusual patterns.

The initial work focuses on historical data collection. Live monitoring and model development will follow after the data format and quality have been validated.

## Initial data source

### IODA

The first historical data source is [IODA (Internet Outage Detection and Analysis)](https://ioda.inetintel.cc.gatech.edu/), which publishes country-level signals related to internet outages.

The initial collection uses these signals for Iran (country code `IR`):

- `bgp`: changes in visible BGP routing announcements.
- `ping-slash24`: active-probing observations across IPv4 /24 network blocks.
- `merit-nt`: observations from the Merit Network Telescope.

These signals describe different aspects of network activity. None of them, by itself, proves that a disruption was caused by filtering or censorship.

IODA API documentation: https://api.ioda.inetintel.cc.gatech.edu/v2/docs

## Repository layout

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

Downloaded datasets are intentionally excluded from Git. The repository contains the code and instructions needed to reproduce the collection, not copies of the raw data.

## Getting started

### Requirements

- Python 3.10 or newer
- Internet access to reach the IODA API

The historical downloader uses only Python's standard library.

### Setup

Clone the repository and create a virtual environment:

```bash
git clone https://github.com/Kian-kianmehr/NetGuard.git
cd NetGuard

python -m venv .venv
source .venv/bin/activate
```

### Download historical IODA data

Run:

```bash
python scripts/download_ioda.py
```

The downloader requests data in consecutive windows of up to 31 days and saves each response as a separate JSON file under `data/raw/ioda/`. Existing files are skipped, so an interrupted download can be resumed by running the command again.

The current default range is the two years preceding the time the script is run.

## Data and interpretation notes

- IODA country-level signals are aggregate observations; they do not provide complete visibility into every ISP, city, or user.
- A single failed probe can have causes other than a national outage, including local network problems, routing changes, or destination-side failures.
- Analyses should preserve the original source data and timestamps, document transformations, and combine independent signals where possible.
- Raw data files are not committed to this repository.

## Development roadmap

- [x] Establish the repository and initial project documentation.
- [ ] Collect and validate two years of historical IODA data.
- [ ] Inspect signal coverage, missing values, and sampling intervals.
- [ ] Build a reproducible data-normalization pipeline.
- [ ] Design and evaluate baseline anomaly-detection methods.
- [ ] Add periodic live collection.
- [ ] Develop and evaluate deep-learning models.

## Disclaimer

NetGuard is a research project. Its outputs should be treated as measurements and analytical estimates, not definitive attribution of the cause or actor behind a network event.
