
import json
import math
import statistics
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

DATA_DIR = Path("data/raw/ioda")


def percentile(values, percent):
    values = sorted(values)

    if not values:
        return None

    position = (len(values) - 1) * percent
    lower = math.floor(position)
    upper = math.ceil(position)

    if lower == upper:
        return values[lower]

    return (
        values[lower] * (upper - position)
        + values[upper] * (position - lower)
    )


def load_data():
    series = defaultdict(dict)

    for path in sorted(DATA_DIR.glob("*.json")):
        with path.open(encoding="utf-8") as file:
            result = json.load(file)

        for group in result.get("data", []):
            if isinstance(group, dict):
                group = [group]

            for item in group:
                if not isinstance(item, dict):
                    continue

                source = item.get("datasource")
                values = item.get("values")
                start = item.get("from")
                step = item.get("step")

                if (
                    source not in {"bgp", "merit-nt", "ping-slash24"}
                    or not isinstance(values, list)
                    or not isinstance(start, int)
                    or not isinstance(step, int)
                    or step <= 0
                ):
                    continue

                for index, value in enumerate(values):
                    if value is None:
                        continue

                    if (
                        isinstance(value, bool)
                        or not isinstance(value, (int, float))
                        or not math.isfinite(value)
                    ):
                        continue

                    timestamp = start + index * step

                    if timestamp in series[source]:
                        if series[source][timestamp] != value:
                            print(
                                f"CONFLICT: {source} "
                                f"{datetime.fromtimestamp(timestamp, timezone.utc)}"
                            )
                        continue

                    series[source][timestamp] = value

    return series


def daily_statistics(points):
    daily = defaultdict(list)

    for timestamp, value in points.items():
        day = datetime.fromtimestamp(
            timestamp, timezone.utc
        ).date().isoformat()

        daily[day].append(value)

    result = {}

    for day, values in sorted(daily.items()):
        result[day] = {
            "count": len(values),
            "mean": statistics.mean(values),
            "median": statistics.median(values),
            "min": min(values),
            "max": max(values),
            "zeros": sum(value == 0 for value in values),
        }

    return result


def correlation(first, second):
    common = sorted(set(first) & set(second))

    if len(common) < 2:
        return None

    x = [first[day]["mean"] for day in common]
    y = [second[day]["mean"] for day in common]

    if statistics.stdev(x) == 0 or statistics.stdev(y) == 0:
        return None

    return statistics.correlation(x, y)


def analyze_source(source, points):
    values = list(points.values())
    daily = daily_statistics(points)

    print("\n" + "=" * 60)
    print(f"SOURCE: {source}")
    print("=" * 60)

    print(f"Unique points: {len(values)}")
    print(f"Days: {len(daily)}")
    print(f"Minimum: {min(values):.2f}")
    print(f"Maximum: {max(values):.2f}")
    print(f"Mean: {statistics.mean(values):.2f}")
    print(f"Median: {statistics.median(values):.2f}")
    print(f"P05: {percentile(values, 0.05):.2f}")
    print(f"P25: {percentile(values, 0.25):.2f}")
    print(f"P75: {percentile(values, 0.75):.2f}")
    print(f"P95: {percentile(values, 0.95):.2f}")
    print(f"Zero values: {sum(value == 0 for value in values)}")

    declines = []

    days = sorted(daily)

    for previous_day, current_day in zip(days, days[1:]):
        previous = daily[previous_day]["mean"]
        current = daily[current_day]["mean"]

        if previous > 0:
            change = ((current - previous) / previous) * 100

            if change < 0:
                declines.append(
                    (change, previous_day, current_day, previous, current)
                )

    print("\nLargest daily mean declines:")

    for change, previous_day, current_day, previous, current in sorted(declines)[:10]:
        print(
            f"  {previous_day} -> {current_day}: "
            f"{change:.2f}% ({previous:.2f} -> {current:.2f})"
        )

    return daily


def main():
    series = load_data()

    print("=" * 60)
    print("NETGUARD | IODA STATISTICAL ANALYSIS")
    print("=" * 60)

    daily = {}

    for source in sorted(series):
        if series[source]:
            daily[source] = analyze_source(source, series[source])

    print("\n" + "=" * 60)
    print("DAILY CORRELATIONS")
    print("=" * 60)

    sources = sorted(daily)

    for index, first in enumerate(sources):
        for second in sources[index + 1:]:
            value = correlation(daily[first], daily[second])

            if value is None:
                print(f"{first} vs {second}: insufficient variation")
            else:
                print(f"{first} vs {second}: {value:.4f}")

    print("\nANALYSIS COMPLETED")


if __name__ == "__main__":
    main()
