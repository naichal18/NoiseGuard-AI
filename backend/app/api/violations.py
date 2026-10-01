from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import desc, func
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.noise_reading import NoiseReading
from app.models.sensor import Sensor
from app.services.runtime_settings import get_runtime_settings


router = APIRouter(prefix="/api/violations", tags=["Violations"])


# ---------------------------------------------------------------------------
# NoiseGuard violation rules
# ---------------------------------------------------------------------------
#
# These are the residential-area ambient noise limits used by this module.
# Day:   06:00 - 22:00 -> 55 dB
# Night: 22:00 - 06:00 -> 45 dB
#
# The timestamp is explicitly converted to Asia/Kolkata before deciding
# whether a reading belongs to the day or night window. Database timestamps
# are normally stored in UTC.
#
# Source: CPCB / Noise Pollution (Regulation and Control) Rules, 2000.
# ---------------------------------------------------------------------------

DEFAULT_TIMEZONE = "Asia/Kolkata"
DEFAULT_DAY_LIMIT_DB = 55.0
DEFAULT_NIGHT_LIMIT_DB = 45.0

DAY_START_HOUR = 6
NIGHT_START_HOUR = 22

MAX_LIST_LIMIT = 500

# Readings from the same sensor/source are considered part of one incident
# while they remain above the applicable limit and the gap between consecutive
# violating readings does not exceed this value.
INCIDENT_GAP_MINUTES = 10.0


# ---------------------------------------------------------------------------
# TIME / RULE HELPERS
# ---------------------------------------------------------------------------

def _as_local(
    recorded_at: datetime | None,
    timezone_name: str,
) -> datetime | None:
    """Return an aware timestamp represented in the configured timezone."""
    if recorded_at is None:
        return None

    if recorded_at.tzinfo is None:
        recorded_at = recorded_at.replace(tzinfo=timezone.utc)

    try:
        zone = ZoneInfo(timezone_name)
    except Exception:
        zone = ZoneInfo(DEFAULT_TIMEZONE)

    return recorded_at.astimezone(zone)


def _allowed_limit(
    recorded_at: datetime | None,
    *,
    timezone_name: str,
    day_limit_db: float,
    night_limit_db: float,
) -> tuple[float, str]:
    """Return (limit_db, DAY/NIGHT) using the configured local timezone."""
    local_time = _as_local(recorded_at, timezone_name)

    if local_time is None:
        return day_limit_db, "DAY"

    hour = local_time.hour

    if DAY_START_HOUR <= hour < NIGHT_START_HOUR:
        return day_limit_db, "DAY"

    return night_limit_db, "NIGHT"


def _severity(measured_db: float, allowed_db: float) -> str:
    """
    Severity is based on how far the measured level exceeds the applicable
    code limit.

    MODERATE: any breach
    HIGH:     >= 15 dB above limit
    CRITICAL: >= 30 dB above limit
    """
    excess = measured_db - allowed_db

    if excess >= 30.0:
        return "CRITICAL"

    if excess >= 15.0:
        return "HIGH"

    return "MODERATE"


def _base_violation_query(
    db: Session,
    start_time: datetime,
    source: str,
    sensor_id: int | None,
    end_time: datetime | None = None,
    *,
    night_limit_db: float = DEFAULT_NIGHT_LIMIT_DB,
):
    """
    Fetch possible violations.

    We intentionally use the night limit (45 dB) as the SQL lower bound,
    because a 45-55 dB reading can be a violation at night but not during
    the day. The exact applicable limit is checked in Python after converting
    timestamps to IST.
    """
    query = (
        db.query(NoiseReading, Sensor)
        .join(Sensor, Sensor.id == NoiseReading.sensor_id)
        .filter(
            NoiseReading.recorded_at >= start_time,
            NoiseReading.noise_level > night_limit_db,
        )
    )

    if end_time is not None:
        query = query.filter(NoiseReading.recorded_at <= end_time)

    if source != "all":
        query = query.filter(NoiseReading.source == source)

    if sensor_id is not None:
        query = query.filter(NoiseReading.sensor_id == sensor_id)

    return query


def _violation_row(
    reading: NoiseReading,
    sensor: Sensor,
    *,
    timezone_name: str,
    day_limit_db: float,
    night_limit_db: float,
) -> dict[str, Any] | None:
    """Convert a reading into a violation record using runtime settings."""
    measured_db = float(reading.noise_level)
    allowed_db, period = _allowed_limit(
        reading.recorded_at,
        timezone_name=timezone_name,
        day_limit_db=day_limit_db,
        night_limit_db=night_limit_db,
    )
    excess_db = measured_db - allowed_db

    if excess_db <= 0:
        return None

    return {
        "id": reading.id,
        "sensor_id": reading.sensor_id,
        "sensor_code": sensor.sensor_code,
        "sensor_name": sensor.name,
        "location": sensor.location,
        "measured_db": round(measured_db, 1),
        "allowed_db": round(allowed_db, 1),
        "excess_db": round(excess_db, 1),
        "severity": _severity(measured_db, allowed_db),
        "period": period,
        "observed_at": (
            reading.recorded_at.isoformat()
            if reading.recorded_at
            else None
        ),
        "source": str(reading.source),
        "event_type": str(reading.event_type),
    }


# ---------------------------------------------------------------------------
# INCIDENT GROUPING
# ---------------------------------------------------------------------------

def _incident_severity(rows: list[dict[str, Any]]) -> str:
    severities = {row["severity"] for row in rows}

    if "CRITICAL" in severities:
        return "CRITICAL"

    if "HIGH" in severities:
        return "HIGH"

    return "MODERATE"


def _group_readings_into_incidents(
    rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """
    Convert individual violating readings into continuous violation incidents.

    Grouping key:
      sensor + source + period

    A new incident begins when the gap between consecutive violating readings
    exceeds INCIDENT_GAP_MINUTES.

    This prevents a 5-minute dataset stream from turning one continuous noise
    event into dozens of separate "violations".
    """
    grouped: dict[tuple[int, str, str], list[dict[str, Any]]] = defaultdict(list)

    for row in rows:
        grouped[
            (
                int(row["sensor_id"]),
                str(row["source"]),
                str(row["period"]),
            )
        ].append(row)

    incidents: list[dict[str, Any]] = []

    for (sensor_id, source, period), sensor_rows in grouped.items():
        sensor_rows.sort(key=lambda item: item["observed_at"] or "")

        current: list[dict[str, Any]] = []

        def flush() -> None:
            if not current:
                return

            first = current[0]
            last = current[-1]

            timestamps = [
                datetime.fromisoformat(row["observed_at"])
                for row in current
                if row.get("observed_at")
            ]

            start_at = min(timestamps) if timestamps else None
            end_at = max(timestamps) if timestamps else None

            duration_minutes = (
                max(
                    0.0,
                    (end_at - start_at).total_seconds() / 60.0,
                )
                if start_at and end_at
                else 0.0
            )

            peak_row = max(
                current,
                key=lambda row: (
                    float(row["measured_db"]),
                    float(row["excess_db"]),
                ),
            )

            average_db = sum(
                float(row["measured_db"]) for row in current
            ) / len(current)

            incident_id = (
                f"{sensor_id}:{source}:"
                f"{start_at.isoformat() if start_at else first['id']}"
            )

            incident = {
                "id": first["id"],
                "incident_id": incident_id,
                "sensor_id": sensor_id,
                "sensor_code": first["sensor_code"],
                "sensor_name": first["sensor_name"],
                "location": first["location"],
                "measured_db": round(float(peak_row["measured_db"]), 1),
                "peak_db": round(float(peak_row["measured_db"]), 1),
                "average_db": round(average_db, 1),
                "allowed_db": round(float(peak_row["allowed_db"]), 1),
                "excess_db": round(float(peak_row["excess_db"]), 1),
                "severity": _incident_severity(current),
                "period": period,
                "observed_at": (
                    first["observed_at"]
                    if first.get("observed_at")
                    else None
                ),
                "start_at": (
                    start_at.isoformat() if start_at else None
                ),
                "end_at": (
                    end_at.isoformat() if end_at else None
                ),
                "duration_minutes": round(duration_minutes, 1),
                "reading_count": len(current),
                "source": source,
                "event_type": peak_row["event_type"],
            }

            incidents.append(incident)

        for row in sensor_rows:
            if not current:
                current = [row]
                continue

            previous_timestamp = current[-1].get("observed_at")
            current_timestamp = row.get("observed_at")

            gap_minutes = float("inf")

            if previous_timestamp and current_timestamp:
                previous_dt = datetime.fromisoformat(previous_timestamp)
                current_dt = datetime.fromisoformat(current_timestamp)
                gap_minutes = (
                    current_dt - previous_dt
                ).total_seconds() / 60.0

            if gap_minutes <= INCIDENT_GAP_MINUTES:
                current.append(row)
            else:
                flush()
                current = [row]

        flush()

    incidents.sort(
        key=lambda item: (
            item["start_at"] or "",
            item["peak_db"],
        ),
        reverse=True,
    )

    return incidents


def _analysis_end_for_source(
    db: Session,
    source: str,
) -> datetime:
    """
    Return the correct end of the analysis timeline.

    Live sources are anchored to the current UTC time.
    The historical dataset is anchored to its own latest reading so that
    a request such as "last 24 hours" does not look beyond the dataset.
    """
    now = datetime.now(timezone.utc)

    if source != "dataset":
        return now

    dataset_latest = (
        db.query(func.max(NoiseReading.recorded_at))
        .filter(NoiseReading.source == "dataset")
        .scalar()
    )

    if dataset_latest is None:
        return now

    if dataset_latest.tzinfo is None:
        dataset_latest = dataset_latest.replace(tzinfo=timezone.utc)

    return dataset_latest.astimezone(timezone.utc)


def _load_violation_incidents(
    db: Session,
    *,
    hours: int,
    source: str,
    sensor_id: int | None,
    end_time: datetime | None = None,
) -> list[dict[str, Any]]:
    """
    Load incidents using a source-aware timeline and runtime compliance rules.

    The end_time argument is optional so Reports can explicitly anchor a
    historical source window without changing the public API behaviour.
    """
    settings = get_runtime_settings(db)
    timezone_name = str(settings.get("timezone") or DEFAULT_TIMEZONE)
    day_limit_db = float(settings.get("day_limit_db", DEFAULT_DAY_LIMIT_DB))
    night_limit_db = float(settings.get("night_limit_db", DEFAULT_NIGHT_LIMIT_DB))

    sources: list[str]

    if source == "all":
        source_rows = (
            db.query(NoiseReading.source)
            .filter(NoiseReading.source.isnot(None))
            .distinct()
            .all()
        )
        sources = sorted({str(row[0]) for row in source_rows if row[0]})
        if not sources:
            sources = ["all"]
    else:
        sources = [source]

    all_incidents: list[dict[str, Any]] = []

    for source_name in sources:
        if end_time is not None:
            analysis_end = end_time
        else:
            analysis_end = _analysis_end_for_source(db, source_name)

        start_time = analysis_end - timedelta(hours=hours)

        rows = (
            _base_violation_query(
                db,
                start_time,
                source_name,
                sensor_id,
                analysis_end,
                night_limit_db=night_limit_db,
            )
            .order_by(NoiseReading.recorded_at.asc())
            .all()
        )

        violation_rows: list[dict[str, Any]] = []

        for reading, sensor in rows:
            row = _violation_row(
                reading,
                sensor,
                timezone_name=timezone_name,
                day_limit_db=day_limit_db,
                night_limit_db=night_limit_db,
            )
            if row is not None:
                violation_rows.append(row)

        all_incidents.extend(_group_readings_into_incidents(violation_rows))

    all_incidents.sort(
        key=lambda item: (
            item["start_at"] or "",
            float(item["peak_db"]),
        ),
        reverse=True,
    )

    return all_incidents


# ---------------------------------------------------------------------------
# LIST
# ---------------------------------------------------------------------------

@router.get("")
def list_violations(
    hours: int = Query(24, ge=1, le=720),
    source: str = Query(
        "all",
        pattern=r"^(all|dataset|simulator|api|sensor)$",
    ),
    sensor_id: int | None = Query(None, gt=0),
    severity: str = Query(
        "all",
        pattern=r"^(all|CRITICAL|HIGH|MODERATE)$",
    ),
    period: str = Query(
        "all",
        pattern=r"^(all|DAY|NIGHT)$",
    ),
    min_excess_db: float = Query(0.0, ge=0, le=200),
    limit: int = Query(100, ge=1, le=MAX_LIST_LIMIT),
    db: Session = Depends(get_db),
):
    incidents = _load_violation_incidents(
        db,
        hours=hours,
        source=source,
        sensor_id=sensor_id,
    )

    filtered: list[dict[str, Any]] = []

    for incident in incidents:
        if incident["excess_db"] < min_excess_db:
            continue

        if severity != "all" and incident["severity"] != severity:
            continue

        if period != "all" and incident["period"] != period:
            continue

        filtered.append(incident)

        if len(filtered) >= limit:
            break

    now = datetime.now(timezone.utc)
    settings = get_runtime_settings(db)
    timezone_name = str(settings.get("timezone") or DEFAULT_TIMEZONE)
    day_limit_db = float(settings.get("day_limit_db", DEFAULT_DAY_LIMIT_DB))
    night_limit_db = float(settings.get("night_limit_db", DEFAULT_NIGHT_LIMIT_DB))

    period_meta: dict[str, Any] = {
        "hours": hours,
        "timeline": "source_aware",
    }

    if source == "dataset":
        analysis_end = _analysis_end_for_source(db, "dataset")
        period_meta.update({
            "start": (analysis_end - timedelta(hours=hours)).isoformat(),
            "end": analysis_end.isoformat(),
            "source_timeline": "historical_dataset",
        })
    else:
        period_meta.update({
            "start": (now - timedelta(hours=hours)).isoformat(),
            "end": now.isoformat(),
            "source_timeline": "live" if source != "all" else "mixed",
        })

    return {
        "period": period_meta,
        "filters": {
            "source": source,
            "sensor_id": sensor_id,
            "severity": severity,
            "period": period,
            "min_excess_db": min_excess_db,
        },
        "count": len(filtered),
        "total_incidents": len(incidents),
        "violations": filtered,
    }


# ---------------------------------------------------------------------------
# SUMMARY
# ---------------------------------------------------------------------------

@router.get("/summary")
def violations_summary(
    hours: int = Query(24, ge=1, le=720),
    source: str = Query(
        "all",
        pattern=r"^(all|dataset|simulator|api|sensor)$",
    ),
    db: Session = Depends(get_db),
):
    incidents = _load_violation_incidents(
        db,
        hours=hours,
        source=source,
        sensor_id=None,
    )

    counts = {
        "total": len(incidents),
        "moderate": 0,
        "high": 0,
        "critical": 0,
        "day": 0,
        "night": 0,
    }

    sensor_buckets: dict[int, dict[str, Any]] = {}
    peak_violation: dict[str, Any] | None = None

    for incident in incidents:
        severity_key = str(incident["severity"]).lower()
        period_key = str(incident["period"]).lower()

        counts[severity_key] += 1
        counts[period_key] += 1

        sensor_id = int(incident["sensor_id"])

        bucket = sensor_buckets.setdefault(
            sensor_id,
            {
                "sensor_id": sensor_id,
                "sensor_code": incident["sensor_code"],
                "sensor_name": incident["sensor_name"],
                "location": incident["location"],
                "violation_count": 0,
                "peak_db": 0.0,
                "max_excess_db": 0.0,
                "critical_count": 0,
                "high_count": 0,
                "moderate_count": 0,
            },
        )

        bucket["violation_count"] += 1
        bucket["peak_db"] = max(
            bucket["peak_db"],
            float(incident["peak_db"]),
        )
        bucket["max_excess_db"] = max(
            bucket["max_excess_db"],
            float(incident["excess_db"]),
        )

        bucket[
            f"{str(incident['severity']).lower()}_count"
        ] += 1

        if (
            peak_violation is None
            or float(incident["peak_db"])
            > float(peak_violation["peak_db"])
        ):
            peak_violation = incident

    top_sensors = sorted(
        sensor_buckets.values(),
        key=lambda item: (
            item["violation_count"],
            item["max_excess_db"],
            item["peak_db"],
        ),
        reverse=True,
    )[:10]

    now = datetime.now(timezone.utc)
    settings = get_runtime_settings(db)
    timezone_name = str(settings.get("timezone") or DEFAULT_TIMEZONE)
    day_limit_db = float(settings.get("day_limit_db", DEFAULT_DAY_LIMIT_DB))
    night_limit_db = float(settings.get("night_limit_db", DEFAULT_NIGHT_LIMIT_DB))

    period_meta: dict[str, Any] = {
        "hours": hours,
        "timeline": "source_aware",
    }

    if source == "dataset":
        analysis_end = _analysis_end_for_source(db, "dataset")
        period_meta.update({
            "start": (analysis_end - timedelta(hours=hours)).isoformat(),
            "end": analysis_end.isoformat(),
            "source_timeline": "historical_dataset",
        })
    else:
        period_meta.update({
            "start": (now - timedelta(hours=hours)).isoformat(),
            "end": now.isoformat(),
            "source_timeline": "live" if source != "all" else "mixed",
        })

    return {
        "period": period_meta,
        "source": source,
        "timezone": timezone_name,
        "count_mode": "INCIDENTS",
        "limits": {
            "day_db": day_limit_db,
            "night_db": night_limit_db,
            "day_window": "06:00-22:00 IST",
            "night_window": "22:00-06:00 IST",
            "area_category": "RESIDENTIAL",
        },
        "incident_grouping": {
            "max_gap_minutes": INCIDENT_GAP_MINUTES,
            "description": (
                "Consecutive above-limit readings from the same "
                "sensor/source/period are grouped into one incident."
            ),
        },
        "counts": counts,
        "top_sensors": top_sensors,
        "peak_violation": peak_violation,
    }


# ---------------------------------------------------------------------------
# DETAIL
# ---------------------------------------------------------------------------

@router.get("/{violation_id}")
def get_violation(
    violation_id: int,
    db: Session = Depends(get_db),
):
    result = (
        db.query(NoiseReading, Sensor)
        .join(
            Sensor,
            Sensor.id == NoiseReading.sensor_id,
        )
        .filter(
            NoiseReading.id == violation_id
        )
        .first()
    )

    if not result:
        raise HTTPException(
            status_code=404,
            detail="Violation reading not found",
        )

    reading, sensor = result

    settings = get_runtime_settings(db)
    timezone_name = str(settings.get("timezone") or DEFAULT_TIMEZONE)
    day_limit_db = float(settings.get("day_limit_db", DEFAULT_DAY_LIMIT_DB))
    night_limit_db = float(settings.get("night_limit_db", DEFAULT_NIGHT_LIMIT_DB))

    row = _violation_row(
        reading,
        sensor,
        timezone_name=timezone_name,
        day_limit_db=day_limit_db,
        night_limit_db=night_limit_db,
    )

    if row is None:
        raise HTTPException(
            status_code=404,
            detail="This reading is not a code violation",
        )

    return {
        **row,
        "timezone": timezone_name,
        "rule_basis": {
            "area_category": "RESIDENTIAL",
            "day_limit_db": day_limit_db,
            "night_limit_db": night_limit_db,
            "day_window": "06:00-22:00 IST",
            "night_window": "22:00-06:00 IST",
        },
    }
