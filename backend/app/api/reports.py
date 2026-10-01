from __future__ import annotations

import csv
import io
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.api.violations import _load_violation_incidents
from app.models.noise_reading import NoiseReading
from app.services.anomaly_detector import get_anomaly_analysis


router = APIRouter(prefix="/api/reports", tags=["Reports"])

SOURCE_PATTERN = r"^(all|dataset|simulator|api|sensor)$"
PERIOD_PATTERN = r"^(all|DAY|NIGHT)$"
SEVERITY_PATTERN = r"^(all|MODERATE|HIGH|CRITICAL)$"

# Historical dataset timestamps end before the live simulator timeline.
# Reports therefore use an independent analysis window for every source.
HISTORICAL_SOURCES = {"dataset"}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _get_latest_source_timestamp(
    db: Session,
    *,
    source: str,
    sensor_id: int | None,
) -> datetime | None:
    query = db.query(func.max(NoiseReading.recorded_at)).filter(
        NoiseReading.source == source
    )

    if sensor_id is not None:
        query = query.filter(NoiseReading.sensor_id == sensor_id)

    return _as_utc(query.scalar())


def _get_report_sources(
    db: Session,
    *,
    sensor_id: int | None,
) -> list[str]:
    query = db.query(NoiseReading.source).distinct()

    if sensor_id is not None:
        query = query.filter(NoiseReading.sensor_id == sensor_id)

    sources = {
        str(row[0])
        for row in query.all()
        if row[0] is not None
    }

    # Keep a stable order so API responses are deterministic.
    preferred_order = ["dataset", "simulator", "api", "sensor"]

    return [
        source
        for source in preferred_order
        if source in sources
    ]


def _source_analysis_end(
    db: Session,
    *,
    source: str,
    sensor_id: int | None,
    now: datetime,
) -> datetime | None:
    latest = _get_latest_source_timestamp(
        db,
        source=source,
        sensor_id=sensor_id,
    )

    if latest is None:
        return None

    if source in HISTORICAL_SOURCES:
        return latest

    # Live/API/sensor streams are evaluated against their newest actual
    # reading, but never beyond the current UTC time.
    return min(latest, now)


def _load_report_incidents(
    db: Session,
    *,
    hours: int,
    source: str,
    sensor_id: int | None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """
    Load report incidents with source-aware timelines.

    DATASET:
        Uses the dataset's own latest recorded_at as the report end.

    SIMULATOR/API/SENSOR:
        Uses the latest available reading, capped at current UTC time.

    ALL:
        Loads each available source independently, then combines the
        resulting incidents. This prevents the historical dataset from
        disappearing merely because live simulator readings are newer.
    """
    now = _now()
    incidents: list[dict[str, Any]] = []
    source_windows: list[dict[str, Any]] = []

    if source != "all":
        analysis_end = _source_analysis_end(
            db,
            source=source,
            sensor_id=sensor_id,
            now=now,
        )

        if analysis_end is None:
            return [], []

        analysis_start = analysis_end - timedelta(hours=hours)

        source_incidents = _load_violation_incidents(
            db,
            hours=hours,
            source=source,
            sensor_id=sensor_id,
            end_time=analysis_end,
        )

        source_windows.append(
            {
                "source": source,
                "start": analysis_start.isoformat(),
                "end": analysis_end.isoformat(),
                "timeline": (
                    "HISTORICAL"
                    if source in HISTORICAL_SOURCES
                    else "LIVE"
                ),
            }
        )

        return source_incidents, source_windows

    for source_name in _get_report_sources(
        db,
        sensor_id=sensor_id,
    ):
        analysis_end = _source_analysis_end(
            db,
            source=source_name,
            sensor_id=sensor_id,
            now=now,
        )

        if analysis_end is None:
            continue

        analysis_start = analysis_end - timedelta(hours=hours)

        source_incidents = _load_violation_incidents(
            db,
            hours=hours,
            source=source_name,
            sensor_id=sensor_id,
            end_time=analysis_end,
        )

        incidents.extend(source_incidents)

        source_windows.append(
            {
                "source": source_name,
                "start": analysis_start.isoformat(),
                "end": analysis_end.isoformat(),
                "timeline": (
                    "HISTORICAL"
                    if source_name in HISTORICAL_SOURCES
                    else "LIVE"
                ),
            }
        )

    incidents.sort(
        key=lambda item: (
            item.get("start_at") or "",
            item.get("peak_db") or 0,
        ),
        reverse=True,
    )

    return incidents, source_windows


def _filter_incidents(
    incidents: list[dict[str, Any]],
    *,
    period: str,
    severity: str,
    sensor_id: int | None,
) -> list[dict[str, Any]]:
    filtered: list[dict[str, Any]] = []

    for incident in incidents:
        if period != "all" and incident["period"] != period:
            continue

        if severity != "all" and incident["severity"] != severity:
            continue

        if sensor_id is not None and incident["sensor_id"] != sensor_id:
            continue

        filtered.append(incident)

    return filtered


def _build_report(
    db: Session,
    *,
    hours: int,
    source: str,
    period: str,
    severity: str,
    sensor_id: int | None,
) -> dict[str, Any]:
    generated_at = _now()

    incidents, source_windows = _load_report_incidents(
        db,
        hours=hours,
        source=source,
        sensor_id=sensor_id,
    )

    incidents = _filter_incidents(
        incidents,
        period=period,
        severity=severity,
        sensor_id=sensor_id,
    )

    severity_counts = Counter(
        str(item["severity"]) for item in incidents
    )
    period_counts = Counter(
        str(item["period"]) for item in incidents
    )
    source_counts = Counter(
        str(item["source"]) for item in incidents
    )
    event_counts = Counter(
        str(item["event_type"]) for item in incidents
    )

    sensor_buckets: dict[int, dict[str, Any]] = {}

    for incident in incidents:
        bucket = sensor_buckets.setdefault(
            int(incident["sensor_id"]),
            {
                "sensor_id": incident["sensor_id"],
                "sensor_code": incident["sensor_code"],
                "sensor_name": incident["sensor_name"],
                "location": incident["location"],
                "incident_count": 0,
                "critical_count": 0,
                "high_count": 0,
                "moderate_count": 0,
                "peak_db": 0.0,
                "max_excess_db": 0.0,
            },
        )

        bucket["incident_count"] += 1
        bucket["peak_db"] = max(
            bucket["peak_db"],
            float(incident["peak_db"]),
        )
        bucket["max_excess_db"] = max(
            bucket["max_excess_db"],
            float(incident["excess_db"]),
        )
        bucket[f"{incident['severity'].lower()}_count"] += 1

    top_sensors = sorted(
        sensor_buckets.values(),
        key=lambda item: (
            item["incident_count"],
            item["max_excess_db"],
            item["peak_db"],
        ),
        reverse=True,
    )

    peak_incident = (
        max(
            incidents,
            key=lambda item: (
                float(item["peak_db"]),
                float(item["excess_db"]),
            ),
        )
        if incidents
        else None
    )

    total_duration = sum(
        float(item.get("duration_minutes") or 0)
        for item in incidents
    )

    average_peak = (
        sum(float(item["peak_db"]) for item in incidents)
        / len(incidents)
        if incidents
        else 0.0
    )

    # Keep the legacy window fields for frontend compatibility.
    # For ALL SOURCES the fields describe the complete source-aware coverage,
    # while source_windows contains the exact independent timeline per source.
    if source_windows:
        coverage_start = min(
            item["start"] for item in source_windows
        )
        coverage_end = max(
            item["end"] for item in source_windows
        )
    else:
        coverage_start = generated_at.isoformat()
        coverage_end = generated_at.isoformat()

    # AI anomaly context comes from the same backend/database and uses the
    # source-aware anomaly detector. This is intentionally independent from
    # the violation incident loader so historical and live AI timelines stay
    # consistent with the selected source.
    ai_context: dict[str, Any] = {
        "available": False,
        "anomaly_count": 0,
        "critical_count": 0,
        "high_count": 0,
        "events": [],
        "error": None,
    }

    try:
        anomaly_payload = get_anomaly_analysis(
            db,
            hours=hours,
            baseline_hours=24,
            limit=20,
            sensor_id=sensor_id,
            source=source,
        )

        anomaly_events = anomaly_payload.get("anomalies", [])

        if severity != "all":
            anomaly_events = [
                event
                for event in anomaly_events
                if event.get("severity") == severity
            ]

        ai_context = {
            "available": True,
            "anomaly_count": len(anomaly_events),
            "critical_count": sum(
                event.get("severity") == "CRITICAL"
                for event in anomaly_events
            ),
            "high_count": sum(
                event.get("severity") == "HIGH"
                for event in anomaly_events
            ),
            "events": anomaly_events[:20],
            "analysis_windows": anomaly_payload.get(
                "analysis_windows"
            ),
        }
    except Exception as exc:
        ai_context["error"] = str(exc)

    return {
        "report": {
            "title": "NoiseGuard AI Noise Compliance Report",
            "generated_at": generated_at.isoformat(),
            "timezone": "Asia/Kolkata",
            "window": {
                "hours": hours,
                "start": coverage_start,
                "end": coverage_end,
            },
            "source_windows": source_windows,
            "filters": {
                "source": source,
                "sensor_id": sensor_id,
                "period": period,
                "severity": severity,
            },
        },
        "compliance": {
            "area_category": "RESIDENTIAL",
            "day_limit_db": 55.0,
            "night_limit_db": 45.0,
            "day_window": "06:00-22:00 IST",
            "night_window": "22:00-06:00 IST",
        },
        "summary": {
            "incident_count": len(incidents),
            "critical_count": severity_counts["CRITICAL"],
            "high_count": severity_counts["HIGH"],
            "moderate_count": severity_counts["MODERATE"],
            "day_count": period_counts["DAY"],
            "night_count": period_counts["NIGHT"],
            "average_peak_db": round(average_peak, 1),
            "highest_peak_db": (
                round(float(peak_incident["peak_db"]), 1)
                if peak_incident
                else 0.0
            ),
            "highest_excess_db": (
                round(float(peak_incident["excess_db"]), 1)
                if peak_incident
                else 0.0
            ),
            "total_incident_duration_minutes": round(
                total_duration,
                1,
            ),
        },
        "breakdowns": {
            "by_source": [
                {"source": key, "count": value}
                for key, value in source_counts.most_common()
            ],
            "by_event_type": [
                {"event_type": key, "count": value}
                for key, value in event_counts.most_common()
            ],
        },
        "top_sensors": top_sensors[:10],
        "peak_incident": peak_incident,
        "ai_analysis": ai_context,
        "incidents": incidents[:500],
    }


@router.get("/summary")
def reports_summary(
    hours: int = Query(24, ge=1, le=720),
    source: str = Query("all", pattern=SOURCE_PATTERN),
    period: str = Query("all", pattern=PERIOD_PATTERN),
    severity: str = Query("all", pattern=SEVERITY_PATTERN),
    sensor_id: int | None = Query(None, gt=0),
    db: Session = Depends(get_db),
):
    return _build_report(
        db,
        hours=hours,
        source=source,
        period=period,
        severity=severity,
        sensor_id=sensor_id,
    )


@router.get("/generate")
def generate_report(
    hours: int = Query(24, ge=1, le=720),
    source: str = Query("all", pattern=SOURCE_PATTERN),
    period: str = Query("all", pattern=PERIOD_PATTERN),
    severity: str = Query("all", pattern=SEVERITY_PATTERN),
    sensor_id: int | None = Query(None, gt=0),
    db: Session = Depends(get_db),
):
    return _build_report(
        db,
        hours=hours,
        source=source,
        period=period,
        severity=severity,
        sensor_id=sensor_id,
    )


@router.get("/export.csv")
def export_report_csv(
    hours: int = Query(24, ge=1, le=720),
    source: str = Query("all", pattern=SOURCE_PATTERN),
    period: str = Query("all", pattern=PERIOD_PATTERN),
    severity: str = Query("all", pattern=SEVERITY_PATTERN),
    sensor_id: int | None = Query(None, gt=0),
    db: Session = Depends(get_db),
):
    report = _build_report(
        db,
        hours=hours,
        source=source,
        period=period,
        severity=severity,
        sensor_id=sensor_id,
    )

    output = io.StringIO()
    writer = csv.writer(output)

    writer.writerow(
        [
            "incident_id",
            "sensor_code",
            "sensor_name",
            "location",
            "severity",
            "period",
            "source",
            "event_type",
            "peak_db",
            "average_db",
            "allowed_db",
            "excess_db",
            "duration_minutes",
            "reading_count",
            "start_at",
            "end_at",
        ]
    )

    for incident in report["incidents"]:
        writer.writerow(
            [
                incident.get("incident_id"),
                incident.get("sensor_code"),
                incident.get("sensor_name"),
                incident.get("location"),
                incident.get("severity"),
                incident.get("period"),
                incident.get("source"),
                incident.get("event_type"),
                incident.get("peak_db"),
                incident.get("average_db"),
                incident.get("allowed_db"),
                incident.get("excess_db"),
                incident.get("duration_minutes"),
                incident.get("reading_count"),
                incident.get("start_at"),
                incident.get("end_at"),
            ]
        )

    generated = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"noiseguard_report_{generated}.csv"

    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": (
                f'attachment; filename="{filename}"'
            )
        },
    )
