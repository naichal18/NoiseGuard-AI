from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.services.runtime_settings import DEFAULT_SETTINGS, invalidate_settings_cache

router = APIRouter(prefix="/api/system-config", tags=["System Configuration"])

BASE_DIR = Path(__file__).resolve().parents[2]
BACKUP_DIR = BASE_DIR / "backups"

SYSTEM_DEFAULTS: dict[str, Any] = {
    "app_name": "NoiseGuard AI",
    "environment": "Development",
    "log_level": "INFO",
    "timezone": "Asia/Kolkata",
    "host": "0.0.0.0",
    "port": 8000,
    "workers": 4,
    "reload_dev": True,
    "database_type": "Configured by backend",
    "database_url": "Configured by backend",
    "auto_backup": True,
    "backup_interval_hours": 24,
    "default_interval_seconds": 5,
    "max_sensors": 100,
    "sensor_timeout_seconds": 30,
    "auto_discover": True,
    "readings_retention_days": 90,
    "alerts_retention_days": 180,
    "logs_retention_days": 30,
    "auto_cleanup": True,
    "enable_cors": True,
    "allowed_origins": "http://localhost:3000,http://127.0.0.1:3000",
    "api_key_required": False,
    "rate_limit_per_minute": 100,
}

RUNTIME_KEYS = {
    "timezone",
    "simulator_enabled",
    "websocket_enabled",
    "simulator_interval_seconds",
    "ai_analysis_enabled",
    "recommendation_engine_enabled",
    "high_noise_threshold_db",
    "critical_noise_threshold_db",
}

SYSTEM_KEYS = set(SYSTEM_DEFAULTS)


class SystemConfigUpdate(BaseModel):
    app_name: str = Field(min_length=1, max_length=100)
    environment: str = Field(min_length=1, max_length=30)
    log_level: str = Field(min_length=1, max_length=20)
    timezone: str = Field(min_length=1, max_length=100)
    host: str = Field(min_length=1, max_length=100)
    port: int = Field(ge=1, le=65535)
    workers: int = Field(ge=1, le=64)
    reload_dev: bool
    database_type: str = Field(min_length=1, max_length=50)
    database_url: str = Field(min_length=1, max_length=500)
    auto_backup: bool
    backup_interval_hours: int = Field(ge=1, le=8760)
    default_interval_seconds: int = Field(ge=1, le=3600)
    max_sensors: int = Field(ge=1, le=10000)
    sensor_timeout_seconds: int = Field(ge=1, le=86400)
    auto_discover: bool
    readings_retention_days: int = Field(ge=1, le=3650)
    alerts_retention_days: int = Field(ge=1, le=3650)
    logs_retention_days: int = Field(ge=1, le=3650)
    auto_cleanup: bool
    enable_cors: bool
    allowed_origins: str = Field(min_length=1, max_length=4000)
    api_key_required: bool
    rate_limit_per_minute: int = Field(ge=1, le=100000)
    simulator_enabled: bool = True
    websocket_enabled: bool = True
    ai_analysis_enabled: bool = True
    recommendation_engine_enabled: bool = True
    high_noise_threshold_db: float = Field(ge=45, le=200)
    critical_noise_threshold_db: float = Field(ge=45, le=200)


def _ensure_tables(db: Session) -> None:
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


def _load_all_settings(db: Session) -> dict[str, Any]:
    _ensure_tables(db)
    rows = db.execute(
        text("SELECT key, value FROM noiseguard_settings")
    ).mappings().all()
    settings = dict(DEFAULT_SETTINGS)
    settings.update(SYSTEM_DEFAULTS)
    for row in rows:
        settings[str(row["key"])] = row["value"]
    return settings


def _save_value(db: Session, key: str, value: Any) -> None:
    db.execute(
        text(
            """
            INSERT INTO noiseguard_settings (key, value, updated_at)
            VALUES (:key, CAST(:value AS JSONB), NOW())
            ON CONFLICT (key)
            DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
            """
        ),
        {"key": key, "value": json.dumps(value)},
    )


def _append_log(db: Session, level: str, message: str) -> list[dict[str, str]]:
    settings = _load_all_settings(db)
    current = settings.get("system_logs", [])
    if not isinstance(current, list):
        current = []
    logs = [item for item in current if isinstance(item, dict)][-99:]
    logs.append(
        {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": level,
            "message": message,
        }
    )
    _save_value(db, "system_logs", logs)
    db.commit()
    return logs


def _runtime_config(settings: dict[str, Any]) -> dict[str, Any]:
    return {
        "simulator_enabled": bool(settings.get("simulator_enabled", True)),
        "websocket_enabled": bool(settings.get("websocket_enabled", True)),
        "ai_analysis_enabled": bool(settings.get("ai_analysis_enabled", True)),
        "recommendation_engine_enabled": bool(settings.get("recommendation_engine_enabled", True)),
        "high_noise_threshold_db": float(settings.get("high_noise_threshold_db", 85)),
        "critical_noise_threshold_db": float(settings.get("critical_noise_threshold_db", 95)),
    }


def _get_config(settings: dict[str, Any]) -> dict[str, Any]:
    # Start with defaults, then overlay every persisted System Config value.
    # Runtime settings use their dedicated keys below. This is important for
    # fields such as backup_interval_hours, retention, CORS, etc.; otherwise
    # they would save to the database but immediately appear as defaults again.
    config = dict(SYSTEM_DEFAULTS)
    for key in SYSTEM_KEYS:
        if key in settings:
            config[key] = settings[key]

    config.update(_runtime_config(settings))
    config["timezone"] = str(settings.get("timezone", config["timezone"]))
    config["default_interval_seconds"] = int(
        settings.get("simulator_interval_seconds", config["default_interval_seconds"])
    )
    return config


def _database_metadata(db: Session) -> tuple[str, str]:
    """Return the active SQLAlchemy database dialect and a safe URL.

    The password is intentionally hidden so the System Configuration screen
    never exposes database credentials to the browser.
    """
    bind = db.get_bind()
    dialect = str(bind.dialect.name or "unknown").lower()
    try:
        safe_url = bind.url.render_as_string(hide_password=True)
    except Exception:
        safe_url = str(bind.url)
    return dialect, safe_url


def _status(db: Session) -> dict[str, Any]:
    sensor_count = 0
    database_online = True
    try:
        db.execute(text("SELECT 1"))
        result = db.execute(text("SELECT COUNT(*) AS count FROM sensors")).scalar()
        sensor_count = int(result or 0)
    except Exception:
        database_online = False

    settings = _load_all_settings(db)
    return {
        "system": "ONLINE",
        "api": "CONNECTED",
        "database": "ONLINE" if database_online else "OFFLINE",
        "stream": "LIVE" if bool(settings.get("websocket_enabled", True)) else "OFF",
        "sensor_count": sensor_count,
    }


@router.get("")
def get_system_config(db: Session = Depends(get_db)):
    settings = _load_all_settings(db)
    logs = settings.get("system_logs", [])
    if not isinstance(logs, list):
        logs = []

    config = _get_config(settings)
    database_type, database_url = _database_metadata(db)
    # Always report the database that is actually serving this request.
    # Persisted database_type/database_url values are configuration metadata
    # and cannot switch the live SQLAlchemy engine by themselves.
    config["database_type"] = database_type
    config["database_url"] = database_url

    return {
        "config": config,
        "logs": logs[-100:],
        "status": _status(db),
    }


@router.put("")
def update_system_config(payload: SystemConfigUpdate, db: Session = Depends(get_db)):
    if payload.critical_noise_threshold_db <= payload.high_noise_threshold_db:
        raise HTTPException(
            status_code=422,
            detail="critical_noise_threshold_db must be greater than high_noise_threshold_db",
        )

    values = payload.model_dump()
    runtime_values = {
        "timezone": values["timezone"],
        "simulator_enabled": values["simulator_enabled"],
        "websocket_enabled": values["websocket_enabled"],
        "simulator_interval_seconds": values["default_interval_seconds"],
        "ai_analysis_enabled": values["ai_analysis_enabled"],
        "recommendation_engine_enabled": values["recommendation_engine_enabled"],
        "high_noise_threshold_db": values["high_noise_threshold_db"],
        "critical_noise_threshold_db": values["critical_noise_threshold_db"],
    }

    for key in SYSTEM_KEYS:
        if key in values:
            _save_value(db, key, values[key])

    for key, value in runtime_values.items():
        _save_value(db, key, value)

    restart_required = any(
        values[key] != SYSTEM_DEFAULTS[key]
        for key in ("host", "port", "workers", "reload_dev", "enable_cors", "allowed_origins", "api_key_required")
    )

    logs = _append_log(db, "INFO", "System configuration saved")
    invalidate_settings_cache()
    settings = _load_all_settings(db)
    config = _get_config(settings)
    database_type, database_url = _database_metadata(db)
    config["database_type"] = database_type
    config["database_url"] = database_url
    return {
        "message": "System configuration saved",
        "config": config,
        "logs": logs[-100:],
        "status": _status(db),
        "restart_required": restart_required,
    }


@router.post("/actions/backup-database")
def backup_database(db: Session = Depends(get_db)):
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    output = BACKUP_DIR / f"noiseguard_backup_{timestamp}.json"

    inspector = inspect(db.get_bind())
    tables = inspector.get_table_names()
    backup: dict[str, Any] = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "service": "NoiseGuard AI",
        "tables": {},
    }

    for table in tables:
        if table == "noiseguard_settings":
            continue
        rows = db.execute(text(f'SELECT * FROM "{table}"')).mappings().all()
        backup["tables"][table] = [dict(row) for row in rows]

    output.write_text(json.dumps(backup, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    logs = _append_log(db, "INFO", f"Database backup created: {output.name}")
    return {"message": f"DATABASE_BACKUP_CREATED: {output.name}", "logs": logs[-100:]}


@router.post("/actions/clear-logs")
def clear_logs(db: Session = Depends(get_db)):
    _save_value(db, "system_logs", [])
    db.commit()
    logs = _append_log(db, "INFO", "System logs cleared")
    return {"message": "SYSTEM_LOGS_CLEARED", "logs": logs[-100:]}


@router.post("/actions/factory-reset")
def factory_reset(db: Session = Depends(get_db)):
    _ensure_tables(db)
    for key, value in {**SYSTEM_DEFAULTS, **DEFAULT_SETTINGS}.items():
        _save_value(db, key, value)
    logs = _append_log(db, "WARN", "Factory reset completed; default configuration restored")
    invalidate_settings_cache()
    settings = _load_all_settings(db)
    config = _get_config(settings)
    database_type, database_url = _database_metadata(db)
    config["database_type"] = database_type
    config["database_url"] = database_url
    return {
        "message": "FACTORY_RESET_COMPLETED",
        "config": config,
        "logs": logs[-100:],
        "restart_required": True,
    }


@router.post("/actions/restart")
def restart_server(db: Session = Depends(get_db)):
    # A FastAPI endpoint cannot safely replace the current uvicorn process across
    # Windows/Linux/dev/prod launchers. Record an explicit restart request instead
    # of killing the server and leaving the dashboard offline.
    logs = _append_log(db, "WARN", "Server restart requested; restart the backend process to apply static server settings")
    return {
        "message": "RESTART_REQUESTED :: BACKEND_PROCESS_RESTART_REQUIRED",
        "logs": logs[-100:],
        "restart_required": True,
        "process_id": os.getpid(),
        "python": sys.version.split()[0],
    }
