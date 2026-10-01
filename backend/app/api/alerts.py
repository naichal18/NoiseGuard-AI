from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.alert import Alert
from app.models.sensor import Sensor


router = APIRouter(
    prefix="/api/alerts",
    tags=["Alerts"],
)


def build_alert_response(alert: Alert, sensor: Sensor | None):
    return {
        "id": alert.id,
        "sensor_id": alert.sensor_id,
        "sensor_code": sensor.sensor_code if sensor else None,
        "sensor_name": sensor.name if sensor else None,
        "location": sensor.location if sensor else None,
        "noise_level": alert.noise_level,
        "severity": alert.severity,
        "event_type": alert.event_type,
        "message": alert.message,
        "acknowledged": alert.acknowledged,
        "resolved": alert.resolved,
        "created_at": alert.created_at,
        "resolved_at": alert.resolved_at,
    }


@router.get("")
def get_alerts(
    active_only: bool = False,
    db: Session = Depends(get_db),
):
    query = (
        db.query(Alert)
        .join(Sensor, Sensor.id == Alert.sensor_id)
    )

    if active_only:
        query = query.filter(Alert.resolved.is_(False))

    results = (
    query
    .order_by(Alert.created_at.desc())
    .all()
)

    return [
        build_alert_response(
         alert,
         db.query(Sensor)
         .filter(Sensor.id == alert.sensor_id)
         .first(),
    )
    for alert in results
    ]


@router.get("/{alert_id}")
def get_alert(
    alert_id: int,
    db: Session = Depends(get_db),
):
    result = (
        db.query(Alert, Sensor)
        .outerjoin(Sensor, Sensor.id == Alert.sensor_id)
        .filter(Alert.id == alert_id)
        .first()
    )

    if result is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Alert not found",
        )

    alert, sensor = result

    return build_alert_response(alert, sensor)


@router.put("/{alert_id}/acknowledge")
def acknowledge_alert(
    alert_id: int,
    db: Session = Depends(get_db),
):
    alert = (
        db.query(Alert)
        .filter(Alert.id == alert_id)
        .first()
    )

    if alert is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Alert not found",
        )

    alert.acknowledged = True

    db.commit()
    db.refresh(alert)

    sensor = (
        db.query(Sensor)
        .filter(Sensor.id == alert.sensor_id)
        .first()
    )

    return build_alert_response(alert, sensor)


@router.put("/{alert_id}/resolve")
def resolve_alert(
    alert_id: int,
    db: Session = Depends(get_db),
):
    alert = (
        db.query(Alert)
        .filter(Alert.id == alert_id)
        .first()
    )

    if alert is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Alert not found",
        )

    alert.resolved = True
    alert.resolved_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(alert)

    sensor = (
        db.query(Sensor)
        .filter(Sensor.id == alert.sensor_id)
        .first()
    )

    return build_alert_response(alert, sensor)