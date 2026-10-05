from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from statistics import mean, pstdev
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.noise_reading import NoiseReading
from app.models.sensor import Sensor


# ============================================================
# BASELINE CONFIGURATION
# ============================================================

MIN_BASELINE_READINGS = 30
MIN_STD_DEV = 1.0

# Fresh live streams do not have the previous analysis window
# available yet. Use a small, sensor-specific warm-up baseline
# until the normal historical baseline reaches MIN_BASELINE_READINGS.
LIVE_BOOTSTRAP_READINGS = 10
LIVE_SOURCES = {"simulator", "api", "sensor"}


# ============================================================
# ENVIRONMENTAL NOISE THRESHOLDS
# ============================================================

MODERATE_NOISE = 85.0
HIGH_NOISE = 95.0
CRITICAL_NOISE = 100.0


# ============================================================
# STATISTICAL THRESHOLDS
# ============================================================

POSITIVE_Z_THRESHOLD = 2.0
STRONG_POSITIVE_Z_THRESHOLD = 2.5


# ============================================================
# EVENT DETECTION CONFIGURATION
# ============================================================

# Maximum gap between consecutive anomaly readings that can
# belong to the same event.
MAX_EVENT_GAP_MINUTES = 10


# A single >=100 dB reading is considered an immediate
# critical environmental event.
#
# For everything below 100 dB, we require meaningful
# persistence rather than simply "2 readings".
#
# This is important because historical dataset readings are
# sampled every 5 minutes.
MIN_PERSISTENCE_READINGS = 3
MIN_PERSISTENCE_DURATION_MINUTES = 1.0
MIN_LONG_PERSISTENCE_DURATION_MINUTES = 10.0


# A high reading should also be meaningfully above the
# historical baseline to participate in statistical detection.
MIN_ABSOLUTE_BASELINE_DEVIATION_DB = 8.0


# Exceptional persistent high-noise event threshold.
# 95-99.9 dB remains HIGH by default.
EXCEPTIONAL_CRITICAL_NOISE = 98.5
EXCEPTIONAL_CRITICAL_SCORE = 80.0
EXCEPTIONAL_CRITICAL_DURATION_MINUTES = 15.0


# ============================================================
# HELPERS
# ============================================================


def _safe_float(
    value: Any,
    digits: int = 1,
) -> float:
    return round(float(value or 0), digits)


def _normalise_datetime(
    value: datetime,
) -> datetime:
    """
    Ensure datetime values are timezone-aware UTC values.
    """

    if value.tzinfo is None:
        return value.replace(
            tzinfo=timezone.utc
        )

    return value.astimezone(
        timezone.utc
    )


# ============================================================
# SEVERITY
# ============================================================


def _severity_from_score(
    score: float,
    peak_noise: float,
    duration_minutes: float = 0.0,
    reading_count: int = 1,
) -> str:
    """
    Convert anomaly evidence into NoiseGuard severity.

    Environmental dB thresholds take priority over the
    statistical score.

    Rules:

        <85 dB
            NORMAL / statistical context only

        85-94.9 dB
            MODERATE/HIGH depending on anomaly evidence

        95-99.9 dB
            HIGH by default

        98.5-99.9 dB
            Can become CRITICAL only when exceptionally
            persistent and statistically strong

        >=100 dB
            CRITICAL immediately
    """

    # --------------------------------------------------------
    # CRITICAL: absolute extreme
    # --------------------------------------------------------

    if peak_noise >= CRITICAL_NOISE:
        return "CRITICAL"

    # --------------------------------------------------------
    # CRITICAL: exceptional persistent high event
    # --------------------------------------------------------

    if (
        peak_noise >= EXCEPTIONAL_CRITICAL_NOISE
        and score >= EXCEPTIONAL_CRITICAL_SCORE
        and duration_minutes
        >= EXCEPTIONAL_CRITICAL_DURATION_MINUTES
    ):
        return "CRITICAL"

    # --------------------------------------------------------
    # HIGH: 95-99.9 dB
    # --------------------------------------------------------

    if peak_noise >= HIGH_NOISE:
        return "HIGH"

    # --------------------------------------------------------
    # HIGH: sustained 85+ event with strong evidence
    # --------------------------------------------------------

    if peak_noise >= MODERATE_NOISE:
        if score >= 65:
            return "HIGH"

        if duration_minutes >= 10.0:
            return "HIGH"

        if reading_count >= 12:
            return "HIGH"

        return "MODERATE"

    # --------------------------------------------------------
    # Statistical moderate
    # --------------------------------------------------------

    if score >= 45:
        return "MODERATE"

    return "NORMAL"


# ============================================================
# ANOMALY SCORE
# ============================================================


def _calculate_anomaly_score(
    current_noise: float,
    baseline_mean: float,
    baseline_std: float,
) -> tuple[float, float, float]:
    """
    Returns:

        anomaly_score
        z_score
        percentage_deviation

    Only positive deviation contributes to the pollution
    anomaly score.
    """

    std = max(
        float(baseline_std),
        MIN_STD_DEV,
    )

    z_score = (
        current_noise - baseline_mean
    ) / std

    percentage_deviation = (
        (
            (
                current_noise
                - baseline_mean
            )
            / baseline_mean
        )
        * 100.0
        if baseline_mean > 0
        else 0.0
    )

    positive_z = max(
        0.0,
        z_score,
    )

    positive_deviation = max(
        0.0,
        percentage_deviation,
    )

    # --------------------------------------------------------
    # Statistical component
    # --------------------------------------------------------

    z_component = min(
        100.0,
        positive_z / 4.0 * 100.0,
    )

    # --------------------------------------------------------
    # Relative deviation component
    # --------------------------------------------------------

    deviation_component = min(
        100.0,
        positive_deviation / 50.0 * 100.0,
    )

    # --------------------------------------------------------
    # Absolute environmental component
    # --------------------------------------------------------

    if current_noise >= CRITICAL_NOISE:
        absolute_component = 100.0

    elif current_noise >= HIGH_NOISE:
        absolute_component = 85.0

    elif current_noise >= MODERATE_NOISE:
        absolute_component = 65.0

    else:
        absolute_component = 0.0

    # --------------------------------------------------------
    # Weighted anomaly score
    # --------------------------------------------------------

    score = (
        z_component * 0.45
        + deviation_component * 0.30
        + absolute_component * 0.25
    )

    score = max(
        0.0,
        min(100.0, score),
    )

    return (
        round(score, 1),
        round(z_score, 2),
        round(
            percentage_deviation,
            1,
        ),
    )


# ============================================================
# POLLUTION CANDIDATE
# ============================================================


def _is_pollution_candidate(
    noise_level: float,
    z_score: float,
    baseline_mean: float,
) -> bool:
    """
    Decide whether a reading can participate in a pollution
    anomaly event.

    We intentionally ignore negative statistical deviations.

    A low but statistically unusual reading is not a noise
    pollution anomaly.
    """

    # --------------------------------------------------------
    # Extreme noise
    # --------------------------------------------------------

    if noise_level >= CRITICAL_NOISE:
        return True

    # --------------------------------------------------------
    # High noise
    # --------------------------------------------------------

    if noise_level >= HIGH_NOISE:
        return True

    # --------------------------------------------------------
    # Moderate+ environmental noise
    # --------------------------------------------------------

    if noise_level >= MODERATE_NOISE:

        if noise_level >= (
            baseline_mean
            + MIN_ABSOLUTE_BASELINE_DEVIATION_DB
        ):
            return True

        if z_score >= POSITIVE_Z_THRESHOLD:
            return True

    # --------------------------------------------------------
    # Strong statistical deviation
    # --------------------------------------------------------

    if z_score >= STRONG_POSITIVE_Z_THRESHOLD:
        return noise_level >= MODERATE_NOISE

    return False


# ============================================================
# BASELINE
# ============================================================


def _build_baseline(
    readings: list[NoiseReading],
) -> tuple[float, float]:
    """
    Calculate historical mean and population standard deviation.
    """

    values = [
        float(reading.noise_level)
        for reading in readings
        if reading.noise_level is not None
    ]

    if not values:
        return (
            0.0,
            MIN_STD_DEV,
        )

    baseline_mean = mean(values)

    if len(values) > 1:
        baseline_std = pstdev(values)
    else:
        baseline_std = MIN_STD_DEV

    baseline_std = max(
        float(baseline_std),
        MIN_STD_DEV,
    )

    return (
        round(
            baseline_mean,
            1,
        ),
        round(
            baseline_std,
            1,
        ),
    )


# ============================================================
# EVENT DURATION
# ============================================================


def _duration_minutes(
    start: datetime,
    end: datetime,
) -> float:

    start = _normalise_datetime(start)
    end = _normalise_datetime(end)

    seconds = max(
        0.0,
        (
            end - start
        ).total_seconds(),
    )

    return round(
        seconds / 60.0,
        1,
    )


# ============================================================
# EVENT SEVERITY
# ============================================================


def _event_severity(
    peak_noise: float,
    max_score: float,
    duration_minutes: float,
    reading_count: int,
) -> str:

    return _severity_from_score(
        score=max_score,
        peak_noise=peak_noise,
        duration_minutes=duration_minutes,
        reading_count=reading_count,
    )


# ============================================================
# EVENT PERSISTENCE
# ============================================================


def _is_persistent_event(
    readings: list[dict[str, Any]],
) -> bool:
    """
    Determine whether an anomaly group represents a genuine
    pollution event.

    Rules:

    1. >=100 dB:
       Immediate event.

    2. Below 100 dB:
       Require either:
         - at least 3 readings AND >=1 minute duration
         - OR >=10 minutes duration

    This prevents two 5-minute dataset samples from being
    automatically treated as a confirmed event.
    """

    if not readings:
        return False

    peak_noise = max(
        float(item["noise_level"])
        for item in readings
    )

    # --------------------------------------------------------
    # Immediate extreme event
    # --------------------------------------------------------

    if peak_noise >= CRITICAL_NOISE:
        return True

    # --------------------------------------------------------
    # Calculate duration
    # --------------------------------------------------------

    start_time = readings[0][
        "recorded_at"
    ]

    end_time = readings[-1][
        "recorded_at"
    ]

    duration = _duration_minutes(
        start_time,
        end_time,
    )

    # --------------------------------------------------------
    # Strong persistence
    # --------------------------------------------------------

    if (
        len(readings)
        >= MIN_PERSISTENCE_READINGS
        and duration
        >= MIN_PERSISTENCE_DURATION_MINUTES
    ):
        return True

    # --------------------------------------------------------
    # Long persistence
    # --------------------------------------------------------

    if (
        duration
        >= MIN_LONG_PERSISTENCE_DURATION_MINUTES
    ):
        return True

    return False


# ============================================================
# EVENT TYPE
# ============================================================


def _choose_event_type(
    readings: list[dict[str, Any]],
) -> str:

    event_types = [
        str(item["event_type"])
        for item in readings
        if item.get("event_type")
    ]

    if not event_types:
        return "ANOMALOUS_NOISE"

    counts = Counter(
        event_types
    )

    # Prefer explicit event classifications when available.
    non_normal = [
        event
        for event in event_types
        if event != "NORMAL_ACTIVITY"
    ]

    if non_normal:
        non_normal_counts = Counter(
            non_normal
        )

        return non_normal_counts.most_common(
            1
        )[0][0]

    return counts.most_common(
        1
    )[0][0]


# ============================================================
# SOURCE
# ============================================================


def _choose_source(
    readings: list[dict[str, Any]],
) -> str:

    sources = [
        str(item["source"])
        for item in readings
        if item.get("source")
    ]

    if not sources:
        return "unknown"

    counts = Counter(
        sources
    )

    return counts.most_common(
        1
    )[0][0]


# ============================================================
# BUILD EVENT
# ============================================================


def _build_event(
    readings: list[dict[str, Any]],
) -> dict[str, Any]:

    readings = sorted(
        readings,
        key=lambda item: item["recorded_at"],
    )

    first = readings[0]
    last = readings[-1]

    peak = max(
        readings,
        key=lambda item: item["noise_level"],
    )

    max_score = max(
        float(item["anomaly_score"])
        for item in readings
    )

    average_noise = mean(
        float(item["noise_level"])
        for item in readings
    )

    start_time = _normalise_datetime(
        first["recorded_at"]
    )

    end_time = _normalise_datetime(
        last["recorded_at"]
    )

    duration_minutes = _duration_minutes(
        start_time,
        end_time,
    )

    severity = _event_severity(
        peak_noise=float(
            peak["noise_level"]
        ),
        max_score=max_score,
        duration_minutes=duration_minutes,
        reading_count=len(readings),
    )

    event_type = _choose_event_type(
        readings
    )

    source = _choose_source(
        readings
    )

    return {
        "event_id": (
            f"{first['sensor_id']}-"
            f"{source}-"
            f"{first['reading_id']}-"
            f"{last['reading_id']}"
        ),

        "sensor_id": first["sensor_id"],
        "sensor_code": first["sensor_code"],
        "sensor_name": first["sensor_name"],
        "location": first["location"],

        "start_time": (
            start_time.isoformat()
        ),

        "end_time": (
            end_time.isoformat()
        ),

        "duration_minutes": (
            duration_minutes
        ),

        "reading_count": len(
            readings
        ),

        "average_noise": round(
            float(average_noise),
            1,
        ),

        "peak_noise": round(
            float(
                peak["noise_level"]
            ),
            1,
        ),

        "baseline_mean": round(
            float(
                peak["baseline_mean"]
            ),
            1,
        ),

        "baseline_std": round(
            float(
                peak["baseline_std"]
            ),
            1,
        ),

        "peak_z_score": round(
            float(
                peak["z_score"]
            ),
            2,
        ),

        "peak_percentage_deviation": round(
            float(
                peak[
                    "percentage_deviation"
                ]
            ),
            1,
        ),

        "anomaly_score": round(
            float(max_score),
            1,
        ),

        "severity": severity,

        "event_type": event_type,

        "source": source,

        "peak_reading_id": peak[
            "reading_id"
        ],

        "peak_recorded_at": (
            _normalise_datetime(
                peak["recorded_at"]
            ).isoformat()
        ),

        "evidence": (
            f"Peak noise "
            f"{float(peak['noise_level']):.1f} dB; "
            f"historical baseline "
            f"{float(peak['baseline_mean']):.1f} dB; "
            f"deviation "
            f"{float(peak['percentage_deviation']):+.1f}%; "
            f"z-score "
            f"{float(peak['z_score']):+.2f}; "
            f"duration "
            f"{duration_minutes:.1f} minute(s); "
            f"observed across "
            f"{len(readings)} reading(s); "
            f"source {source}."
        ),
    }


# ============================================================
# GROUP EVENTS
# ============================================================


def _group_anomaly_readings(
    candidates: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """
    Group nearby anomaly readings by:

        sensor_id + source

    Dataset and simulator readings can therefore never be
    accidentally merged into one event.
    """

    if not candidates:
        return []

    by_sensor_source: dict[
        tuple[int, str],
        list[dict[str, Any]],
    ] = defaultdict(list)

    for candidate in candidates:

        key = (
            candidate["sensor_id"],
            candidate["source"],
        )

        by_sensor_source[key].append(
            candidate
        )

    events: list[
        dict[str, Any]
    ] = []

    max_gap = timedelta(
        minutes=MAX_EVENT_GAP_MINUTES
    )

    for (
        sensor_source,
        sensor_candidates,
    ) in by_sensor_source.items():

        sensor_candidates.sort(
            key=lambda item: item[
                "recorded_at"
            ]
        )

        current_group: list[
            dict[str, Any]
        ] = []

        for candidate in sensor_candidates:

            if not current_group:
                current_group.append(
                    candidate
                )
                continue

            previous = current_group[-1]

            previous_time = (
                _normalise_datetime(
                    previous[
                        "recorded_at"
                    ]
                )
            )

            current_time = (
                _normalise_datetime(
                    candidate[
                        "recorded_at"
                    ]
                )
            )

            gap = (
                current_time
                - previous_time
            )

            if gap <= max_gap:
                current_group.append(
                    candidate
                )

            else:

                if _is_persistent_event(
                    current_group
                ):
                    events.append(
                        _build_event(
                            current_group
                        )
                    )

                current_group = [
                    candidate
                ]

        if (
            current_group
            and _is_persistent_event(
                current_group
            )
        ):
            events.append(
                _build_event(
                    current_group
                )
            )

    # Highest confidence events first.
    events.sort(
        key=lambda item: (
            item["severity"] == "CRITICAL",
            item["severity"] == "HIGH",
            item["anomaly_score"],
            item["peak_noise"],
            item["duration_minutes"],
        ),
        reverse=True,
    )

    return events


# ============================================================
# ANALYSIS TIMELINE
# ============================================================


def _get_source_analysis_windows(
    db: Session,
    hours: int,
    baseline_hours: int,
    sensor_id: int | None,
    source: str,
    now: datetime,
) -> dict[str, tuple[datetime, datetime, datetime]]:
    """
    Build source-aware analysis windows.

    Live sources (for example simulator) are anchored to the real
    current time. Historical sources are anchored to their latest
    available reading so that a stored dataset can still be analyzed
    using labels such as LAST_24_HOURS or LAST_7_DAYS.

    The returned tuple is:
        (analysis_start, analysis_end, baseline_start)
    """

    if source != "all":
        selected_sources = [source]
    else:
        latest_query = (
            db.query(
                NoiseReading.source,
                func.max(NoiseReading.recorded_at),
            )
        )

        if sensor_id is not None:
            latest_query = latest_query.filter(
                NoiseReading.sensor_id == sensor_id
            )

        latest_rows = (
            latest_query
            .group_by(NoiseReading.source)
            .all()
        )

        selected_sources = [
            str(row[0])
            for row in latest_rows
            if row[1] is not None
        ]

    windows: dict[
        str,
        tuple[datetime, datetime, datetime],
    ] = {}

    for source_name in selected_sources:
        source_name = str(source_name)

        # Dataset/history must follow its own stored timeline.
        if source_name == "dataset":
            latest_query = db.query(
                func.max(NoiseReading.recorded_at)
            ).filter(
                NoiseReading.source == source_name
            )

            if sensor_id is not None:
                latest_query = latest_query.filter(
                    NoiseReading.sensor_id == sensor_id
                )

            latest_timestamp = latest_query.scalar()

            if latest_timestamp is None:
                continue

            analysis_end = _normalise_datetime(
                latest_timestamp
            )
        else:
            # Live/API/sensor streams are expected to follow the
            # real current clock.
            analysis_end = now

        analysis_start = (
            analysis_end
            - timedelta(hours=hours)
        )

        baseline_start = (
            analysis_start
            - timedelta(hours=baseline_hours)
        )

        windows[source_name] = (
            analysis_start,
            analysis_end,
            baseline_start,
        )

    return windows


# ============================================================
# MAIN ANALYSIS
# ============================================================


def get_anomaly_analysis(
    db: Session,
    hours: int = 24,
    baseline_hours: int = 24,
    limit: int = 20,
    sensor_id: int | None = None,
    source: str = "all",
) -> dict[str, Any]:
    """
    Main NoiseGuard AI anomaly analysis.

    Current readings are compared against a historical
    sensor-specific AND source-specific baseline immediately
    preceding the analysis window.
    """

    now = datetime.now(
        timezone.utc
    )

    # ========================================================
    # ALL SOURCES
    # ========================================================
    #
    # Each source has its own timeline and baseline. Running the
    # normal detector independently per source avoids mixing the
    # historical dataset timeline with live simulator/API/sensor
    # timelines. The individual source paths are already stable;
    # `all` only aggregates their independent results.

    if source == "all":
        source_windows = _get_source_analysis_windows(
            db=db,
            hours=hours,
            baseline_hours=baseline_hours,
            sensor_id=sensor_id,
            source=source,
            now=now,
        )

        source_analyses = [
            get_anomaly_analysis(
                db=db,
                hours=hours,
                baseline_hours=baseline_hours,
                limit=100,
                sensor_id=sensor_id,
                source=source_name,
            )
            for source_name in source_windows
        ]

        anomalies = [
            anomaly
            for analysis in source_analyses
            for anomaly in analysis.get("anomalies", [])
        ]

        anomalies.sort(
            key=lambda item: (
                item["severity"] == "CRITICAL",
                item["severity"] == "HIGH",
                item["anomaly_score"],
                item["peak_noise"],
                item["duration_minutes"],
            ),
            reverse=True,
        )

        severity_summary = {
            "critical": sum(
                analysis.get("severity_summary", {}).get("critical", 0)
                for analysis in source_analyses
            ),
            "high": sum(
                analysis.get("severity_summary", {}).get("high", 0)
                for analysis in source_analyses
            ),
            "moderate": sum(
                analysis.get("severity_summary", {}).get("moderate", 0)
                for analysis in source_analyses
            ),
            "normal": sum(
                analysis.get("severity_summary", {}).get("normal", 0)
                for analysis in source_analyses
            ),
        }

        sensor_stats: dict[int, dict[str, Any]] = {}
        severity_rank = {
            "NORMAL": 0,
            "MODERATE": 1,
            "HIGH": 2,
            "CRITICAL": 3,
        }

        for anomaly in anomalies:
            current_sensor_id = anomaly["sensor_id"]
            stats = sensor_stats.setdefault(
                current_sensor_id,
                {
                    "sensor_id": current_sensor_id,
                    "sensor_code": anomaly["sensor_code"],
                    "sensor_name": anomaly["sensor_name"],
                    "location": anomaly["location"],
                    "anomaly_count": 0,
                    "highest_score": 0.0,
                    "highest_peak_noise": 0.0,
                    "highest_severity": "NORMAL",
                    "total_duration_minutes": 0.0,
                },
            )

            stats["anomaly_count"] += 1
            stats["highest_score"] = max(
                stats["highest_score"],
                float(anomaly["anomaly_score"]),
            )
            stats["highest_peak_noise"] = max(
                stats["highest_peak_noise"],
                float(anomaly["peak_noise"]),
            )
            stats["total_duration_minutes"] += float(
                anomaly["duration_minutes"]
            )

            if severity_rank[anomaly["severity"]] > severity_rank[stats["highest_severity"]]:
                stats["highest_severity"] = anomaly["severity"]

        top_sensors = sorted(
            sensor_stats.values(),
            key=lambda item: (
                severity_rank[item["highest_severity"]],
                item["anomaly_count"],
                item["highest_score"],
                item["highest_peak_noise"],
            ),
            reverse=True,
        )[:10]

        top_sensors = [
            {
                **sensor,
                "highest_score": round(float(sensor["highest_score"]), 1),
                "highest_peak_noise": round(float(sensor["highest_peak_noise"]), 1),
                "total_duration_minutes": round(float(sensor["total_duration_minutes"]), 1),
            }
            for sensor in top_sensors
        ]

        return {
            "analysis": {
                "period_hours": hours,
                "baseline_hours": baseline_hours,
                "sensor_id": sensor_id,
                "source": "all",
                "readings_analyzed": sum(
                    analysis.get("analysis", {}).get("readings_analyzed", 0)
                    for analysis in source_analyses
                ),
                "sensors_analyzed": sum(
                    analysis.get("analysis", {}).get("sensors_analyzed", 0)
                    for analysis in source_analyses
                ),
                "candidate_readings": sum(
                    analysis.get("analysis", {}).get("candidate_readings", 0)
                    for analysis in source_analyses
                ),
                "anomaly_count": len(anomalies),
                "analysis_started_at": min(
                    (window[0] for window in source_windows.values()),
                    default=now,
                ).isoformat(),
                "analysis_completed_at": max(
                    (window[1] for window in source_windows.values()),
                    default=now,
                ).isoformat(),
                "analysis_windows": {
                    source_name: analysis.get("analysis", {}).get("analysis_windows", {}).get(source_name, {})
                    for source_name, analysis in zip(source_windows, source_analyses)
                },
            },
            "severity_summary": severity_summary,
            "top_sensors": top_sensors,
            "anomalies": anomalies[:limit],
        }

    source_windows = _get_source_analysis_windows(
        db=db,
        hours=hours,
        baseline_hours=baseline_hours,
        sensor_id=sensor_id,
        source=source,
        now=now,
    )

    # ========================================================
    # SOURCE-AWARE HISTORICAL BASELINE
    # ========================================================

    baseline_readings: list[NoiseReading] = []

    for source_name, (
        analysis_start,
        analysis_end,
        baseline_start,
    ) in source_windows.items():
        baseline_query = (
            db.query(NoiseReading)
            .filter(
                NoiseReading.source == source_name,
                NoiseReading.recorded_at >= baseline_start,
                NoiseReading.recorded_at < analysis_start,
            )
        )

        if sensor_id is not None:
            baseline_query = baseline_query.filter(
                NoiseReading.sensor_id == sensor_id
            )

        baseline_readings.extend(
            baseline_query
            .order_by(NoiseReading.recorded_at.asc())
            .all()
        )

    # IMPORTANT:
    #
    # Baselines remain separated by sensor + source.
    # Historical dataset readings therefore use a historical
    # dataset baseline, while simulator readings use their own
    # live baseline.

    baseline_by_sensor_source: dict[
        tuple[int, str],
        list[NoiseReading],
    ] = defaultdict(list)

    for reading in baseline_readings:
        key = (
            reading.sensor_id,
            str(reading.source),
        )

        baseline_by_sensor_source[key].append(reading)

    # ========================================================
    # LIVE BASELINE BOOTSTRAP
    # ========================================================
    #
    # A fresh simulator cannot have readings in the historical
    # window immediately preceding the current 24-hour analysis
    # window. Without a bootstrap, the detector would stay at
    # zero until a full analysis + baseline period had elapsed.
    #
    # We use only the earliest LIVE_BOOTSTRAP_READINGS from the
    # current live window as a temporary baseline. Those readings
    # are excluded from anomaly scoring, preventing the detector
    # from using the same samples to define and test the baseline.
    #
    # The normal 30-reading historical baseline remains unchanged
    # and automatically takes over once enough history exists.

    live_bootstrap_cutoff_by_sensor_source: dict[
        tuple[int, str],
        datetime,
    ] = {}

    for source_name, (
        analysis_start,
        analysis_end,
        baseline_start,
    ) in source_windows.items():

        if source_name not in LIVE_SOURCES:
            continue

        ranked_ids = (
            db.query(
                NoiseReading.id.label(
                    "reading_id"
                ),
                NoiseReading.sensor_id.label(
                    "sensor_id"
                ),
                func.row_number().over(
                    partition_by=NoiseReading.sensor_id,
                    order_by=NoiseReading.recorded_at.asc(),
                ).label(
                    "row_number"
                ),
            )
            .filter(
                NoiseReading.source == source_name,
                NoiseReading.recorded_at >= analysis_start,
                NoiseReading.recorded_at <= analysis_end,
            )
        )

        if sensor_id is not None:
            ranked_ids = ranked_ids.filter(
                NoiseReading.sensor_id == sensor_id
            )

        ranked_ids = ranked_ids.subquery()

        bootstrap_ids = (
            db.query(
                ranked_ids.c.reading_id
            )
            .filter(
                ranked_ids.c.row_number
                <= LIVE_BOOTSTRAP_READINGS
            )
            .all()
        )

        reading_ids = [
            row[0]
            for row in bootstrap_ids
        ]

        if not reading_ids:
            continue

        bootstrap_readings = (
            db.query(NoiseReading)
            .filter(
                NoiseReading.id.in_(reading_ids)
            )
            .order_by(
                NoiseReading.sensor_id.asc(),
                NoiseReading.recorded_at.asc(),
            )
            .all()
        )

        bootstrap_by_sensor: dict[
            int,
            list[NoiseReading],
        ] = defaultdict(list)

        for reading in bootstrap_readings:
            bootstrap_by_sensor[
                reading.sensor_id
            ].append(reading)

        for (
            bootstrap_sensor_id,
            readings,
        ) in bootstrap_by_sensor.items():

            key = (
                bootstrap_sensor_id,
                source_name,
            )

            # Keep the proper historical baseline whenever it
            # already satisfies the normal 30-reading requirement.
            if len(
                baseline_by_sensor_source.get(
                    key,
                    [],
                )
            ) >= MIN_BASELINE_READINGS:
                continue

            if len(readings) < LIVE_BOOTSTRAP_READINGS:
                continue

            # The bootstrap samples become the temporary baseline.
            # The analysis loop below explicitly recognizes this key
            # through live_bootstrap_cutoff_by_sensor_source, while
            # excluding these same samples from anomaly scoring.
            baseline_by_sensor_source[key] = readings

            live_bootstrap_cutoff_by_sensor_source[key] = (
                _normalise_datetime(
                    readings[-1].recorded_at
                )
            )

        # ========================================================
    # SENSOR METADATA
    # ========================================================

    sensors_query = db.query(
        Sensor
    )

    if sensor_id is not None:
        sensors_query = (
            sensors_query.filter(
                Sensor.id == sensor_id
            )
        )

    sensors = (
        sensors_query.all()
    )

    sensor_by_id = {
        sensor.id: sensor
        for sensor in sensors
    }

    # ========================================================
    # ANALYSIS READINGS
    # ========================================================

    current_readings: list[NoiseReading] = []

    for source_name, (
        analysis_start,
        analysis_end,
        baseline_start,
    ) in source_windows.items():
        current_query = (
            db.query(NoiseReading)
            .filter(
                NoiseReading.source == source_name,
                NoiseReading.recorded_at >= analysis_start,
                NoiseReading.recorded_at <= analysis_end,

                # Every candidate currently supported by the
                # detector is >=85 dB. This avoids loading
                # irrelevant normal readings into Python.
                NoiseReading.noise_level >= MODERATE_NOISE,
            )
        )

        if sensor_id is not None:
            current_query = current_query.filter(
                NoiseReading.sensor_id == sensor_id
            )

        current_readings.extend(
            current_query
            .order_by(NoiseReading.recorded_at.asc())
            .all()
        )

    # We retrieve all relevant >=85 dB readings in each source's
    # requested analysis window. No arbitrary 5000-row limit is used.

    # ========================================================
    # BASELINE COUNTS
    # ========================================================

    sensor_ids_with_baseline = {
        sensor_id_key
        for (
            sensor_id_key,
            source_key,
        ), readings in (
            baseline_by_sensor_source.items()
        )
        if (
            len(readings) >= MIN_BASELINE_READINGS
            or (
                (sensor_id_key, source_key)
                in live_bootstrap_cutoff_by_sensor_source
            )
        )
    }

    sensors_with_baseline = len(
        sensor_ids_with_baseline
    )

    # ========================================================
    # ANALYZE READINGS
    # ========================================================

    candidates: list[
        dict[str, Any]
    ] = []

    baseline_cache: dict[
        tuple[int, str],
        tuple[float, float],
    ] = {}

    for reading in current_readings:

        reading_source = str(
            reading.source
        )

        baseline_key = (
            reading.sensor_id,
            reading_source,
        )

        baseline = (
            baseline_by_sensor_source.get(
                baseline_key,
                [],
            )
        )

        using_live_bootstrap = (
            baseline_key
            in live_bootstrap_cutoff_by_sensor_source
        )

        if (
            len(baseline)
            < MIN_BASELINE_READINGS
            and not using_live_bootstrap
        ):
            continue

        if using_live_bootstrap:
            bootstrap_cutoff = (
                live_bootstrap_cutoff_by_sensor_source[
                    baseline_key
                ]
            )

            if (
                _normalise_datetime(
                    reading.recorded_at
                )
                <= bootstrap_cutoff
            ):
                continue

        sensor = sensor_by_id.get(
            reading.sensor_id
        )

        if sensor is None:
            continue

        # Cache baseline calculation.
        if baseline_key not in baseline_cache:

            baseline_cache[
                baseline_key
            ] = _build_baseline(
                baseline
            )

        (
            baseline_mean,
            baseline_std,
        ) = baseline_cache[
            baseline_key
        ]

        (
            score,
            z_score,
            percentage_deviation,
        ) = _calculate_anomaly_score(
            current_noise=float(
                reading.noise_level
            ),
            baseline_mean=baseline_mean,
            baseline_std=baseline_std,
        )

        if not _is_pollution_candidate(
            noise_level=float(
                reading.noise_level
            ),
            z_score=z_score,
            baseline_mean=baseline_mean,
        ):
            continue

        candidates.append(
            {
                "reading_id": reading.id,

                "sensor_id": reading.sensor_id,

                "sensor_code": sensor.sensor_code,

                "sensor_name": sensor.name,

                "location": sensor.location,

                "recorded_at": (
                    _normalise_datetime(
                        reading.recorded_at
                    )
                ),

                "noise_level": float(
                    reading.noise_level
                ),

                "baseline_mean": (
                    baseline_mean
                ),

                "baseline_std": (
                    baseline_std
                ),

                "z_score": z_score,

                "percentage_deviation": (
                    percentage_deviation
                ),

                "anomaly_score": score,

                "event_type": (
                    reading.event_type
                ),

                "source": reading_source,
            }
        )

    # ========================================================
    # GROUP INTO EVENTS
    # ========================================================

    events = _group_anomaly_readings(
        candidates
    )

    # ========================================================
    # SEVERITY SUMMARY
    # ========================================================

    severity_summary = {
        "critical": 0,
        "high": 0,
        "moderate": 0,
        "normal": 0,
    }

    for event in events:

        severity = str(
            event["severity"]
        ).lower()

        if severity in severity_summary:
            severity_summary[
                severity
            ] += 1

    # ========================================================
    # TOP SENSORS
    # ========================================================

    sensor_event_stats: dict[
        int,
        dict[str, Any],
    ] = {}

    severity_rank = {
        "NORMAL": 0,
        "MODERATE": 1,
        "HIGH": 2,
        "CRITICAL": 3,
    }

    for event in events:

        current_sensor_id = (
            event["sensor_id"]
        )

        if (
            current_sensor_id
            not in sensor_event_stats
        ):
            sensor_event_stats[
                current_sensor_id
            ] = {
                "sensor_id": current_sensor_id,
                "sensor_code": event[
                    "sensor_code"
                ],
                "sensor_name": event[
                    "sensor_name"
                ],
                "location": event[
                    "location"
                ],
                "anomaly_count": 0,
                "highest_score": 0.0,
                "highest_peak_noise": 0.0,
                "highest_severity": "NORMAL",
                "total_duration_minutes": 0.0,
            }

        stats = sensor_event_stats[
            current_sensor_id
        ]

        stats["anomaly_count"] += 1

        stats["highest_score"] = max(
            stats["highest_score"],
            float(
                event[
                    "anomaly_score"
                ]
            ),
        )

        stats[
            "highest_peak_noise"
        ] = max(
            stats[
                "highest_peak_noise"
            ],
            float(
                event[
                    "peak_noise"
                ]
            ),
        )

        stats[
            "total_duration_minutes"
        ] += float(
            event[
                "duration_minutes"
            ]
        )

        if (
            severity_rank[
                event["severity"]
            ]
            > severity_rank[
                stats[
                    "highest_severity"
                ]
            ]
        ):
            stats[
                "highest_severity"
            ] = event[
                "severity"
            ]

    # ========================================================
    # SORT TOP SENSORS
    # ========================================================

    top_sensors = sorted(
        sensor_event_stats.values(),
        key=lambda item: (
            severity_rank[
                item[
                    "highest_severity"
                ]
            ],
            item[
                "anomaly_count"
            ],
            item[
                "highest_score"
            ],
            item[
                "highest_peak_noise"
            ],
        ),
        reverse=True,
    )

    top_sensors = [
        {
            **sensor,
            "highest_score": round(
                float(
                    sensor[
                        "highest_score"
                    ]
                ),
                1,
            ),
            "highest_peak_noise": round(
                float(
                    sensor[
                        "highest_peak_noise"
                    ]
                ),
                1,
            ),
            "total_duration_minutes": round(
                float(
                    sensor[
                        "total_duration_minutes"
                    ]
                ),
                1,
            ),
        }
        for sensor in top_sensors[:10]
    ]

    # ========================================================
    # API RESPONSE
    # ========================================================

    return {
        "analysis": {
            "period_hours": hours,
            "baseline_hours": baseline_hours,
            "sensor_id": sensor_id,
            "source": source,
            "readings_analyzed": len(
                current_readings
            ),
            "sensors_analyzed": (
                sensors_with_baseline
            ),
            "candidate_readings": len(
                candidates
            ),
            "anomaly_count": len(
                events
            ),
            "analysis_started_at": (
                min(
                    (window[0] for window in source_windows.values()),
                    default=now,
                ).isoformat()
            ),
            "analysis_completed_at": (
                max(
                    (window[1] for window in source_windows.values()),
                    default=now,
                ).isoformat()
            ),
            "analysis_windows": {
                source_name: {
                    "start": window[0].isoformat(),
                    "end": window[1].isoformat(),
                    "baseline_start": window[2].isoformat(),
                    "baseline_end": window[0].isoformat(),
                    "timeline": (
                        "historical"
                        if source_name == "dataset"
                        else "live"
                    ),
                }
                for source_name, window in source_windows.items()
            },
        },

        "severity_summary": (
            severity_summary
        ),

        "top_sensors": (
            top_sensors
        ),

        "anomalies": events[:limit],
    }


# ============================================================
# BACKWARD COMPATIBILITY
# ============================================================


def detect_anomalies(
    db: Session,
    hours: int = 24,
    baseline_hours: int = 24,
    limit: int = 20,
    sensor_id: int | None = None,
    source: str = "all",
) -> list[dict[str, Any]]:
    """
    Backward-compatible helper.

    Returns only the anomaly event list.
    """

    analysis = get_anomaly_analysis(
        db=db,
        hours=hours,
        baseline_hours=baseline_hours,
        limit=limit,
        sensor_id=sensor_id,
        source=source,
    )

    return analysis[
        "anomalies"
    ]