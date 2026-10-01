from __future__ import annotations

import time
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session


DEFAULT_SETTINGS: dict[str, Any] = {
    "alert_engine_enabled": True,
    "auto_resolve_enabled": True,
    "high_noise_threshold_db": 85.0,
    "critical_noise_threshold_db": 95.0,
    "day_limit_db": 55.0,
    "night_limit_db": 45.0,
    "timezone": "Asia/Kolkata",
    "ai_analysis_enabled": True,
    "recommendation_engine_enabled": True,
    "simulator_enabled": True,
    "websocket_enabled": True,
    "simulator_interval_seconds": 5,
    "critical_notifications_enabled": True,
    "high_notifications_enabled": True,
    "browser_notifications_enabled": False,
}


_CACHE_TTL_SECONDS = 1.0

_settings_cache: dict[str, Any] | None = None
_settings_cache_expires_at = 0.0


def invalidate_settings_cache() -> None:
    global _settings_cache, _settings_cache_expires_at

    _settings_cache = None
    _settings_cache_expires_at = 0.0


def get_runtime_settings(db: Session) -> dict[str, Any]:
    global _settings_cache, _settings_cache_expires_at

    # Settings are normally created by /api/settings, but runtime consumers
    # must also be safe during a fresh backend start before that endpoint has
    # ever been opened.
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

    now = time.monotonic()

    if _settings_cache is not None and now < _settings_cache_expires_at:
        return dict(_settings_cache)

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
        settings[str(row["key"])] = row["value"]

    _settings_cache = settings
    _settings_cache_expires_at = now + _CACHE_TTL_SECONDS

    return dict(settings)
