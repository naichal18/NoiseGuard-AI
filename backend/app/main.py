from __future__ import annotations

import json
from typing import Any

from fastapi import Depends, FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from sqlalchemy.orm import Session

from app.api.alerts import router as alerts_router
from app.api.analytics import router as analytics_router
from app.api.ai import router as ai_router
from app.api.dashboard import router as dashboard_router
from app.api.readings import router as readings_router
from app.api.reports import router as reports_router
from app.api.sensors import router as sensors_router
from app.api.settings import router as settings_router
from app.api.system_config import router as system_config_router
from app.api.violations import router as violations_router
from app.core.database import SessionLocal, get_db
from app.services.runtime_settings import get_runtime_settings
from app.services.websocket_manager import websocket_manager

app = FastAPI(
    title="NoiseGuard AI",
    description="Smart-city noise monitoring and AI analytics platform",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# SETTINGS-AWARE AI ANALYTICS GUARD
# ---------------------------------------------------------------------------
# The SettingsPanel already persists ai_analysis_enabled and
# recommendation_engine_enabled correctly. The problem was that the separate
# analytics endpoint used by the AI Analysis screen did not consume those
# runtime settings. Keep the existing analytics router untouched and enforce
# the two AI switches at the HTTP boundary instead.
# ---------------------------------------------------------------------------

_AI_ANALYTICS_PATHS = {
    "/api/analytics/anomalies",
    "/api/analytics/recommendations",
}
_RECOMMENDATION_PATH = "/api/analytics/recommendations"


def _remove_recommendation_output(value: Any) -> Any:
    """Remove recommendation-engine output without removing anomaly data."""
    if isinstance(value, list):
        return [_remove_recommendation_output(item) for item in value]

    if not isinstance(value, dict):
        return value

    blocked_keys = {
        "recommendations",
        "recommendation_count",
        "top_recommendation",
        "recommendation_engine",
        "historical_recommendation_analysis",
    }

    return {
        key: _remove_recommendation_output(item)
        for key, item in value.items()
        if key not in blocked_keys
    }


@app.middleware("http")
async def ai_settings_guard(request: Request, call_next):
    path = request.url.path.rstrip("/") or "/"

    if path not in _AI_ANALYTICS_PATHS:
        return await call_next(request)

    # Use the same runtime-settings source as the rest of the backend.
    db = SessionLocal()
    try:
        settings = get_runtime_settings(db)

        if not bool(settings.get("ai_analysis_enabled", True)):
            return JSONResponse(
                status_code=503,
                content={
                    "detail": "AI analysis is disabled in NoiseGuard Settings.",
                    "setting": "ai_analysis_enabled",
                    "status": "disabled",
                },
            )

        response = await call_next(request)

        # Recommendation Engine is independent from AI Analysis. When it is
        # OFF, anomaly analysis must still work, but recommendation output must
        # not be returned by the recommendation endpoint.
        if (
            path == _RECOMMENDATION_PATH
            and not bool(
                settings.get("recommendation_engine_enabled", True)
            )
            and response.status_code < 400
        ):
            content_type = response.headers.get("content-type", "")

            if "application/json" in content_type:
                body = b""
                async for chunk in response.body_iterator:
                    body += chunk

                try:
                    payload = json.loads(body.decode("utf-8"))
                    payload = _remove_recommendation_output(payload)
                    payload["recommendation_engine_enabled"] = False
                    payload["recommendation_status"] = "disabled"
                    return JSONResponse(
                        status_code=response.status_code,
                        content=payload,
                        headers={
                            key: value
                            for key, value in response.headers.items()
                            if key.lower()
                            not in {
                                "content-length",
                                "content-type",
                            }
                        },
                    )
                except (UnicodeDecodeError, json.JSONDecodeError, TypeError):
                    # Preserve the original response if it is not a JSON
                    # payload we can safely transform.
                    return Response(
                        content=body,
                        status_code=response.status_code,
                        headers={
                            key: value
                            for key, value in response.headers.items()
                            if key.lower() != "content-length"
                        },
                        media_type=None,
                    )

        return response
    finally:
        db.close()


app.include_router(alerts_router)
app.include_router(analytics_router)
app.include_router(ai_router)
app.include_router(dashboard_router)
app.include_router(readings_router)
app.include_router(reports_router)
app.include_router(sensors_router)
app.include_router(settings_router)
app.include_router(system_config_router)
app.include_router(violations_router)


@app.get("/")
def root():
    return {
        "service": "NoiseGuard AI",
        "status": "online",
        "message": "NoiseGuard AI backend is running",
    }


@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "service": "NoiseGuard AI",
    }


@app.websocket("/ws/noise")
async def noise_websocket(
    websocket: WebSocket,
    db: Session = Depends(get_db),
):
    settings = get_runtime_settings(db)

    if not bool(settings.get("websocket_enabled", True)):
        await websocket.close(
            code=1008,
            reason="WebSocket stream disabled in NoiseGuard Settings",
        )
        return

    await websocket_manager.connect(websocket)

    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        websocket_manager.disconnect(websocket)
    except Exception:
        websocket_manager.disconnect(websocket)
