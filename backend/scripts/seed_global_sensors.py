"""Seed NoiseGuard AI with a globally distributed simulated sensor network.

This script preserves existing sensors and only creates missing NG-* sensor codes.
Run from the backend directory after the FastAPI server is running:
    python scripts/seed_global_sensors.py
"""

import json
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

API_BASE_URL = "http://127.0.0.1:8000"

# 44 additional cities. Together with the existing 6 Delhi sensors this gives
# the dashboard a 50-sensor global starting network.
GLOBAL_SENSORS = [
    ("Mumbai", "India", 19.0760, 72.8777),
    ("Bengaluru", "India", 12.9716, 77.5946),
    ("Kolkata", "India", 22.5726, 88.3639),
    ("Singapore", "Singapore", 1.3521, 103.8198),
    ("Tokyo", "Japan", 35.6762, 139.6503),
    ("Seoul", "South Korea", 37.5665, 126.9780),
    ("Beijing", "China", 39.9042, 116.4074),
    ("Bangkok", "Thailand", 13.7563, 100.5018),
    ("Dubai", "UAE", 25.2048, 55.2708),
    ("Riyadh", "Saudi Arabia", 24.7136, 46.6753),
    ("Istanbul", "Turkey", 41.0082, 28.9784),
    ("London", "United Kingdom", 51.5074, -0.1278),
    ("Paris", "France", 48.8566, 2.3522),
    ("Berlin", "Germany", 52.5200, 13.4050),
    ("Madrid", "Spain", 40.4168, -3.7038),
    ("Rome", "Italy", 41.9028, 12.4964),
    ("Amsterdam", "Netherlands", 52.3676, 4.9041),
    ("New York", "USA", 40.7128, -74.0060),
    ("Los Angeles", "USA", 34.0522, -118.2437),
    ("Chicago", "USA", 41.8781, -87.6298),
    ("Toronto", "Canada", 43.6532, -79.3832),
    ("Mexico City", "Mexico", 19.4326, -99.1332),
    ("Sao Paulo", "Brazil", -23.5505, -46.6333),
    ("Buenos Aires", "Argentina", -34.6037, -58.3816),
    ("Lima", "Peru", -12.0464, -77.0428),
    ("Santiago", "Chile", -33.4489, -70.6693),
    ("Sydney", "Australia", -33.8688, 151.2093),
    ("Melbourne", "Australia", -37.8136, 144.9631),
    ("Auckland", "New Zealand", -36.8509, 174.7645),
    ("Cape Town", "South Africa", -33.9249, 18.4241),
    ("Nairobi", "Kenya", -1.2921, 36.8219),
    ("Lagos", "Nigeria", 6.5244, 3.3792),
    ("Cairo", "Egypt", 30.0444, 31.2357),
    ("Johannesburg", "South Africa", -26.2041, 28.0473),
    ("Moscow", "Russia", 55.7558, 37.6173),
    ("Stockholm", "Sweden", 59.3293, 18.0686),
    ("Oslo", "Norway", 59.9139, 10.7522),
    ("Copenhagen", "Denmark", 55.6761, 12.5683),
    ("Helsinki", "Finland", 60.1699, 24.9384),
    ("Zurich", "Switzerland", 47.3769, 8.5417),
    ("Vienna", "Austria", 48.2082, 16.3738),
    ("Warsaw", "Poland", 52.2297, 21.0122),
    ("Athens", "Greece", 37.9838, 23.7275),
    ("Lisbon", "Portugal", 38.7223, -9.1393),
    ("Jakarta", "Indonesia", -6.2088, 106.8456),
]


def request(method: str, endpoint: str, payload: dict | None = None):
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = Request(
        f"{API_BASE_URL}{endpoint}",
        data=data,
        method=method,
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
    )
    try:
        with urlopen(req, timeout=10) as response:
            body = response.read().decode("utf-8")
            return json.loads(body) if body else None
    except HTTPError as error:
        body = error.read().decode("utf-8")
        print(f"[ERROR] HTTP {error.code}: {body}")
        return None
    except URLError as error:
        print(f"[ERROR] Cannot connect to backend: {error.reason}")
        return None


def main() -> None:
    payload = request("GET", "/api/sensors")
    if payload is None:
        raise SystemExit("Backend is unavailable. Start FastAPI first.")

    existing_rows = payload if isinstance(payload, list) else payload.get("sensors", [])
    existing_codes = {
        str(row.get("sensor_code"))
        for row in existing_rows
        if isinstance(row, dict) and row.get("sensor_code")
    }

    next_number = 7
    created = 0
    skipped = 0

    print("=" * 88)
    print("NOISEGUARD AI :: GLOBAL SENSOR SEED")
    print(f"EXISTING SENSORS : {len(existing_rows)}")
    print(f"TARGET NETWORK   : {len(existing_rows) + len(GLOBAL_SENSORS)} MAX")
    print("=" * 88)

    for city, country, latitude, longitude in GLOBAL_SENSORS:
        while f"NG-{next_number:03d}" in existing_codes:
            next_number += 1

        code = f"NG-{next_number:03d}"
        if code in existing_codes:
            skipped += 1
            continue

        sensor = {
            "sensor_code": code,
            "name": f"{city} Sensor",
            "location": f"{city}, {country}",
            "latitude": latitude,
            "longitude": longitude,
            "current_noise_level": 0.0,
            "status": "offline",
            "is_active": True,
        }

        result = request("POST", "/api/sensors", sensor)
        if result is None:
            print(f"[FAILED] {code} {city}")
            continue

        existing_codes.add(code)
        created += 1
        next_number += 1
        print(f"[CREATED] {code:<7} {city:<16} {country:<18} ({latitude:.4f}, {longitude:.4f})")

    print("-" * 88)
    print(f"CREATED : {created}")
    print(f"SKIPPED : {skipped}")
    print("Run the global simulator after seeding.")


if __name__ == "__main__":
    main()
