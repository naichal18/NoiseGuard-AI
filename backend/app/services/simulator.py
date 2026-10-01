import json
import math
import random
import time
from datetime import datetime
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo


API_BASE_URL = "http://127.0.0.1:8000"
DEFAULT_INTERVAL_SECONDS = 5
SETTINGS_REFRESH_SECONDS = 2


CITY_PROFILES = {
    # Existing Delhi sensors — preserved from the original simulator.
    "connaught place": {"baseline": 74.0, "variation": 1.8, "traffic": 0.06, "construction": 0.03, "timezone": "Asia/Kolkata"},
    "anand vihar": {"baseline": 78.0, "variation": 2.0, "traffic": 0.08, "construction": 0.03, "timezone": "Asia/Kolkata"},
    "dwarka": {"baseline": 62.0, "variation": 1.5, "traffic": 0.03, "construction": 0.02, "timezone": "Asia/Kolkata"},
    "rohini": {"baseline": 69.0, "variation": 1.8, "traffic": 0.05, "construction": 0.03, "timezone": "Asia/Kolkata"},
    "saket": {"baseline": 70.0, "variation": 1.8, "traffic": 0.05, "construction": 0.03, "timezone": "Asia/Kolkata"},
    "lajpat nagar": {"baseline": 76.0, "variation": 2.0, "traffic": 0.07, "construction": 0.03, "timezone": "Asia/Kolkata"},

    # Global city profiles used by the simulator. Values are simulation
    # baselines, not claims of live physical measurements.
    "mumbai": {"baseline": 76.0, "variation": 2.1, "traffic": 0.08, "construction": 0.04, "timezone": "Asia/Kolkata"},
    "bengaluru": {"baseline": 72.0, "variation": 2.0, "traffic": 0.07, "construction": 0.04, "timezone": "Asia/Kolkata"},
    "kolkata": {"baseline": 73.0, "variation": 2.0, "traffic": 0.07, "construction": 0.03, "timezone": "Asia/Kolkata"},
    "singapore": {"baseline": 68.0, "variation": 1.6, "traffic": 0.05, "construction": 0.03, "timezone": "Asia/Singapore"},
    "tokyo": {"baseline": 70.0, "variation": 1.7, "traffic": 0.06, "construction": 0.03, "timezone": "Asia/Tokyo"},
    "seoul": {"baseline": 71.0, "variation": 1.8, "traffic": 0.06, "construction": 0.03, "timezone": "Asia/Seoul"},
    "beijing": {"baseline": 73.0, "variation": 1.9, "traffic": 0.07, "construction": 0.03, "timezone": "Asia/Shanghai"},
    "bangkok": {"baseline": 75.0, "variation": 2.0, "traffic": 0.08, "construction": 0.03, "timezone": "Asia/Bangkok"},
    "dubai": {"baseline": 72.0, "variation": 1.9, "traffic": 0.07, "construction": 0.04, "timezone": "Asia/Dubai"},
    "riyadh": {"baseline": 69.0, "variation": 1.8, "traffic": 0.06, "construction": 0.03, "timezone": "Asia/Riyadh"},
    "istanbul": {"baseline": 74.0, "variation": 2.0, "traffic": 0.07, "construction": 0.03, "timezone": "Europe/Istanbul"},
    "london": {"baseline": 66.0, "variation": 1.7, "traffic": 0.05, "construction": 0.02, "timezone": "Europe/London"},
    "paris": {"baseline": 69.0, "variation": 1.8, "traffic": 0.06, "construction": 0.03, "timezone": "Europe/Paris"},
    "berlin": {"baseline": 64.0, "variation": 1.6, "traffic": 0.05, "construction": 0.02, "timezone": "Europe/Berlin"},
    "madrid": {"baseline": 68.0, "variation": 1.8, "traffic": 0.05, "construction": 0.03, "timezone": "Europe/Madrid"},
    "rome": {"baseline": 71.0, "variation": 1.9, "traffic": 0.06, "construction": 0.03, "timezone": "Europe/Rome"},
    "amsterdam": {"baseline": 63.0, "variation": 1.5, "traffic": 0.04, "construction": 0.02, "timezone": "Europe/Amsterdam"},
    "new york": {"baseline": 75.0, "variation": 2.0, "traffic": 0.08, "construction": 0.03, "timezone": "America/New_York"},
    "los angeles": {"baseline": 78.0, "variation": 2.2, "traffic": 0.09, "construction": 0.04, "timezone": "America/Los_Angeles"},
    "chicago": {"baseline": 72.0, "variation": 1.9, "traffic": 0.07, "construction": 0.03, "timezone": "America/Chicago"},
    "toronto": {"baseline": 65.0, "variation": 1.7, "traffic": 0.05, "construction": 0.02, "timezone": "America/Toronto"},
    "mexico city": {"baseline": 76.0, "variation": 2.1, "traffic": 0.08, "construction": 0.04, "timezone": "America/Mexico_City"},
    "sao paulo": {"baseline": 77.0, "variation": 2.1, "traffic": 0.08, "construction": 0.04, "timezone": "America/Sao_Paulo"},
    "são paulo": {"baseline": 77.0, "variation": 2.1, "traffic": 0.08, "construction": 0.04, "timezone": "America/Sao_Paulo"},
    "buenos aires": {"baseline": 70.0, "variation": 1.9, "traffic": 0.06, "construction": 0.03, "timezone": "America/Argentina/Buenos_Aires"},
    "lima": {"baseline": 73.0, "variation": 2.0, "traffic": 0.07, "construction": 0.03, "timezone": "America/Lima"},
    "santiago": {"baseline": 69.0, "variation": 1.8, "traffic": 0.06, "construction": 0.03, "timezone": "America/Santiago"},
    "sydney": {"baseline": 65.0, "variation": 1.7, "traffic": 0.05, "construction": 0.02, "timezone": "Australia/Sydney"},
    "melbourne": {"baseline": 64.0, "variation": 1.6, "traffic": 0.05, "construction": 0.02, "timezone": "Australia/Melbourne"},
    "auckland": {"baseline": 61.0, "variation": 1.5, "traffic": 0.04, "construction": 0.02, "timezone": "Pacific/Auckland"},
    "cape town": {"baseline": 62.0, "variation": 1.7, "traffic": 0.05, "construction": 0.02, "timezone": "Africa/Johannesburg"},
    "nairobi": {"baseline": 67.0, "variation": 1.8, "traffic": 0.06, "construction": 0.03, "timezone": "Africa/Nairobi"},
    "lagos": {"baseline": 75.0, "variation": 2.1, "traffic": 0.08, "construction": 0.04, "timezone": "Africa/Lagos"},
    "cairo": {"baseline": 78.0, "variation": 2.2, "traffic": 0.09, "construction": 0.04, "timezone": "Africa/Cairo"},
    "johannesburg": {"baseline": 66.0, "variation": 1.8, "traffic": 0.06, "construction": 0.03, "timezone": "Africa/Johannesburg"},
    "moscow": {"baseline": 67.0, "variation": 1.8, "traffic": 0.05, "construction": 0.02, "timezone": "Europe/Moscow"},
    "stockholm": {"baseline": 58.0, "variation": 1.4, "traffic": 0.03, "construction": 0.02, "timezone": "Europe/Stockholm"},
    "oslo": {"baseline": 57.0, "variation": 1.4, "traffic": 0.03, "construction": 0.02, "timezone": "Europe/Oslo"},
    "copenhagen": {"baseline": 59.0, "variation": 1.4, "traffic": 0.03, "construction": 0.02, "timezone": "Europe/Copenhagen"},
    "helsinki": {"baseline": 57.0, "variation": 1.3, "traffic": 0.03, "construction": 0.02, "timezone": "Europe/Helsinki"},
    "zurich": {"baseline": 55.0, "variation": 1.3, "traffic": 0.03, "construction": 0.02, "timezone": "Europe/Zurich"},
    "vienna": {"baseline": 61.0, "variation": 1.5, "traffic": 0.04, "construction": 0.02, "timezone": "Europe/Vienna"},
    "warsaw": {"baseline": 64.0, "variation": 1.7, "traffic": 0.05, "construction": 0.02, "timezone": "Europe/Warsaw"},
    "athens": {"baseline": 70.0, "variation": 1.9, "traffic": 0.06, "construction": 0.03, "timezone": "Europe/Athens"},
    "lisbon": {"baseline": 62.0, "variation": 1.6, "traffic": 0.04, "construction": 0.02, "timezone": "Europe/Lisbon"},
    "jakarta": {"baseline": 77.0, "variation": 2.1, "traffic": 0.08, "construction": 0.04, "timezone": "Asia/Jakarta"},
}

SENSOR_REFRESH_SECONDS = 10


def get_sensor_profile(sensor: dict) -> dict:
    text = f"{sensor.get('name', '')} {sensor.get('location', '')}".lower()

    for city, profile in CITY_PROFILES.items():
        if city in text:
            return profile

    return {
        "baseline": 68.0,
        "variation": 1.8,
        "traffic": 0.05,
        "construction": 0.02,
        "timezone": "Asia/Kolkata",
    }


def get_sensors() -> list[dict]:
    response = api_request("GET", "/api/sensors")

    if not response:
        return []

    rows = response if isinstance(response, list) else response.get("sensors", [])
    if not isinstance(rows, list):
        return []

    sensors = []
    for row in rows:
        if not isinstance(row, dict):
            continue

        try:
            sensor_id = int(row["id"])
        except (KeyError, TypeError, ValueError):
            continue

        if not bool(row.get("is_active", True)):
            continue

        sensor = {
            "id": sensor_id,
            "code": str(row.get("sensor_code", f"NG-{sensor_id:03d}")),
            "name": str(row.get("name", f"SENSOR_{sensor_id}")),
            "location": str(row.get("location", row.get("name", "UNKNOWN_LOCATION"))),
            "current_noise_level": float(row.get("current_noise_level") or 0.0),
        }
        sensor.update(get_sensor_profile(sensor))
        sensors.append(sensor)

    sensors.sort(key=lambda item: item["id"])
    return sensors



def api_request(
    method: str,
    endpoint: str,
    payload: dict | None = None,
) -> dict | None:
    url = f"{API_BASE_URL}{endpoint}"

    data = (
        json.dumps(payload).encode("utf-8")
        if payload is not None
        else None
    )

    request = Request(
        url,
        data=data,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method=method,
    )

    try:
        with urlopen(request, timeout=10) as response:
            response_body = response.read().decode("utf-8")

            if not response_body:
                return None

            return json.loads(response_body)

    except HTTPError as error:
        error_body = error.read().decode("utf-8")
        print(f"[ERROR] API {error.code}: {error_body}")
        return None

    except URLError as error:
        print(f"[ERROR] Cannot connect to backend: {error.reason}")
        return None

    except Exception as error:
        print(f"[ERROR] {error}")
        return None


def get_settings() -> dict | None:
    response = api_request("GET", "/api/settings")

    if not response:
        return None

    settings = response.get("settings")

    if not isinstance(settings, dict):
        return None

    return settings


def get_time_profile(timezone_name: str) -> tuple[float, str]:
    try:
        tz = ZoneInfo(timezone_name)
    except Exception:
        tz = ZoneInfo("Asia/Kolkata")

    now = datetime.now(tz)
    hour = now.hour + (now.minute / 60)

    if 0 <= hour < 6:
        return 0.72, "NIGHT"

    if 6 <= hour < 10:
        return 1.05, "MORNING_RUSH"

    if 10 <= hour < 17:
        return 0.92, "DAY"

    if 17 <= hour < 22:
        return 1.04, "EVENING_RUSH"

    return 0.78, "LATE_NIGHT"


def generate_noise_level(
    sensor: dict,
    previous_value: float,
) -> tuple[float, str, str]:
    timezone_name = sensor.get("timezone", "Asia/Kolkata")
    activity_multiplier, period = get_time_profile(timezone_name)

    target = sensor["baseline"] * activity_multiplier

    drift = (target - previous_value) * 0.15

    random_variation = random.uniform(
        -sensor["variation"],
        sensor["variation"],
    )

    wave = math.sin(time.time() / 45) * 0.8

    noise_level = (
        previous_value
        + drift
        + random_variation
        + wave
    )

    event = "NORMAL_ACTIVITY"

    try:
        tz = ZoneInfo(timezone_name)
    except Exception:
        tz = ZoneInfo("Asia/Kolkata")

    current_hour = datetime.now(tz).hour

    if current_hour in {7, 8, 9, 17, 18, 19}:
        if random.random() < sensor["traffic"]:
            noise_level += random.uniform(5.0, 9.0)
            event = "TRAFFIC_SPIKE"

    if 8 <= current_hour < 18:
        if random.random() < sensor["construction"]:
            noise_level += random.uniform(4.0, 8.0)
            event = "CONSTRUCTION_SPIKE"

    if random.random() < 0.008:
        noise_level += random.uniform(10.0, 15.0)
        event = "EXTREME_NOISE_EVENT"

    noise_level = max(45.0, min(105.0, noise_level))

    return round(noise_level, 1), period, event


def send_reading(
    sensor: dict,
    noise_level: float,
    period: str,
    event: str,
) -> bool:
    # Status is intentionally kept aligned with the current simulator
    # presentation. Alert severity itself is calculated by the backend
    # using the live Settings thresholds.
    if noise_level < 70:
        status = "normal"
    elif noise_level < 85:
        status = "moderate"
    elif noise_level < 95:
        status = "high"
    else:
        status = "critical"

    reading = api_request(
        "POST",
        "/api/readings",
        {
            "sensor_id": sensor["id"],
            "noise_level": noise_level,
            "source": "simulator",
            "event_type": event,
        },
    )

    if reading is None:
        return False

    sensor_update = api_request(
        "PUT",
        f"/api/sensors/{sensor['id']}",
        {
            "current_noise_level": noise_level,
            "status": status,
        },
    )

    if sensor_update is None:
        return False

    print(
        f"[LIVE] "
        f"SENSOR={sensor['code']} "
        f"LOCATION={sensor['name']} "
        f"NOISE={noise_level:.1f} dB "
        f"STATUS={status.upper()} "
        f"PERIOD={period} "
        f"EVENT={event} "
        f"SOURCE=SIMULATOR "
        f"READING_ID={reading['id']}"
    )

    return True


def main() -> None:
    states: dict[int, float] = {}
    last_settings: dict | None = None
    last_settings_fetch = 0.0
    sensors: list[dict] = []
    last_sensor_fetch = 0.0

    print("=" * 88)
    print("NOISEGUARD AI :: GLOBAL MULTI-SENSOR LIVE SIMULATOR v7")
    print("=" * 88)
    print("SENSOR SOURCE: BACKEND DATABASE (AUTO-DISCOVERY)")
    print("DATA SOURCE  : SIMULATOR")
    print("SPIKE MODE   : TEMPORARY + NATURAL DECAY")
    print("EVENT TRACKING: ENABLED")
    print("SETTINGS     : LIVE")
    print("STATUS       : STARTING")
    print("Press CTRL+C to stop.")
    print("=" * 88)

    try:
        while True:
            now = time.monotonic()

            if (
                last_settings is None
                or now - last_settings_fetch >= SETTINGS_REFRESH_SECONDS
            ):
                fresh_settings = get_settings()

                if fresh_settings is not None:
                    last_settings = fresh_settings
                    last_settings_fetch = now

                    enabled = bool(last_settings.get("simulator_enabled", True))
                    interval = int(
                        last_settings.get(
                            "simulator_interval_seconds",
                            DEFAULT_INTERVAL_SECONDS,
                        )
                    )

                    print(
                        f"[CONFIG] SIMULATOR={'ON' if enabled else 'OFF'} "
                        f"INTERVAL={interval}s "
                        f"TIMEZONE={last_settings.get('timezone', 'Asia/Kolkata')}"
                    )

            if now - last_sensor_fetch >= SENSOR_REFRESH_SECONDS or not sensors:
                discovered = get_sensors()
                if discovered:
                    sensors = discovered
                    last_sensor_fetch = now

                    for sensor in sensors:
                        if sensor["id"] not in states:
                            existing = sensor.get("current_noise_level", 0.0)
                            states[sensor["id"]] = (
                                existing if existing >= 45.0 else sensor["baseline"]
                            )

                    print(
                        f"[DISCOVERY] ACTIVE_SENSORS={len(sensors)} "
                        "SOURCE=/api/sensors"
                    )
                elif not sensors:
                    print("[WARN] No active sensors discovered; retrying backend...")
                    time.sleep(DEFAULT_INTERVAL_SECONDS)
                    continue

            if last_settings is None:
                print("[WARN] Settings unavailable; retrying backend...")
                time.sleep(DEFAULT_INTERVAL_SECONDS)
                continue

            simulator_enabled = bool(
                last_settings.get("simulator_enabled", True)
            )

            interval_seconds = max(
                1,
                int(
                    last_settings.get(
                        "simulator_interval_seconds",
                        DEFAULT_INTERVAL_SECONDS,
                    )
                ),
            )

            if not simulator_enabled:
                print("[PAUSED] Simulator disabled from Settings.")
                time.sleep(min(interval_seconds, 5))
                continue

            for sensor in sensors:
                # Refresh the sensor registry while processing large global batches.
                if time.monotonic() - last_sensor_fetch >= SENSOR_REFRESH_SECONDS:
                    discovered = get_sensors()
                    if discovered:
                        sensors = discovered
                        last_sensor_fetch = time.monotonic()
                        print(
                            f"[DISCOVERY] ACTIVE_SENSORS={len(sensors)} "
                            "SOURCE=/api/sensors"
                        )

                if not bool(last_settings.get("simulator_enabled", True)):
                    print("[PAUSED] Simulator disabled from Settings.")
                    break

                sensor_id = sensor["id"]
                previous_value = states.get(
                    sensor_id,
                    sensor.get("current_noise_level", 0.0) or sensor["baseline"],
                )

                if previous_value < 45.0:
                    previous_value = sensor["baseline"]

                noise_level, period, event = generate_noise_level(
                    sensor,
                    previous_value,
                )

                states[sensor_id] = noise_level

                success = send_reading(
                    sensor,
                    noise_level,
                    period,
                    event,
                )

                if not success:
                    print(
                        f"[WARN] {sensor['code']} reading was not stored."
                    )

            print("-" * 88)
            time.sleep(interval_seconds)

    except KeyboardInterrupt:
        print()
        print("[STOPPED] Global multi-sensor simulator stopped.")


if __name__ == "__main__":
    main()
