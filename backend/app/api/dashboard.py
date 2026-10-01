from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.noise_reading import NoiseReading
from app.models.sensor import Sensor


router = APIRouter(
    prefix="/api/dashboard",
    tags=["Dashboard"],
)


@router.get("/metrics")
def get_dashboard_metrics(
    db: Session = Depends(get_db),
):
    active_sensor_query = (
        db.query(Sensor)
        .filter(Sensor.is_active.is_(True))
    )

    active_sensor_count = active_sensor_query.count()

    noise_stats = (
        db.query(
            func.avg(Sensor.current_noise_level),
            func.max(Sensor.current_noise_level),
        )
        .filter(Sensor.is_active.is_(True))
        .first()
    )

    average_noise = noise_stats[0] if noise_stats[0] is not None else 0.0
    maximum_noise = noise_stats[1] if noise_stats[1] is not None else 0.0

    active_alerts = (
        active_sensor_query
        .filter(Sensor.current_noise_level >= 85.0)
        .count()
    )

    latest_reading = (
        db.query(NoiseReading.recorded_at)
        .order_by(NoiseReading.recorded_at.desc())
        .first()
    )

    updated_at = (
        latest_reading[0]
        if latest_reading is not None
        else datetime.now(timezone.utc)
    )

    return {
        "avg_noise_level": round(float(average_noise), 1),
        "max_noise_level": round(float(maximum_noise), 1),
        "active_sensors": active_sensor_count,
        "active_alerts": active_alerts,
        "updated_at": updated_at,
    }