from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


# ============================================================
# CONFIGURATION
# ============================================================

DEFAULT_CONFIDENCE = 70

SEVERITY_PRIORITY = {
    "NORMAL": "LOW",
    "MODERATE": "MEDIUM",
    "HIGH": "HIGH",
    "CRITICAL": "CRITICAL",
}


# ============================================================
# HELPERS
# ============================================================


def _safe_float(
    value: Any,
    default: float = 0.0,
) -> float:
    try:
        if value is None:
            return default

        return float(value)

    except (TypeError, ValueError):
        return default


def _safe_int(
    value: Any,
    default: int = 0,
) -> int:
    try:
        if value is None:
            return default

        return int(value)

    except (TypeError, ValueError):
        return default


def _first_float(
    anomaly: dict[str, Any],
    *keys: str,
    default: float = 0.0,
) -> float:
    """
    Read the first available numeric field.

    This keeps the recommendation engine compatible with
    both the original anomaly detector field names and the
    normalized AI-analysis field names.
    """

    for key in keys:
        if key not in anomaly:
            continue

        value = anomaly.get(key)

        if value is None:
            continue

        try:
            return float(value)
        except (TypeError, ValueError):
            continue

    return default


def _normalise_severity(
    severity: Any,
) -> str:
    value = str(
        severity or "NORMAL"
    ).upper().strip()

    if value not in SEVERITY_PRIORITY:
        return "NORMAL"

    return value


def _normalise_event_type(
    event_type: Any,
) -> str:
    value = str(
        event_type or "ANOMALOUS_NOISE"
    ).upper().strip()

    return value


# ============================================================
# CONFIDENCE
# ============================================================


def _calculate_confidence(
    anomaly_score: float,
    severity: str,
    reading_count: int,
    duration_minutes: float,
) -> int:
    """
    Estimate recommendation confidence from anomaly evidence.

    This is not a fabricated probability.

    It is an evidence-confidence score derived from:
        - anomaly score
        - severity
        - persistence
        - duration
    """

    confidence = 40.0

    confidence += (
        min(
            max(anomaly_score, 0.0),
            100.0,
        )
        * 0.35
    )

    if severity == "CRITICAL":
        confidence += 15.0

    elif severity == "HIGH":
        confidence += 10.0

    elif severity == "MODERATE":
        confidence += 5.0

    if reading_count >= 3:
        confidence += min(
            reading_count * 0.5,
            10.0,
        )

    if duration_minutes >= 10:
        confidence += 8.0

    elif duration_minutes >= 1:
        confidence += 4.0

    return int(
        max(
            0,
            min(
                99,
                round(confidence),
            ),
        )
    )


# ============================================================
# EVENT-SPECIFIC RECOMMENDATIONS
# ============================================================


def _recommendation_for_event(
    event_type: str,
    severity: str,
    peak_noise: float,
    duration_minutes: float,
) -> dict[str, str]:
    """
    Generate a context-specific operational recommendation.

    The recommendation is based on:
        - detected event type
        - measured peak noise
        - severity
        - persistence
    """

    # --------------------------------------------------------
    # TRAFFIC
    # --------------------------------------------------------

    if event_type == "TRAFFIC_SPIKE":

        if severity == "CRITICAL":
            return {
                "recommendation": (
                    "Investigate severe traffic-related noise "
                    "around the monitored zone immediately."
                ),
                "action": (
                    "Inspect traffic congestion, road activity "
                    "and nearby high-noise sources. Consider "
                    "traffic-control intervention if the event "
                    "persists."
                ),
            }

        return {
            "recommendation": (
                "Investigate sustained traffic activity "
                "contributing to elevated noise levels."
            ),
            "action": (
                "Review traffic flow and identify congestion "
                "or repeated vehicle-noise hotspots."
            ),
        }

    # --------------------------------------------------------
    # CONSTRUCTION
    # --------------------------------------------------------

    if event_type == "CONSTRUCTION_SPIKE":

        if severity == "CRITICAL":
            return {
                "recommendation": (
                    "Inspect nearby construction activity for "
                    "severe and potentially non-compliant noise."
                ),
                "action": (
                    "Verify construction schedules, equipment "
                    "operation and applicable noise restrictions."
                ),
            }

        return {
            "recommendation": (
                "Review nearby construction activity as the "
                "likely contributor to elevated noise."
            ),
            "action": (
                "Check operating hours and high-noise machinery "
                "at nearby construction sites."
            ),
        }

    # --------------------------------------------------------
    # HONKING
    # --------------------------------------------------------

    if event_type == "HONK_EVENT":

        return {
            "recommendation": (
                "Investigate repeated vehicle-horn activity "
                "in the monitored area."
            ),
            "action": (
                "Review traffic congestion, intersections and "
                "possible recurring horn-use hotspots."
            ),
        }

    # --------------------------------------------------------
    # EMERGENCY SIREN
    # --------------------------------------------------------

    if event_type == "EMERGENCY_SIREN":

        return {
            "recommendation": (
                "Correlate the elevated noise with emergency "
                "vehicle activity before taking enforcement action."
            ),
            "action": (
                "Cross-check emergency response activity and "
                "avoid treating the event as a routine violation."
            ),
        }

    # --------------------------------------------------------
    # EXTREME NOISE
    # --------------------------------------------------------

    if event_type == "EXTREME_NOISE_EVENT":

        if severity == "CRITICAL":
            return {
                "recommendation": (
                    "Investigate the extreme noise event "
                    "immediately."
                ),
                "action": (
                    "Verify the sensor reading, identify the "
                    "nearby source and escalate for field "
                    "inspection if the event is confirmed."
                ),
            }

        return {
            "recommendation": (
                "Investigate the source of the detected "
                "extreme noise event."
            ),
            "action": (
                "Check nearby activity and verify whether the "
                "event is isolated or recurring."
            ),
        }

    # --------------------------------------------------------
    # GENERIC EXTREME NOISE
    # --------------------------------------------------------

    if peak_noise >= 100:

        return {
            "recommendation": (
                "Investigate the extreme noise anomaly "
                "immediately."
            ),
            "action": (
                "Verify the measurement and identify the "
                "source responsible for the extreme level."
            ),
        }

    # --------------------------------------------------------
    # SUSTAINED NOISE
    # --------------------------------------------------------

    if duration_minutes >= 10:

        return {
            "recommendation": (
                "Investigate the sustained elevated noise "
                "pattern in the monitored zone."
            ),
            "action": (
                "Review nearby traffic, construction and "
                "commercial activity for persistent sources."
            ),
        }

    # --------------------------------------------------------
    # GENERIC ANOMALY
    # --------------------------------------------------------

    return {
        "recommendation": (
            "Investigate the detected deviation from the "
            "historical noise baseline."
        ),
        "action": (
            "Review nearby activity and continue monitoring "
            "the sensor for recurrence."
        ),
    }


# ============================================================
# BUILD RECOMMENDATION
# ============================================================


def build_recommendation(
    anomaly: dict[str, Any],
) -> dict[str, Any]:
    """
    Convert one anomaly event into an actionable
    NoiseGuard AI recommendation.

    Important:
    The returned object contains both the original detector
    field names and normalized AI-analysis field names.
    """

    # ========================================================
    # BASIC EVENT DATA
    # ========================================================

    severity = _normalise_severity(
        anomaly.get("severity")
    )

    event_type = _normalise_event_type(
        anomaly.get("event_type")
    )

    # ========================================================
    # NOISE VALUES
    # ========================================================

    peak_noise = _first_float(
        anomaly,
        "peak_noise",
    )

    average_noise = _first_float(
        anomaly,
        "average_noise",
    )

    # ========================================================
    # BASELINE
    #
    # Support both:
    #
    # baseline_noise
    # baseline_mean
    # ========================================================

    baseline_noise = _first_float(
        anomaly,
        "baseline_noise",
        "baseline_mean",
    )

    # ========================================================
    # STANDARD DEVIATION
    #
    # Support both:
    #
    # baseline_std_dev
    # baseline_std
    # ========================================================

    baseline_std_dev = _first_float(
        anomaly,
        "baseline_std_dev",
        "baseline_std",
    )

    # ========================================================
    # Z SCORE
    #
    # Support both:
    #
    # z_score
    # peak_z_score
    # ========================================================

    z_score = _first_float(
        anomaly,
        "z_score",
        "peak_z_score",
    )

    # ========================================================
    # PERCENTAGE DEVIATION
    #
    # Support both:
    #
    # deviation_percentage
    # percentage_deviation
    # peak_percentage_deviation
    # ========================================================

    percentage_deviation = _first_float(
        anomaly,
        "deviation_percentage",
        "percentage_deviation",
        "peak_percentage_deviation",
    )

    # ========================================================
    # ABSOLUTE DEVIATION
    #
    # Prefer detector-provided deviation_db.
    # Otherwise calculate it from peak - baseline.
    # ========================================================

    if (
        "deviation_db" in anomaly
        and anomaly.get("deviation_db") is not None
    ):
        deviation_db = _safe_float(
            anomaly.get("deviation_db")
        )

    else:
        deviation_db = (
            peak_noise
            - baseline_noise
        )

    # ========================================================
    # SCORE
    # ========================================================

    anomaly_score = _first_float(
        anomaly,
        "anomaly_score",
        "score",
    )

    # ========================================================
    # PERSISTENCE
    # ========================================================

    duration_minutes = _safe_float(
        anomaly.get(
            "duration_minutes"
        )
    )

    reading_count = _safe_int(
        anomaly.get(
            "reading_count"
        ),
        default=1,
    )

    # ========================================================
    # RECOMMENDATION
    # ========================================================

    recommendation_data = (
        _recommendation_for_event(
            event_type=event_type,
            severity=severity,
            peak_noise=peak_noise,
            duration_minutes=duration_minutes,
        )
    )

    recommendation = (
        recommendation_data[
            "recommendation"
        ]
    )

    action = (
        recommendation_data[
            "action"
        ]
    )

    # ========================================================
    # CONFIDENCE
    # ========================================================

    confidence = _calculate_confidence(
        anomaly_score=anomaly_score,
        severity=severity,
        reading_count=reading_count,
        duration_minutes=duration_minutes,
    )

    # ========================================================
    # PRIORITY
    # ========================================================

    priority = SEVERITY_PRIORITY[
        severity
    ]

    # ========================================================
    # SENSOR METADATA
    # ========================================================

    sensor_code = str(
        anomaly.get(
            "sensor_code",
            "UNKNOWN",
        )
        or "UNKNOWN"
    )

    sensor_name = str(
        anomaly.get(
            "sensor_name",
            "Unknown Sensor",
        )
        or "Unknown Sensor"
    )

    location = str(
        anomaly.get(
            "location",
            "Unknown Location",
        )
        or "Unknown Location"
    )

    source = str(
        anomaly.get(
            "source",
            "unknown",
        )
        or "unknown"
    )

    # ========================================================
    # EVIDENCE
    # ========================================================

    evidence = (
        f"{peak_noise:.1f} dB peak noise "
        f"vs {baseline_noise:.1f} dB historical baseline; "
        f"{percentage_deviation:+.1f}% deviation; "
        f"z-score {z_score:+.2f}; "
        f"{duration_minutes:.1f} minute duration; "
        f"{reading_count} reading(s)."
    )

    # ========================================================
    # RETURN
    # ========================================================

    return {
        # ----------------------------------------------------
        # IDENTIFICATION
        # ----------------------------------------------------

        "recommendation_id": (
            f"rec-{anomaly.get('event_id', 'unknown')}"
        ),

        "generated_at": (
            datetime.now(
                timezone.utc
            ).isoformat()
        ),

        "sensor_id": anomaly.get(
            "sensor_id"
        ),

        "sensor_code": sensor_code,

        "sensor_name": sensor_name,

        "location": location,

        "event_id": anomaly.get(
            "event_id"
        ),

        "event_type": event_type,

        "source": source,

        # ----------------------------------------------------
        # SEVERITY
        # ----------------------------------------------------

        "severity": severity,

        "priority": priority,

        # ----------------------------------------------------
        # AI SCORE
        # ----------------------------------------------------

        "anomaly_score": round(
            anomaly_score,
            1,
        ),

        "confidence": confidence,

        # ----------------------------------------------------
        # NOISE METRICS
        # ----------------------------------------------------

        "peak_noise": round(
            peak_noise,
            1,
        ),

        "average_noise": round(
            average_noise,
            1,
        ),

        # ----------------------------------------------------
        # ORIGINAL FIELD NAMES
        #
        # Preserve compatibility with existing backend code.
        # ----------------------------------------------------

        "baseline_mean": round(
            baseline_noise,
            1,
        ),

        "baseline_std": round(
            baseline_std_dev,
            1,
        ),

        "peak_z_score": round(
            z_score,
            2,
        ),

        "percentage_deviation": round(
            percentage_deviation,
            1,
        ),

        # ----------------------------------------------------
        # NORMALIZED AI FIELD NAMES
        #
        # These are consumed by AIAnalysisPanel.tsx.
        # ----------------------------------------------------

        "baseline_noise": round(
            baseline_noise,
            1,
        ),

        "baseline_std_dev": round(
            baseline_std_dev,
            1,
        ),

        "z_score": round(
            z_score,
            2,
        ),

        "deviation_db": round(
            deviation_db,
            1,
        ),

        "deviation_percentage": round(
            percentage_deviation,
            1,
        ),

        # ----------------------------------------------------
        # EVENT PERSISTENCE
        # ----------------------------------------------------

        "duration_minutes": round(
            duration_minutes,
            1,
        ),

        "reading_count": reading_count,

        # ----------------------------------------------------
        # AI OUTPUT
        # ----------------------------------------------------

        "recommendation": recommendation,

        "action": action,

        "evidence": evidence,
    }


# ============================================================
# BUILD RECOMMENDATIONS
# ============================================================


def build_recommendations(
    anomalies: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """
    Generate recommendations for all detected anomaly events.
    """

    recommendations = [
        build_recommendation(
            anomaly
        )
        for anomaly in anomalies
    ]

    # --------------------------------------------------------
    # Highest priority first.
    # --------------------------------------------------------

    recommendations.sort(
        key=lambda item: (
            item["severity"] == "CRITICAL",
            item["severity"] == "HIGH",
            item["confidence"],
            item["anomaly_score"],
        ),
        reverse=True,
    )

    return recommendations