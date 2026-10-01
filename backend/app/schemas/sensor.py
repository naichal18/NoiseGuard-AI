from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class SensorBase(BaseModel):
    sensor_code: str = Field(min_length=1, max_length=50)
    name: str = Field(min_length=1, max_length=100)
    location: str = Field(min_length=1, max_length=255)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    current_noise_level: float = Field(default=0.0, ge=0)
    status: str = Field(default="offline", min_length=1, max_length=20)
    is_active: bool = True


class SensorCreate(SensorBase):
    pass


class SensorUpdate(BaseModel):
    sensor_code: str | None = Field(default=None, min_length=1, max_length=50)
    name: str | None = Field(default=None, min_length=1, max_length=100)
    location: str | None = Field(default=None, min_length=1, max_length=255)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    current_noise_level: float | None = Field(default=None, ge=0)
    status: str | None = Field(default=None, min_length=1, max_length=20)
    is_active: bool | None = None


class SensorResponse(SensorBase):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)