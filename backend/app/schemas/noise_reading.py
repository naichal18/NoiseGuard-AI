from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class NoiseReadingCreate(BaseModel):
    sensor_id: int = Field(gt=0)
    noise_level: float = Field(ge=0, le=200)
    recorded_at: datetime | None = None
    source: str = Field(default="sensor", min_length=1, max_length=20)
    event_type: str = Field(
        default="NORMAL_ACTIVITY",
        min_length=1,
        max_length=50,
    )


class NoiseReadingResponse(BaseModel):
    id: int
    sensor_id: int
    noise_level: float
    recorded_at: datetime
    source: str
    event_type: str

    model_config = ConfigDict(from_attributes=True)