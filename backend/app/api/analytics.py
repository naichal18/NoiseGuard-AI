from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.noise_reading import NoiseReading
from app.models.sensor import Sensor
from app.services.anomaly_detector import (
    get_anomaly_analysis,
)
from app.services.recommendation_engine import (
    build_recommendations,
)

router = APIRouter(
    prefix="/api/analytics",
    tags=["Analytics"],
)


SOURCE_PATTERN = (
    "^(all|dataset|simulator|api|sensor)$"
)


# ============================================================
# HELPERS
# ============================================================


def get_start_time(
    hours: int,
) -> datetime:
    return (
        datetime.now(timezone.utc)
        - timedelta(
            hours=hours
        )
    )


def apply_source_filter(
    query,
    source: str,
):
    if source == "all":
        return query

    return query.filter(
        NoiseReading.source
        == source
    )


# ============================================================
# ANALYTICS SUMMARY
# ============================================================


@router.get("/summary")
def get_analytics_summary(
    hours: int = Query(
        default=24,
        ge=1,
        le=2160,
    ),
    source: str = Query(
        default="all",
        pattern=SOURCE_PATTERN,
    ),
    db: Session = Depends(
        get_db
    ),
):
    start_time = get_start_time(
        hours
    )

    query = db.query(
        func.count(
            NoiseReading.id
        ).label(
            "total_readings"
        ),

        func.avg(
            NoiseReading.noise_level
        ).label(
            "average_noise"
        ),

        func.max(
            NoiseReading.noise_level
        ).label(
            "maximum_noise"
        ),

        func.min(
            NoiseReading.noise_level
        ).label(
            "minimum_noise"
        ),
    ).filter(
        NoiseReading.recorded_at
        >= start_time
    )

    query = apply_source_filter(
        query,
        source,
    )

    result = query.first()

    total_readings = (
        result.total_readings
        or 0
    )

    return {
        "period_hours": hours,

        "source": source,

        "total_readings": (
            total_readings
        ),

        "average_noise": round(
            float(
                result.average_noise
                or 0
            ),
            1,
        ),

        "maximum_noise": round(
            float(
                result.maximum_noise
                or 0
            ),
            1,
        ),

        "minimum_noise": round(
            float(
                result.minimum_noise
                or 0
            ),
            1,
        ),
    }


# ============================================================
# SENSOR ANALYTICS
# ============================================================


@router.get("/sensors")
def get_sensor_analytics(
    hours: int = Query(
        default=24,
        ge=1,
        le=2160,
    ),
    source: str = Query(
        default="all",
        pattern=SOURCE_PATTERN,
    ),
    db: Session = Depends(
        get_db
    ),
):
    start_time = get_start_time(
        hours
    )

    reading_join_condition = (
        (
            NoiseReading.sensor_id
            == Sensor.id
        )
        & (
            NoiseReading.recorded_at
            >= start_time
        )
    )

    if source != "all":
        reading_join_condition = (
            reading_join_condition
            & (
                NoiseReading.source
                == source
            )
        )

    results = (
        db.query(
            Sensor.id.label(
                "sensor_id"
            ),

            Sensor.sensor_code.label(
                "sensor_code"
            ),

            Sensor.name.label(
                "sensor_name"
            ),

            Sensor.location.label(
                "location"
            ),

            func.count(
                NoiseReading.id
            ).label(
                "reading_count"
            ),

            func.avg(
                NoiseReading.noise_level
            ).label(
                "average_noise"
            ),

            func.max(
                NoiseReading.noise_level
            ).label(
                "maximum_noise"
            ),

            func.min(
                NoiseReading.noise_level
            ).label(
                "minimum_noise"
            ),
        )

        .outerjoin(
            NoiseReading,
            reading_join_condition,
        )

        .group_by(
            Sensor.id,
            Sensor.sensor_code,
            Sensor.name,
            Sensor.location,
        )

        .order_by(
            func.avg(
                NoiseReading.noise_level
            )
            .desc()
            .nullslast()
        )

        .all()
    )

    return [
        {
            "sensor_id": row.sensor_id,

            "sensor_code": (
                row.sensor_code
            ),

            "sensor_name": (
                row.sensor_name
            ),

            "location": (
                row.location
            ),

            "reading_count": (
                row.reading_count
            ),

            "average_noise": round(
                float(
                    row.average_noise
                    or 0
                ),
                1,
            ),

            "maximum_noise": round(
                float(
                    row.maximum_noise
                    or 0
                ),
                1,
            ),

            "minimum_noise": round(
                float(
                    row.minimum_noise
                    or 0
                ),
                1,
            ),
        }
        for row in results
    ]


# ============================================================
# NOISE TREND
# ============================================================


@router.get("/trend")
def get_noise_trend(
    hours: int = Query(
        default=24,
        ge=1,
        le=2160,
    ),
    source: str = Query(
        default="all",
        pattern=SOURCE_PATTERN,
    ),
    db: Session = Depends(
        get_db
    ),
):
    start_time = get_start_time(
        hours
    )

    bucket = func.date_trunc(
        "hour",
        NoiseReading.recorded_at,
    )

    query = db.query(
        bucket.label(
            "timestamp"
        ),

        func.avg(
            NoiseReading.noise_level
        ).label(
            "average_noise"
        ),

        func.max(
            NoiseReading.noise_level
        ).label(
            "maximum_noise"
        ),

        func.min(
            NoiseReading.noise_level
        ).label(
            "minimum_noise"
        ),

        func.count(
            NoiseReading.id
        ).label(
            "reading_count"
        ),
    ).filter(
        NoiseReading.recorded_at
        >= start_time
    )

    query = apply_source_filter(
        query,
        source,
    )

    results = (
        query
        .group_by(bucket)
        .order_by(bucket.asc())
        .all()
    )

    return [
        {
            "timestamp": (
                row.timestamp.isoformat()
            ),

            "average_noise": round(
                float(
                    row.average_noise
                    or 0
                ),
                1,
            ),

            "maximum_noise": round(
                float(
                    row.maximum_noise
                    or 0
                ),
                1,
            ),

            "minimum_noise": round(
                float(
                    row.minimum_noise
                    or 0
                ),
                1,
            ),

            "reading_count": (
                row.reading_count
            ),
        }
        for row in results
    ]


# ============================================================
# AI ANOMALY ANALYSIS
# ============================================================


@router.get("/anomalies")
def get_anomalies(
    hours: int = Query(
        default=24,
        ge=1,
        le=168,
    ),

    baseline_hours: int = Query(
        default=24,
        ge=1,
        le=2160,
    ),

    limit: int = Query(
        default=20,
        ge=1,
        le=100,
    ),

    sensor_id: int | None = Query(
        default=None,
        ge=1,
    ),

    source: str = Query(
        default="all",
        pattern=SOURCE_PATTERN,
    ),

    db: Session = Depends(
        get_db
    ),
):
    """
    Run the NoiseGuard AI anomaly detection engine.

    The detector compares current database readings against
    sensor + source specific historical baselines.

    Supported filters:

        hours
        baseline_hours
        sensor_id
        source
        limit
    """

    return get_anomaly_analysis(
        db=db,
        hours=hours,
        baseline_hours=baseline_hours,
        limit=limit,
        sensor_id=sensor_id,
        source=source,
    )

# ============================================================
# AI RECOMMENDATIONS
# ============================================================

@router.get("/recommendations")
def get_recommendations(
    hours: int = Query(
        default=24,
        ge=1,
        le=168,
    ),

    baseline_hours: int = Query(
        default=24,
        ge=1,
        le=2160,
    ),

    limit: int = Query(
        default=10,
        ge=1,
        le=100,
    ),

    sensor_id: int | None = Query(
        default=None,
        ge=1,
    ),

    source: str = Query(
        default="all",
        pattern=SOURCE_PATTERN,
    ),

    db: Session = Depends(
        get_db
    ),
):
    """
    Generate AI recommendations from
    dynamically detected anomaly events.

    The recommendation engine uses the
    actual anomaly detector output.
    """

    analysis = get_anomaly_analysis(
        db=db,
        hours=hours,
        baseline_hours=baseline_hours,
        limit=100,
        sensor_id=sensor_id,
        source=source,
    )

    anomalies = analysis.get(
        "anomalies",
        [],
    )

    recommendations = build_recommendations(
        anomalies
    )

    return {
        "analysis": {
            "period_hours": hours,
            "baseline_hours": baseline_hours,
            "sensor_id": sensor_id,
            "source": source,
            "anomaly_count": len(
                anomalies
            ),
            "recommendation_count": min(
                len(recommendations),
                limit,
            ),
        },

        "recommendations": (
            recommendations[:limit]
        ),
    }