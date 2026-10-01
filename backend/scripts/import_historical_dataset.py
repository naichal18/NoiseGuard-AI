import argparse
import csv
import sys
from pathlib import Path
from datetime import datetime
from sqlalchemy import text

# Allow importing app.* when this script is executed directly.
BACKEND_DIR = Path(__file__).resolve().parents[1]

if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.core.database import SessionLocal
from app.models.noise_reading import NoiseReading
from app.models.sensor import Sensor


DEFAULT_DATASET = (
    BACKEND_DIR.parent
    / "noiseguard_historical_dataset_3months.csv"
)


def parse_args():
    parser = argparse.ArgumentParser(
        description="Import NoiseGuard historical dataset."
    )

    parser.add_argument(
        "--file",
        type=Path,
        default=DEFAULT_DATASET,
        help="Path to the historical CSV dataset.",
    )

    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Import only the first N rows.",
    )

    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate rows without inserting anything.",
    )

    return parser.parse_args()


def validate_row(row, row_number):
    required_columns = [
        "sensor_id",
        "noise_level",
        "recorded_at",
        "source",
        "event_type",
    ]

    for column in required_columns:
        if not row.get(column):
            raise ValueError(
                f"Row {row_number}: missing '{column}'"
            )

    sensor_id = int(row["sensor_id"])
    noise_level = float(row["noise_level"])

    if sensor_id <= 0:
        raise ValueError(
            f"Row {row_number}: invalid sensor_id"
        )

    if not 0 <= noise_level <= 200:
        raise ValueError(
            f"Row {row_number}: invalid noise_level"
        )

    if row["source"] != "dataset":
        raise ValueError(
            f"Row {row_number}: source must be 'dataset'"
        )

    return sensor_id, noise_level


def main():
    args = parse_args()

    dataset_path = args.file.resolve()

    if not dataset_path.exists():
        print(
            f"[ERROR] Dataset not found: {dataset_path}"
        )
        sys.exit(1)

    print("=" * 60)
    print("NOISEGUARD AI :: HISTORICAL DATA IMPORT")
    print("=" * 60)
    print(f"FILE      : {dataset_path}")
    print(f"LIMIT     : {args.limit or 'ALL'}")
    print(f"DRY RUN   : {args.dry_run}")
    print("=" * 60)

    db = SessionLocal()

    try:
        sensor_ids = {
            sensor.id
            for sensor in db.query(Sensor.id).all()
        }

        print(
            f"[INFO] Existing sensors: {len(sensor_ids)}"
        )

        inserted = 0
        skipped = 0
        processed = 0

        with dataset_path.open(
            "r",
            encoding="utf-8",
            newline="",
        ) as file:
            reader = csv.DictReader(file)

            for row_number, row in enumerate(
                reader,
                start=2,
            ):
                if (
                    args.limit is not None
                    and processed >= args.limit
                ):
                    break

                processed += 1

                sensor_id, noise_level = validate_row(
                    row,
                    row_number,
                )

                if sensor_id not in sensor_ids:
                    raise ValueError(
                        f"Row {row_number}: "
                        f"sensor_id {sensor_id} "
                        f"does not exist."
                    )

                recorded_at = datetime.fromisoformat(
                 row["recorded_at"]
                )
                source = row["source"]
                event_type = row["event_type"]

                if args.dry_run:
                    continue

                # Prevent duplicate imports using the
                # same sensor, timestamp and dataset source.
                existing = (
                    db.query(NoiseReading.id)
                    .filter(
                        NoiseReading.sensor_id
                        == sensor_id,
                        NoiseReading.recorded_at
                        == recorded_at,
                        NoiseReading.source
                        == source,
                    )
                    .first()
                )

                if existing is not None:
                    skipped += 1
                    continue

                reading = NoiseReading(
                    sensor_id=sensor_id,
                    noise_level=noise_level,
                    recorded_at=recorded_at,
                    source=source,
                    event_type=event_type,
                )

                db.add(reading)
                inserted += 1

                # Commit in batches so a large dataset
                # does not stay in one huge transaction.
                if inserted % 1000 == 0:
                    db.commit()

                    print(
                        f"[IMPORT] "
                        f"processed={processed:,} "
                        f"inserted={inserted:,} "
                        f"skipped={skipped:,}"
                    )

        if not args.dry_run:
            db.commit()

        print()
        print("=" * 60)

        if args.dry_run:
            print("[OK] DRY RUN PASSED")
            print(
                f"Rows validated: {processed:,}"
            )
        else:
            print("[OK] IMPORT COMPLETE")
            print(
                f"Rows processed : {processed:,}"
            )
            print(
                f"Rows inserted  : {inserted:,}"
            )
            print(
                f"Rows skipped   : {skipped:,}"
            )

        print("=" * 60)

    except Exception as error:
        db.rollback()

        print()
        print("[ERROR] IMPORT FAILED")
        print(f"Reason: {error}")

        sys.exit(1)

    finally:
        db.close()


if __name__ == "__main__":
    main()