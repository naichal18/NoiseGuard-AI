from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.noise_reading import NoiseReading
from app.models.sensor import Sensor
from app.schemas.noise_reading import NoiseReadingResponse
from app.schemas.sensor import SensorCreate, SensorResponse, SensorUpdate

router = APIRouter(
    prefix="/api/sensors",
    tags=["Sensors"],
)


@router.post(
    "",
    response_model=SensorResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_sensor(
    sensor_data: SensorCreate,
    db: Session = Depends(get_db),
):
    existing_sensor = (
        db.query(Sensor)
        .filter(Sensor.sensor_code == sensor_data.sensor_code)
        .first()
    )

    if existing_sensor:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Sensor code already exists",
        )

    sensor = Sensor(
        sensor_code=sensor_data.sensor_code,
        name=sensor_data.name,
        location=sensor_data.location,
        latitude=sensor_data.latitude,
        longitude=sensor_data.longitude,
        current_noise_level=sensor_data.current_noise_level,
        status=sensor_data.status,
        is_active=sensor_data.is_active,
    )

    try:
        db.add(sensor)
        db.commit()
        db.refresh(sensor)
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Sensor code already exists",
        )

    return sensor


@router.get(
    "",
    response_model=list[SensorResponse],
)
def get_sensors(
    db: Session = Depends(get_db),
):
    return (
        db.query(Sensor)
        .order_by(Sensor.id)
        .all()
    )


@router.get(
    "/{sensor_id}",
    response_model=SensorResponse,
)
def get_sensor(
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

    return sensor


@router.get(
    "/{sensor_id}/readings",
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


@router.put(
    "/{sensor_id}",
    response_model=SensorResponse,
)
def update_sensor(
    sensor_id: int,
    sensor_data: SensorUpdate,
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

    if sensor_data.sensor_code is not None:
        existing_sensor = (
            db.query(Sensor)
            .filter(
                Sensor.sensor_code == sensor_data.sensor_code,
                Sensor.id != sensor_id,
            )
            .first()
        )

        if existing_sensor:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Sensor code already exists",
            )

    update_data = sensor_data.model_dump(
        exclude_unset=True,
    )

    for field, value in update_data.items():
        setattr(sensor, field, value)

    try:
        db.commit()
        db.refresh(sensor)
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Sensor code already exists",
        )

    return sensor


@router.delete(
    "/{sensor_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_sensor(
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

    db.delete(sensor)
    db.commit()

