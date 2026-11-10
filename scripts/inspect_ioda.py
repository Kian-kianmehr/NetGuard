
import json
from collections import defaultdict
from pathlib import Path
from datetime import datetime, timezone

DATA_DIR = Path("data/raw/ioda")


def format_time(timestamp):
    return datetime.fromtimestamp(
        timestamp, tz=timezone.utc
    ).strftime("%Y-%m-%d %H:%M UTC")


def inspect_file(path, series):
    with path.open(encoding="utf-8") as file:
        result = json.load(file)

    for group in result.get("data", []):
        if isinstance(group, dict):
            group = [group]

        for item in group:
            if not isinstance(item, dict):
                continue

            source = item.get("datasource", "unknown")
            entity = item.get("entityCode", "unknown")
            subtype = item.get("subtype", "unknown")
            key = (source, entity, subtype)

            values = item.get("values")
            start = item.get("from")
            end = item.get("until")
            step = item.get("step")

            if not isinstance(values, list):
                print(f"INVALID VALUES: {path.name}")
                continue

            if not all(
                value is None or isinstance(value, (int, float))
                and not isinstance(value, bool)
                for value in values
            ):
                print(f"UNSUPPORTED VALUE STRUCTURE: {path.name}")
                continue

            if not all(isinstance(v, int) for v in (start, end, step)):
                print(f"INVALID TIMESTAMP METADATA: {path.name}")
                continue

            if step <= 0 or not values:
                print(f"INVALID STEP OR EMPTY VALUES: {path.name}")
                continue

            expected_end = start + (len(values) - 1) * step

            data = series[key]
            data["files"].add(path.name)

            if expected_end != end:
                data["alignment_errors"].append(
                    (path.name, end, expected_end)
                )

            for index, value in enumerate(values):
                timestamp = start + index * step
                data["points"][timestamp].append(
                    (path.name, value)
                )

            data["steps"].add(step)


def main():
    files = sorted(DATA_DIR.glob("*.json"))

    if not files:
        print("No JSON files found.")
        return

    series = defaultdict(lambda: {
        "files": set(),
        "points": defaultdict(list),
        "steps": set(),
        "alignment_errors": [],
    })

    errors = 0

    for path in files:
        try:
            inspect_file(path, series)
        except Exception as error:
            errors += 1
            print(f"ERROR: {path.name}: {error}")

    print("=" * 60)
    print("NETGUARD | IODA DATA QUALITY CHECK")
    print("=" * 60)
    print(f"Files checked: {len(files)}")
    print(f"Unreadable files: {errors}")

    for (source, entity, subtype), data in sorted(series.items()):
        points = data["points"]
        timestamps = sorted(points)
        steps = data["steps"]

        print("\n" + "=" * 60)
        print(f"SOURCE: {source}")
        print(f"ENTITY: {entity}")
        print(f"SUBTYPE: {subtype}")
        print("=" * 60)

        print(f"Files: {len(data['files'])}")
        print(f"Unique timestamps: {len(timestamps)}")
        print(f"Sampling intervals: {sorted(steps)}")
        print(f"Alignment errors: {len(data['alignment_errors'])}")

        duplicates = {
            timestamp: entries
            for timestamp, entries in points.items()
            if len(entries) > 1
        }

        identical = 0
        conflicting = 0

        for entries in duplicates.values():
            values = [entry[1] for entry in entries]

            if all(value == values[0] for value in values):
                identical += 1
            else:
                conflicting += 1

        print(f"Duplicate timestamps: {len(duplicates)}")
        print(f"Identical duplicates: {identical}")
        print(f"Conflicting duplicates: {conflicting}")

        if steps and len(steps) == 1 and timestamps:
            step = next(iter(steps))
            missing = 0
            gaps = []

            for previous, current in zip(
                timestamps, timestamps[1:]
            ):
                difference = current - previous

                if difference > step:
                    missing_points = difference // step - 1
                    missing += missing_points
                    gaps.append(
                        (previous, current, missing_points)
                    )

            print(f"Gaps: {len(gaps)}")
            print(f"Missing intervals: {missing}")

            for previous, current, count in gaps[:5]:
                print(
                    f"  GAP: {format_time(previous)} -> "
                    f"{format_time(current)} ({count} points)"
                )
        else:
            print("Gap check skipped: inconsistent sampling intervals.")

        if duplicates:
            print("\nDuplicate examples:")
            for timestamp, entries in list(duplicates.items())[:5]:
                print(f"  {format_time(timestamp)}")
                for filename, value in entries:
                    print(f"    {filename}: {value}")

        if data["alignment_errors"]:
            print("\nAlignment error examples:")
            for filename, actual, expected in data["alignment_errors"][:5]:
                print(
                    f"  {filename}: until={actual}, "
                    f"expected={expected}"
                )

    print("\n" + "=" * 60)
    print("CHECK COMPLETED")
    print("=" * 60)


if __name__ == "__main__":
    main()
