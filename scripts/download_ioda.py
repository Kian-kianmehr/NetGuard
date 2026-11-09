
import json
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import urlopen

BASE_URL = "https://api.ioda.inetintel.cc.gatech.edu/v2/signals/raw/country/IR"

SOURCES = [
    "bgp",
    "ping-slash24",
    "merit-nt",
]

OUTPUT_DIR = Path("data/raw/ioda")
CHUNK_DAYS = 31
MAX_POINTS = 10000


def fetch_data(source, start, end):
    params = urlencode({
        "from": int(start.timestamp()),
        "until": int(end.timestamp()),
        "datasource": source,
        "maxPoints": MAX_POINTS,
    })

    url = f"{BASE_URL}?{params}"

    with urlopen(url, timeout=60) as response:
        result = json.load(response)

    if result.get("error"):
        raise RuntimeError(result["error"])

    return result


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    end_date = datetime.now(timezone.utc)
    start_date = end_date - timedelta(days=365 * 2)

    total_requests = 0
    successful_requests = 0

    current_start = start_date

    while current_start < end_date:
        current_end = min(
            current_start + timedelta(days=CHUNK_DAYS),
            end_date,
        )

        start_label = current_start.strftime("%Y-%m-%d")
        end_label = current_end.strftime("%Y-%m-%d")

        for source in SOURCES:
            filename = f"{source}_{start_label}_{end_label}.json"
            output_path = OUTPUT_DIR / filename

            if output_path.exists():
                print(f"Already downloaded: {filename}")
                continue

            total_requests += 1
            print(f"\nDownloading: {source} | {start_label} -> {end_label}")

            for attempt in range(1, 4):
                try:
                    result = fetch_data(
                        source,
                        current_start,
                        current_end,
                    )

                    with output_path.open("w", encoding="utf-8") as file:
                        json.dump(result, file, ensure_ascii=False)

                    series_count = len(result.get("data", []))

                    successful_requests += 1

                    print(f"Saved: {filename}")
                    print(f"Series returned: {series_count}")
                    break

                except Exception as error:
                    print(f"Attempt {attempt}/3 failed: {error}")

                    if attempt == 3:
                        print(f"Could not download: {filename}")
                    else:
                        time.sleep(attempt * 3)

            time.sleep(1)

        current_start = current_end

    print("\nDownload finished.")
    print(f"Successful requests: {successful_requests}")
    print(f"New requests attempted: {total_requests}")
    print(f"Output directory: {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
