"use client";

import dynamic from "next/dynamic";
import {
  Crosshair,
  Minus,
  Plus,
  Radio,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

interface SensorPoint {
  id: string;
  sensorId: number;
  name: string;
  level: number;
  position: [number, number];
  updatedAt?: string;
  source?: string;
  eventType?: string;
}

interface SensorReading {
  sensor_id: number;
  noise_level: number;
  recorded_at: string;
  source?: string;
  event_type?: string;
}

interface MapProps {
  sensors: SensorPoint[];
  onSelect: (sensor: SensorPoint) => void;
}

function severity(level: number) {
  if (level >= 95) return { label: "CRITICAL", color: "#ff3333" };
  if (level >= 85) return { label: "HIGH", color: "#ff7a00" };
  if (level >= 70) return { label: "MODERATE", color: "#ffb000" };
  return { label: "LOW", color: "#33ff00" };
}

function heatRadius(level: number) {
  if (level >= 95) return 120000;
  if (level >= 85) return 100000;
  if (level >= 70) return 80000;
  return 60000;
}

function sensorIcon(level: number, id: string) {
  const s = severity(level);
  const roundedLevel = Math.round(Number(level));

  return {
    className: "noiseguard-sensor-icon",
    iconSize: [34, 34] as [number, number],
    iconAnchor: [17, 17] as [number, number],
    popupAnchor: [0, -17] as [number, number],
    html: `
      <div style="
        width:34px;
        height:34px;
        box-sizing:border-box;
        display:flex;
        align-items:center;
        justify-content:center;
        border-radius:50%;
        background:${s.color};
        border:2px solid ${s.color};
        color:#020402;
        font-family:monospace;
        font-size:10px;
        font-weight:800;
        line-height:1;
        box-shadow:0 0 8px ${s.color}99, 0 0 14px ${s.color}44;
        text-align:center;
        cursor:pointer;
      ">
        <span style="
          display:flex;
          align-items:center;
          justify-content:center;
          width:100%;
          height:100%;
          white-space:nowrap;
        ">${roundedLevel}</span>
      </div>
    `,
  };
}

const LeafletWorldMap = dynamic<MapProps>(
  () =>
    Promise.all([
      import("react-leaflet"),
      import("leaflet"),
    ]).then(([mod, leafletModule]) => {
      const {
        MapContainer,
        TileLayer,
        Circle,
        Marker,
        Popup,
        useMap,
      } = mod;

      const L = leafletModule.default;

      function MapController() {
        const map = useMap();

        useEffect(() => {
          const zoomHandler = (event: Event) => {
            const direction = (
              event as CustomEvent<"in" | "out">
            ).detail;

            if (direction === "in") map.zoomIn();
            if (direction === "out") map.zoomOut();
          };

          const resetHandler = () => {
            map.setView([20, 0], 2, { animate: true });
          };

          window.addEventListener(
            "noiseguard-map-zoom",
            zoomHandler,
          );
          window.addEventListener(
            "noiseguard-map-reset",
            resetHandler,
          );

          return () => {
            window.removeEventListener(
              "noiseguard-map-zoom",
              zoomHandler,
            );
            window.removeEventListener(
              "noiseguard-map-reset",
              resetHandler,
            );
          };
        }, [map]);

        return null;
      }

      function WorldMap({ sensors, onSelect }: MapProps) {
        return (
          <MapContainer
            center={[20, 0]}
            zoom={2}
            minZoom={2}
            maxZoom={18}
            maxBounds={[
              [-85, -180],
              [85, 180],
            ]}
            maxBoundsViscosity={0.9}
            worldCopyJump={false}
            scrollWheelZoom
            zoomControl={false}
            className="h-full w-full"
          >
            <TileLayer
              attribution="Tiles &copy; Esri"
              url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"
              opacity={1}
              className="noiseguard-dark-tiles"
            />

            <MapController />

            {sensors.map((sensor) => {
              const s = severity(sensor.level);
              const radius = heatRadius(sensor.level);

              return (
                <Circle
                  key={`heat-outer-${sensor.id}`}
                  center={sensor.position}
                  radius={radius * 1.65}
                  pathOptions={{
                    color: s.color,
                    stroke: false,
                    fillColor: s.color,
                    fillOpacity: 0.018,
                    weight: 0,
                  }}
                />
              );
            })}

            {sensors.map((sensor) => {
              const s = severity(sensor.level);
              const radius = heatRadius(sensor.level);

              return (
                <Circle
                  key={`heat-mid-${sensor.id}`}
                  center={sensor.position}
                  radius={radius}
                  pathOptions={{
                    color: s.color,
                    stroke: false,
                    fillColor: s.color,
                    fillOpacity: 0.035,
                    weight: 0,
                  }}
                />
              );
            })}

            {sensors.map((sensor) => {
              const s = severity(sensor.level);
              const radius = heatRadius(sensor.level);

              return (
                <Circle
                  key={`heat-core-${sensor.id}`}
                  center={sensor.position}
                  radius={radius * 0.38}
                  pathOptions={{
                    color: s.color,
                    stroke: false,
                    fillColor: s.color,
                    fillOpacity: 0.08,
                    weight: 0,
                  }}
                />
              );
            })}

            {sensors.map((sensor) => (
              <Marker
                key={`marker-${sensor.id}`}
                position={sensor.position}
                icon={L.divIcon(sensorIcon(sensor.level, sensor.id))}
                zIndexOffset={1000}
                eventHandlers={{
                  click: () => onSelect(sensor),
                }}
              >
                <Popup>
                  <div
                    style={{
                      minWidth: 190,
                      padding: 10,
                      background: "#050805",
                      color: severity(sensor.level).color,
                      border: `1px solid ${severity(sensor.level).color}`,
                      fontFamily: "monospace",
                      fontSize: 11,
                      lineHeight: 1.65,
                    }}
                  >
                    <div>SENSOR: {sensor.id}</div>
                    <div>LOCATION: {sensor.name}</div>
                    <div>
                      CURRENT: {sensor.level.toFixed(1)} dB
                    </div>
                    <div>
                      STATUS: [{severity(sensor.level).label}]
                    </div>
                    <div>
                      SOURCE: {sensor.source ?? "LIVE"}
                    </div>
                    <div>
                      EVENT: {sensor.eventType ?? "NORMAL_ACTIVITY"}
                    </div>
                  </div>
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        );
      }

      return WorldMap;
    }),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center bg-[#020402] text-[10px] text-[#33ff00]">
        [ MAP_ENGINE ] INITIALIZING...
      </div>
    ),
  },
);

const initialSensors: SensorPoint[] = [
  {
    id: "NG-001",
    sensorId: 4,
    name: "CONNAUGHT_PLACE",
    level: 74,
    position: [28.6315, 77.2167],
  },
  {
    id: "NG-002",
    sensorId: 2,
    name: "ANAND_VIHAR",
    level: 78,
    position: [28.6469, 77.315],
  },
  {
    id: "NG-003",
    sensorId: 5,
    name: "DWARKA",
    level: 62,
    position: [28.5921, 77.046],
  },
  {
    id: "NG-004",
    sensorId: 6,
    name: "ROHINI",
    level: 69,
    position: [28.7495, 77.0565],
  },
  {
    id: "NG-005",
    sensorId: 7,
    name: "SAKET",
    level: 70,
    position: [28.5245, 77.2066],
  },
  {
    id: "NG-006",
    sensorId: 8,
    name: "LAJPAT_NAGAR",
    level: 76,
    position: [28.5677, 77.2433],
  },
];

const API_BASE = "http://127.0.0.1:8000";

function formatTime(value?: string) {
  if (!value) return "--:--:--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--:--";
  return date.toLocaleTimeString("en-GB", { hour12: false });
}

export default function MapPanel() {
  const [sensors, setSensors] =
    useState<SensorPoint[]>(initialSensors);
  const [selected, setSelected] =
    useState<SensorPoint | null>(null);
  const [connected, setConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState("");
  const [lastEvent, setLastEvent] =
    useState("WAITING_FOR_LIVE_DATA");
  const [refreshing, setRefreshing] = useState(false);

  const refreshSensors = useCallback(async () => {
    setRefreshing(true);

    try {
      const response = await fetch(
        `${API_BASE}/api/sensors`,
        { cache: "no-store" },
      );

      if (!response.ok) throw new Error("sensor request failed");

      const payload: unknown = await response.json();

      const rows =
        Array.isArray(payload)
          ? payload
          : payload &&
              typeof payload === "object" &&
              "sensors" in payload &&
              Array.isArray(
                (payload as { sensors?: unknown }).sensors,
              )
            ? (payload as { sensors: unknown[] }).sensors
            : [];

      setSensors((previous) => {
        const previousById = new Map(
          previous.map((sensor) => [
            sensor.sensorId,
            sensor,
          ]),
        );

        const next: SensorPoint[] = [];

        rows.forEach((row) => {
          if (!row || typeof row !== "object") return;

          const item = row as Record<string, unknown>;
          const sensorId = Number(item.id);
          const latitude = Number(item.latitude);
          const longitude = Number(item.longitude);

          if (
            !Number.isFinite(sensorId) ||
            !Number.isFinite(latitude) ||
            !Number.isFinite(longitude)
          ) {
            return;
          }

          const old = previousById.get(sensorId);
          const apiLevel = Number(
            item.current_noise_level,
          );

          next.push({
            id: String(
              item.sensor_code ??
                old?.id ??
                `NG-${sensorId}`,
            ),
            sensorId,
            name: String(
              item.name ??
                old?.name ??
                `SENSOR_${sensorId}`,
            ),
            level: Number.isFinite(apiLevel)
              ? apiLevel
              : old?.level ?? 0,
            position: [
              latitude,
              longitude,
            ],
            updatedAt:
              typeof item.updated_at === "string"
                ? item.updated_at
                : old?.updatedAt,
            source: old?.source,
            eventType: old?.eventType,
          });
        });

        return next.length > 0 ? next : previous;
      });

      setLastUpdate(new Date().toISOString());
      setLastEvent("API_SENSOR_REFRESH");
    } catch {
      setLastEvent("API_REFRESH_FAILED");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refreshSensors();

    const timer = window.setInterval(() => {
      void refreshSensors();
    }, 5000);

    return () => window.clearInterval(timer);
  }, [refreshSensors]);

  useEffect(() => {
    const handleReading = (event: Event) => {
      const reading =
        (
          event as CustomEvent<SensorReading>
        ).detail;

      if (
        !reading ||
        !Number.isFinite(
          Number(reading.sensor_id),
        ) ||
        !Number.isFinite(
          Number(reading.noise_level),
        )
      ) {
        return;
      }

      setSensors((current) =>
        current.map((sensor) =>
          sensor.sensorId ===
          Number(reading.sensor_id)
            ? {
                ...sensor,
                level: Number(
                  reading.noise_level,
                ),
                updatedAt:
                  reading.recorded_at,
                source:
                  reading.source ??
                  sensor.source,
                eventType:
                  reading.event_type ??
                  sensor.eventType,
              }
            : sensor,
        ),
      );

      setLastUpdate(reading.recorded_at);
      setLastEvent("LIVE_READING");
    };

    const handleStream = (event: Event) => {
      const detail =
        (
          event as CustomEvent<{
            connected?: boolean;
          }>
        ).detail;

      setConnected(Boolean(detail?.connected));
    };

    window.addEventListener(
      "noiseguard-live-reading",
      handleReading,
    );
    window.addEventListener(
      "noiseguard-stream-status",
      handleStream,
    );

    return () => {
      window.removeEventListener(
        "noiseguard-live-reading",
        handleReading,
      );
      window.removeEventListener(
        "noiseguard-stream-status",
        handleStream,
      );
    };
  }, []);

  useEffect(() => {
    if (!selected) return;

    const latest = sensors.find(
      (sensor) => sensor.id === selected.id,
    );

    setSelected(latest ?? null);
  }, [sensors, selected]);

  const zoomIn = () =>
    window.dispatchEvent(
      new CustomEvent(
        "noiseguard-map-zoom",
        { detail: "in" },
      ),
    );

  const zoomOut = () =>
    window.dispatchEvent(
      new CustomEvent(
        "noiseguard-map-zoom",
        { detail: "out" },
      ),
    );

  const resetMap = () => {
    setSelected(null);
    window.dispatchEvent(
      new CustomEvent(
        "noiseguard-map-reset",
      ),
    );
  };

  const high = sensors.filter(
    (sensor) =>
      sensor.level >= 85 &&
      sensor.level < 95,
  ).length;

  const critical = sensors.filter(
    (sensor) => sensor.level >= 95,
  ).length;

  return (
    <section className="terminal-panel min-w-0 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-dashed border-[#1f521f] px-4 py-2">
        <div className="flex items-center gap-2 text-xs text-[#33ff00]">
          <Radio size={14} />
          <span>+--- LIVE_NOISE_MAP // WORLD ---+</span>
        </div>

        <div className="flex items-center gap-2 text-[9px]">
          <span className="text-[#1f9e1f]">
            STREAM:[
            {connected ? "CONNECTED" : "API"}
            ]
          </span>

          <button
            type="button"
            onClick={() => void refreshSensors()}
            disabled={refreshing}
            className="terminal-button inline-flex items-center gap-1 px-2 py-1 disabled:opacity-50"
          >
            <RefreshCw
              size={11}
              className={
                refreshing
                  ? "animate-spin"
                  : ""
              }
            />
            REFRESH
          </button>
        </div>
      </div>

      <div className="relative h-[360px] overflow-hidden bg-[#020402] sm:h-[460px]">
        <LeafletWorldMap
          sensors={sensors}
          onSelect={setSelected}
        />

        <div className="pointer-events-none absolute left-3 top-3 z-[500] border border-[#1f521f] bg-[#030603]/95 px-2 py-2 text-[9px]">
          <div className="text-[#33ff00]">
            MAP_ENGINE:[ONLINE]
          </div>
          <div className="mt-1 text-[#1f9e1f]">
            VIEW:[WORLD] ZOOM:[2-18]
          </div>
          <div className="text-[#1f9e1f]">
            UPDATED:{formatTime(lastUpdate)}
          </div>
          <div className="text-[#1f9e1f]">
            EVENT:{lastEvent}
          </div>
        </div>

        <div className="pointer-events-none absolute bottom-3 left-3 z-[500] border border-[#1f521f] bg-[#030603]/95 px-2 py-2 text-[9px]">
          <div className="mb-1 text-[#33ff00]">
            +--- NOISE_LEVEL ---+
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            <span className="text-[#33ff00]">
              ● LOW &lt;70
            </span>
            <span className="text-[#ffb000]">
              ● MOD 70-84
            </span>
            <span className="text-[#ff7a00]">
              ● HIGH 85-94
            </span>
            <span className="text-[#ff3333]">
              ● CRIT ≥95
            </span>
          </div>
        </div>

        <div className="absolute bottom-3 right-3 z-[500] flex flex-col gap-1">
          <button
            type="button"
            onClick={zoomIn}
            className="terminal-button flex h-8 w-8 items-center justify-center bg-[#030603]/95"
            aria-label="Zoom in"
          >
            <Plus size={14} />
          </button>
          <button
            type="button"
            onClick={zoomOut}
            className="terminal-button flex h-8 w-8 items-center justify-center bg-[#030603]/95"
            aria-label="Zoom out"
          >
            <Minus size={14} />
          </button>
          <button
            type="button"
            onClick={resetMap}
            className="terminal-button flex h-8 w-8 items-center justify-center bg-[#030603]/95"
            aria-label="Reset world view"
          >
            <Crosshair size={14} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 border-t border-dashed border-[#1f521f] p-2 sm:grid-cols-4">
        <div className="border border-[#1f521f] px-2 py-1">
          <div className="text-[8px] text-[#1f9e1f]">
            SENSOR_NODES
          </div>
          <div className="text-xs text-[#33ff00]">
            {sensors.length}
          </div>
        </div>

        <div className="border border-[#1f521f] px-2 py-1">
          <div className="text-[8px] text-[#1f9e1f]">
            HIGH
          </div>
          <div className="text-xs text-[#ff7a00]">
            {high}
          </div>
        </div>

        <div className="border border-[#1f521f] px-2 py-1">
          <div className="text-[8px] text-[#1f9e1f]">
            CRITICAL
          </div>
          <div className="text-xs text-[#ff3333]">
            {critical}
          </div>
        </div>

        <div className="border border-[#1f521f] px-2 py-1">
          <div className="text-[8px] text-[#1f9e1f]">
            SELECTED
          </div>
          <div className="truncate text-xs text-[#33ff00]">
            {selected?.id ?? "--"}
          </div>
        </div>
      </div>

      {selected && (
        <div className="border-t border-dashed border-[#1f521f] px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-[9px] text-[#1f9e1f]">
                SENSOR:{selected.id}
              </div>
              <div className="mt-1 text-sm text-[#33ff00]">
                {selected.name}
              </div>
            </div>

            <div
              className="text-xl font-bold"
              style={{
                color: severity(
                  selected.level,
                ).color,
              }}
            >
              {selected.level.toFixed(1)} dB
            </div>

            <div
              className="border px-2 py-1 text-[9px]"
              style={{
                color: severity(
                  selected.level,
                ).color,
                borderColor:
                  severity(
                    selected.level,
                  ).color,
              }}
            >
              [
              {
                severity(
                  selected.level,
                ).label
              }
              ]
            </div>
          </div>
        </div>
      )}

      <div className="border-t border-dashed border-[#1f521f] px-3 py-2 text-[8px] text-[#1f9e1f]">
        WORLD_VIEW // DELHI SENSOR CLUSTER // LIVE READINGS
      </div>
    </section>
  );
}
