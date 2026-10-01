from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.services.runtime_settings import (
    DEFAULT_SETTINGS,
    invalidate_settings_cache,
)

router = APIRouter(prefix="/api/settings", tags=["Settings"])



SETTING_RULES = {
    "high_noise_threshold_db": (45.0, 200.0),
    "critical_noise_threshold_db": (45.0, 200.0),
    "day_limit_db": (0.0, 200.0),
    "night_limit_db": (0.0, 200.0),
    "simulator_interval_seconds": (1, 3600),
}


class SettingsUpdate(BaseModel):
    alert_engine_enabled: bool | None = None
    auto_resolve_enabled: bool | None = None
    high_noise_threshold_db: float | None = Field(None, ge=45, le=200)
    critical_noise_threshold_db: float | None = Field(None, ge=45, le=200)
    day_limit_db: float | None = Field(None, ge=0, le=200)
    night_limit_db: float | None = Field(None, ge=0, le=200)
    timezone: str | None = None
    ai_analysis_enabled: bool | None = None
    recommendation_engine_enabled: bool | None = None
    simulator_enabled: bool | None = None
    websocket_enabled: bool | None = None
    simulator_interval_seconds: int | None = Field(None, ge=1, le=3600)
    critical_notifications_enabled: bool | None = None
    high_notifications_enabled: bool | None = None
    browser_notifications_enabled: bool | None = None


def _ensure_table(db: Session) -> None:
    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS noiseguard_settings (
                key VARCHAR(100) PRIMARY KEY,
                value JSONB NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
    )
    db.commit()


def _load_settings(db: Session) -> dict[str, Any]:
    _ensure_table(db)

    rows = db.execute(
        text(
            """
            SELECT key, value
            FROM noiseguard_settings
            """
        )
    ).mappings().all()

    settings = dict(DEFAULT_SETTINGS)

    for row in rows:
        try:
            settings[str(row["key"])] = row["value"]
        except Exception:
            continue

    return settings


def validate_settings(settings: dict[str, Any]) -> None:
    high = float(settings["high_noise_threshold_db"])
    critical = float(settings["critical_noise_threshold_db"])

    if critical <= high:
        raise HTTPException(
            status_code=422,
            detail=(
                "critical_noise_threshold_db must be greater than "
                "high_noise_threshold_db"
            ),
        )

    for key, (minimum, maximum) in SETTING_RULES.items():
        value = float(settings[key])

        if not minimum <= value <= maximum:
            raise HTTPException(
                status_code=422,
                detail=f"{key} must be between {minimum} and {maximum}",
            )

    timezone_name = str(settings["timezone"]).strip()

    if not timezone_name:
        raise HTTPException(
            status_code=422,
            detail="timezone cannot be empty",
        )

    try:
        ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown timezone: {timezone_name}",
        )


@router.get("")
def get_settings(db: Session = Depends(get_db)):
    settings = _load_settings(db)
    validate_settings(settings)

    return {
        "settings": settings,
        "defaults": DEFAULT_SETTINGS,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


@router.put("")
def update_settings(
    payload: SettingsUpdate,
    db: Session = Depends(get_db),
):
    settings = _load_settings(db)
    updates = payload.model_dump(exclude_none=True)

    settings.update(updates)
    validate_settings(settings)

    for key, value in updates.items():
        db.execute(
            text(
                """
                INSERT INTO noiseguard_settings (key, value, updated_at)
                VALUES (:key, CAST(:value AS JSONB), NOW())
                ON CONFLICT (key)
                DO UPDATE SET
                    value = EXCLUDED.value,
                    updated_at = NOW()
                """
            ),
            {
                "key": key,
                "value": json.dumps(value),
            },
        )

    db.commit()
    invalidate_settings_cache()

    saved_settings = _load_settings(db)
    validate_settings(saved_settings)

    return {
        "message": "Settings saved successfully",
        "settings": saved_settings,
        "saved_keys": list(updates.keys()),
    }


@router.post("/reset")
def reset_settings(db: Session = Depends(get_db)):
    _ensure_table(db)

    db.execute(text("DELETE FROM noiseguard_settings"))

    for key, value in DEFAULT_SETTINGS.items():
        db.execute(
            text(
                """
                INSERT INTO noiseguard_settings (key, value, updated_at)
                VALUES (:key, CAST(:value AS JSONB), NOW())
                """
            ),
            {
                "key": key,
                "value": json.dumps(value),
            },
        )

    db.commit()
    invalidate_settings_cache()

    return {
        "message": "Settings restored to defaults",
        "settings": _load_settings(db),
    }
