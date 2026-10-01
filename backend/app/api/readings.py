from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.alert import Alert
from app.models.noise_reading import NoiseReading
from app.models.sensor import Sensor
from app.schemas.noise_reading import (
    NoiseReadingCreate,
    NoiseReadingResponse,
)
from app.services.runtime_settings import get_runtime_settings
from app.services.websocket_manager import websocket_manager


router = APIRouter(
    prefix="/api/readings",
    tags=["Noise Readings"],
)


def get_alert_severity(
    noise_level: float,
    high_threshold: float,
    critical_threshold: float,
) -> str | None:
    if noise_level >= critical_threshold:
        return "critical"

    if noise_level >= high_threshold:
        return "high"

    return None


def get_alert_event_type(
    noise_level: float,
    event_type: str,
    critical_threshold: float,
) -> str:
    if noise_level >= critical_threshold:
        return "EXTREME_NOISE_EVENT"

    if event_type and event_type != "NORMAL_ACTIVITY":
        return event_type

    return "NOISE_SPIKE"


async def broadcast_if_enabled(
    settings: dict,
    message: dict,
) -> None:
    if settings.get("websocket_enabled", True):
        await websocket_manager.broadcast(message)


@router.post(
    "",
    response_model=NoiseReadingResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_reading(
    reading_data: NoiseReadingCreate,
    db: Session = Depends(get_db),
):
    settings = get_runtime_settings(db)

    sensor = (
        db.query(Sensor)
        .filter(Sensor.id == reading_data.sensor_id)
        .first()
    )

    if sensor is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Sensor not found",
        )

    # ---------------------------------------------------------
    # 1. SAVE NOISE READING
    # ---------------------------------------------------------

    reading = NoiseReading(
        sensor_id=reading_data.sensor_id,
        noise_level=reading_data.noise_level,
        recorded_at=reading_data.recorded_at,
        source=reading_data.source,
        event_type=reading_data.event_type,
    )

    db.add(reading)

    sensor.current_noise_level = reading_data.noise_level
    sensor.status = "online"

    db.commit()
    db.refresh(reading)

    # ---------------------------------------------------------
    # 2. BROADCAST LIVE NOISE READING
    # ---------------------------------------------------------

    await broadcast_if_enabled(
        settings,
        {
            "type": "noise_reading",
            "data": {
                "id": reading.id,
                "sensor_id": reading.sensor_id,
                "noise_level": reading.noise_level,
                "recorded_at": reading.recorded_at.isoformat(),
                "source": reading.source,
                "event_type": reading.event_type,
            },
        },
    )

    # ---------------------------------------------------------
    # 3. SETTINGS-AWARE ALERT ENGINE
    # ---------------------------------------------------------

    if not settings.get("alert_engine_enabled", True):
        return reading

    high_threshold = float(
        settings.get("high_noise_threshold_db", 85.0)
    )
    critical_threshold = float(
        settings.get("critical_noise_threshold_db", 95.0)
    )
    auto_resolve_enabled = bool(
        settings.get("auto_resolve_enabled", True)
    )

    severity = get_alert_severity(
        reading_data.noise_level,
        high_threshold,
        critical_threshold,
    )

    # ---------------------------------------------------------
    # 3A. NORMAL READING → AUTO RESOLVE ACTIVE ALERT
    # ---------------------------------------------------------

    if severity is None:
        if not auto_resolve_enabled:
            return reading

        active_alerts = (
            db.query(Alert)
            .filter(
                Alert.sensor_id == sensor.id,
                Alert.resolved.is_(False),
            )
            .all()
        )

        if active_alerts:
            resolved_at = datetime.now(timezone.utc)

            for alert in active_alerts:
                alert.resolved = True
                alert.resolved_at = resolved_at

                await broadcast_if_enabled(
                    settings,
                    {
                        "type": "noise_alert_resolved",
                        "data": {
                            "id": alert.id,
                            "sensor_id": alert.sensor_id,
                            "sensor_code": sensor.sensor_code,
                            "sensor_name": sensor.name,
                            "location": sensor.location,
                            "noise_level": reading_data.noise_level,
                            "severity": alert.severity,
                            "event_type": alert.event_type,
                            "message": alert.message,
                            "acknowledged": alert.acknowledged,
                            "resolved": True,
                            "created_at": alert.created_at.isoformat(),
                            "resolved_at": alert.resolved_at.isoformat(),
                        },
                    },
                )

            db.commit()

        return reading

    # ---------------------------------------------------------
    # 3B. HIGH / CRITICAL READING
    # ---------------------------------------------------------

    alert_event_type = get_alert_event_type(
        reading_data.noise_level,
        reading_data.event_type,
        critical_threshold,
    )

    active_alert = (
        db.query(Alert)
        .filter(
            Alert.sensor_id == sensor.id,
            Alert.resolved.is_(False),
        )
        .order_by(Alert.created_at.desc())
        .first()
    )

    # ---------------------------------------------------------
    # 3C. UPDATE EXISTING ACTIVE ALERT
    # ---------------------------------------------------------

    if active_alert is not None:
        active_alert.noise_level = reading_data.noise_level
        active_alert.severity = severity
        active_alert.event_type = alert_event_type
        active_alert.message = (
            f"{severity.upper()} NOISE EVENT "
            f"{sensor.name} "
            f"{reading_data.noise_level:.1f} dB"
        )

        db.commit()
        db.refresh(active_alert)

        await broadcast_if_enabled(
            settings,
            {
                "type": "noise_alert_updated",
                "data": {
                    "id": active_alert.id,
                    "sensor_id": active_alert.sensor_id,
                    "sensor_code": sensor.sensor_code,
                    "sensor_name": sensor.name,
                    "location": sensor.location,
                    "noise_level": active_alert.noise_level,
                    "severity": active_alert.severity,
                    "event_type": active_alert.event_type,
                    "message": active_alert.message,
                    "acknowledged": active_alert.acknowledged,
                    "resolved": active_alert.resolved,
                    "created_at": active_alert.created_at.isoformat(),
                    "resolved_at": (
                        active_alert.resolved_at.isoformat()
                        if active_alert.resolved_at
                        else None
                    ),
                },
            },
        )

        return reading

    # ---------------------------------------------------------
    # 3D. CREATE NEW ALERT
    # ---------------------------------------------------------

    alert = Alert(
        sensor_id=sensor.id,
        noise_level=reading_data.noise_level,
        severity=severity,
        event_type=alert_event_type,
        message=(
            f"{severity.upper()} NOISE EVENT "
            f"{sensor.name} "
            f"{reading_data.noise_level:.1f} dB"
        ),
        acknowledged=False,
        resolved=False,
    )

    db.add(alert)
    db.commit()
    db.refresh(alert)

    # ---------------------------------------------------------
    # 4. BROADCAST NEW ALERT
    # ---------------------------------------------------------

    await broadcast_if_enabled(
        settings,
        {
            "type": "noise_alert",
            "data": {
                "id": alert.id,
                "sensor_id": alert.sensor_id,
                "sensor_code": sensor.sensor_code,
                "sensor_name": sensor.name,
                "location": sensor.location,
                "noise_level": alert.noise_level,
                "severity": alert.severity,
                "event_type": alert.event_type,
                "message": alert.message,
                "acknowledged": alert.acknowledged,
                "resolved": alert.resolved,
                "created_at": alert.created_at.isoformat(),
                "resolved_at": (
                    alert.resolved_at.isoformat()
                    if alert.resolved_at
                    else None
                ),
            },
        },
    )

    return reading


@router.get(
    "",
    response_model=list[NoiseReadingResponse],
)
def get_readings(
    db: Session = Depends(get_db),
):
    return (
        db.query(NoiseReading)
        .order_by(NoiseReading.recorded_at.desc())
        .all()
    )


@router.get("/analytics-summary")
def get_analytics_summary(
    hours: int = Query(24, ge=1, le=720),
    source: str = Query("all"),
    db: Session = Depends(get_db),
):
    """Return compact analytics aggregates instead of sending the full readings table to the browser."""
    from collections import defaultdict
    from zoneinfo import ZoneInfo

    settings = get_runtime_settings(db)
    day_limit = float(settings.get("day_limit_db", 55))
    night_limit = float(settings.get("night_limit_db", 45))
    high_threshold = float(settings.get("high_noise_threshold_db", 85))
    critical_threshold = float(settings.get("critical_noise_threshold_db", 95))
    timezone_name = str(settings.get("timezone", "Asia/Kolkata"))
    try:
        tz = ZoneInfo(timezone_name)
    except Exception:
        timezone_name = "Asia/Kolkata"
        tz = ZoneInfo(timezone_name)

    normalized_source = str(source or "all").strip().lower()
    query = db.query(
        NoiseReading.id,
        NoiseReading.sensor_id,
        NoiseReading.noise_level,
        NoiseReading.recorded_at,
        NoiseReading.source,
        NoiseReading.event_type,
    )
    if normalized_source != "all":
        query = query.filter(NoiseReading.source == normalized_source)

    latest = query.order_by(NoiseReading.recorded_at.desc()).first()
    if latest is None:
        return {
            "hours": hours,
            "source": normalized_source,
            "timezone": timezone_name,
            "total_readings": 0,
            "average": 0,
            "peak": 0,
            "high": 0,
            "critical": 0,
            "normal": 0,
            "moderate": 0,
            "violations": 0,
            "trend": [],
            "sensor_rows": [],
            "day_night": {"day_average": 0, "night_average": 0, "day_count": 0, "night_count": 0},
            "events": [],
            "hourly": [],
        }

    latest_time = latest.recorded_at
    if latest_time.tzinfo is None:
        latest_time = latest_time.replace(tzinfo=timezone.utc)
    start_time = latest_time - timedelta(hours=hours)

    rows = query.filter(
        NoiseReading.recorded_at >= start_time.replace(tzinfo=None) if latest.recorded_at.tzinfo is None else NoiseReading.recorded_at >= start_time
    ).order_by(NoiseReading.recorded_at.asc()).all()

    if not rows:
        return {
            "hours": hours,
            "source": normalized_source,
            "timezone": timezone_name,
            "total_readings": 0,
            "average": 0,
            "peak": 0,
            "high": 0,
            "critical": 0,
            "normal": 0,
            "moderate": 0,
            "violations": 0,
            "trend": [],
            "sensor_rows": [],
            "day_night": {"day_average": 0, "night_average": 0, "day_count": 0, "night_count": 0},
            "events": [],
            "hourly": [],
        }

    values = [float(r.noise_level) for r in rows]
    high = critical = normal = moderate = violations = 0
    sensor_values = defaultdict(list)
    sensor_violations = defaultdict(int)
    event_counts = defaultdict(int)
    hourly_values = defaultdict(list)
    day_values, night_values = [], []

    for r in rows:
        value = float(r.noise_level)
        recorded = r.recorded_at
        if recorded.tzinfo is None:
            recorded = recorded.replace(tzinfo=timezone.utc)
        local = recorded.astimezone(tz)
        is_day = 6 <= local.hour < 22
        limit = day_limit if is_day else night_limit
        if value >= critical_threshold:
            critical += 1
        elif value >= high_threshold:
            high += 1
        elif value > day_limit:
            moderate += 1
        else:
            normal += 1
        if value > limit:
            violations += 1
            sensor_violations[r.sensor_id] += 1
        sensor_values[r.sensor_id].append(value)
        event_key = str(r.event_type or "NORMAL_ACTIVITY").replace("_", " ").replace("NORMAL ACTIVITY", "NORMAL")
        event_counts[event_key] += 1
        hourly_values[local.hour].append(value)
        (day_values if is_day else night_values).append(value)

    sensor_ids = list(sensor_values.keys())
    sensors = {
        s.id: s for s in db.query(Sensor).filter(Sensor.id.in_(sensor_ids)).all()
    }
    sensor_rows = []
    for sensor_id, vals in sensor_values.items():
        sensor = sensors.get(sensor_id)
        sensor_rows.append({
            "label": sensor.sensor_code if sensor else f"SENSOR-{sensor_id}",
            "location": sensor.location if sensor else "UNKNOWN",
            "average": sum(vals) / len(vals),
            "peak": max(vals),
            "violations": sensor_violations.get(sensor_id, 0),
            "readings": len(vals),
        })
    sensor_rows.sort(key=lambda x: x["average"], reverse=True)

    count = 24 if hours == 24 else 42 if hours == 168 else 56
    first_ts = rows[0].recorded_at
    last_ts = rows[-1].recorded_at
    if first_ts.tzinfo is None:
        first_ts = first_ts.replace(tzinfo=timezone.utc)
    if last_ts.tzinfo is None:
        last_ts = last_ts.replace(tzinfo=timezone.utc)
    start_ts = first_ts.timestamp()
    end_ts = last_ts.timestamp()
    bucket_size = max((end_ts - start_ts) / count, 60)
    buckets = defaultdict(list)
    for r in rows:
        ts = r.recorded_at
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        numeric = ts.timestamp()
        index = min(count - 1, max(0, int((numeric - start_ts) / bucket_size)))
        buckets[start_ts + index * bucket_size].append(float(r.noise_level))

    def bucket_label(ts_value):
        dt = datetime.fromtimestamp(ts_value, tz=tz)
        return dt.strftime("%H:%M") if hours == 24 else dt.strftime("%d/%m %H:%M")

    trend = [
        {
            "timestamp": int(ts * 1000),
            "label": bucket_label(ts),
            "average": sum(vals) / len(vals),
            "peak": max(vals),
        }
        for ts, vals in sorted(buckets.items())
    ]
    events = [
        {"label": label, "value": count_value / max(1, len(rows)) * 100, "meta": f"{count_value:,} readings"}
        for label, count_value in sorted(event_counts.items(), key=lambda item: item[1], reverse=True)[:7]
    ]
    hourly = [
        {"label": f"{hour:02d}:00", "value": sum(vals) / len(vals)}
        for hour, vals in sorted(hourly_values.items())
        if vals
    ]

    return {
        "hours": hours,
        "source": normalized_source,
        "timezone": timezone_name,
        "total_readings": len(rows),
        "average": sum(values) / len(values),
        "peak": max(values),
        "high": high,
        "critical": critical,
        "normal": normal,
        "moderate": moderate,
        "violations": violations,
        "trend": trend,
        "sensor_rows": sensor_rows,
        "day_night": {
            "day_average": sum(day_values) / len(day_values) if day_values else 0,
            "night_average": sum(night_values) / len(night_values) if night_values else 0,
            "day_count": len(day_values),
            "night_count": len(night_values),
        },
        "events": events,
        "hourly": hourly,
    }


@router.get(
    "/{reading_id}",
    response_model=NoiseReadingResponse,
)
def get_reading(
    reading_id: int,
    db: Session = Depends(get_db),
):
    reading = (
        db.query(NoiseReading)
        .filter(NoiseReading.id == reading_id)
        .first()
    )

    if reading is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Noise reading not found",
        )

    return reading


@router.get(
    "/sensors/{sensor_id}/readings",
    response_model=list[NoiseReadingResponse],
)
def get_sensor_readings(
    sensor_id: int,
    db: Session = Depends(get_db),
):
    sensor = (
        db.query(Sensor)
        .filter(Sensor.id == sensor_id)
        .first()
    )

    if sensor is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Sensor not found",
        )

    return (
        db.query(NoiseReading)
        .filter(NoiseReading.sensor_id == sensor_id)
        .order_by(NoiseReading.recorded_at.desc())
        .all()
    )
