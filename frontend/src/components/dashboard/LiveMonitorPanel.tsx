"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Clock3,
  MapPin,
  Radio,
  RefreshCw,
  Server,
  Wifi,
  WifiOff,
  Zap,
} from "lucide-react";

const API_BASE_URL = "http://127.0.0.1:8000";
const WS_URL = "ws://127.0.0.1:8000/ws/noise";

type Severity = "NORMAL" | "MODERATE" | "HIGH" | "CRITICAL";

interface Sensor {
  id: number;
  sensor_code: string;
  name: string;
  location: string;
  latitude: number;
  longitude: number;
  current_noise_level: number;
  status: string;
  is_active: boolean;
  updated_at?: string | null;
}

interface Reading {
  id: number;
  sensor_id: number;
  noise_level: number;
  recorded_at: string;
  source: string;
  event_type: string;
}

interface SettingsResponse {
  settings?: {
    high_noise_threshold_db?: number;
    critical_noise_threshold_db?: number;
  };
}

interface WebSocketMessage {
  type: string;
  data: Reading;
}

interface TrendPoint {
  sensorId: number;
  level: number;
  recordedAt: string;
}

const DEFAULT_HIGH = 85;
const DEFAULT_CRITICAL = 95;
const MAX_STREAM_ROWS = 18;
const MAX_TREND_POINTS = 72;

function safeNumber(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function severityFor(
  level: number,
  highThreshold: number,
  criticalThreshold: number,
): Severity {
  if (level >= criticalThreshold) return "CRITICAL";
  if (level >= highThreshold) return "HIGH";
  if (level >= Math.max(0, highThreshold - 15)) return "MODERATE";
  return "NORMAL";
}

function severityClasses(severity: Severity) {
  switch (severity) {
    case "CRITICAL":
      return "border-[#ff3333] text-[#ff3333]";
    case "HIGH":
      return "border-[#ffb000] text-[#ffb000]";
    case "MODERATE":
      return "border-[#ffb000] text-[#ffb000]";
    default:
      return "border-[#33ff00] text-[#33ff00]";
  }
}

function severityDot(severity: Severity) {
  switch (severity) {
    case "CRITICAL":
      return "bg-[#ff3333] shadow-[0_0_8px_#ff3333]";
    case "HIGH":
      return "bg-[#ffb000] shadow-[0_0_8px_#ffb000]";
    case "MODERATE":
      return "bg-[#ffb000]";
    default:
      return "bg-[#33ff00] shadow-[0_0_8px_#33ff00]";
  }
}

function formatTime(value?: string | null) {
  if (!value) return "--:--:--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--:--";
  return date.toLocaleTimeString("en-GB", {
    hour12: false,
  });
}

function formatDateTime(value?: string | null) {
  if (!value) return "WAITING";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "WAITING";
  return `${date.toLocaleDateString("en-GB")} ${date.toLocaleTimeString(
    "en-GB",
    { hour12: false },
  )}`;
}

function eventLabel(value: string) {
  return value
    .replaceAll("_", " ")
    .replaceAll("NORMAL ACTIVITY", "NORMAL");
}

function SensorCard({
  sensor,
  highThreshold,
  criticalThreshold,
}: {
  sensor: Sensor;
  highThreshold: number;
  criticalThreshold: number;
}) {
  const level = safeNumber(sensor.current_noise_level);
  const severity = severityFor(level, highThreshold, criticalThreshold);
  const progress = Math.min(Math.max(level, 0), 110);

  return (
    <article className="border border-[#1f521f] bg-[#080b08] p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={`h-2.5 w-2.5 shrink-0 rounded-full ${severityDot(
              severity,
            )}`}
          />
          <span className="truncate text-[10px] font-bold text-[#33ff00]">
            {sensor.sensor_code}
          </span>
        </div>

        <span
          className={`shrink-0 text-[8px] ${
            sensor.is_active ? "text-[#33ff00]" : "text-[#ff3333]"
          }`}
        >
          [{sensor.is_active ? "ONLINE" : "OFFLINE"}]
        </span>
      </div>

      <div className="mt-2 flex items-center gap-1 text-[9px] text-[#1f9e1f]">
        <MapPin size={10} />
        <span className="truncate">{sensor.location || sensor.name}</span>
      </div>

      <div className="mt-3 flex items-end justify-between gap-2">
        <div>
          <span className={`text-2xl font-bold ${severityClasses(severity).split(" ")[1]}`}>
            {level.toFixed(1)}
          </span>
          <span className="ml-1 text-[9px] text-[#ffb000]">dB</span>
        </div>

        <span
          className={`border px-2 py-1 text-[8px] ${severityClasses(severity)}`}
        >
          {severity}
        </span>
      </div>

      <div className="mt-3 h-1 border border-[#1f521f]">
        <div
          className={`h-full ${
            severity === "CRITICAL"
              ? "bg-[#ff3333]"
              : severity === "HIGH" || severity === "MODERATE"
                ? "bg-[#ffb000]"
                : "bg-[#33ff00]"
          }`}
          style={{ width: `${Math.min((progress / 110) * 100, 100)}%` }}
        />
      </div>

      <div className="mt-2 flex items-center justify-between text-[8px] text-[#1f9e1f]">
        <span>STATUS: {String(sensor.status || severity).toUpperCase()}</span>
        <span>{formatTime(sensor.updated_at)}</span>
      </div>
    </article>
  );
}

function TrendChart({
  sensors,
  trend,
}: {
  sensors: Sensor[];
  trend: TrendPoint[];
}) {
  const width = 900;
  const height = 270;
  const padding = { left: 42, right: 14, top: 14, bottom: 30 };

  const sensorIds = sensors.map((sensor) => sensor.id);
  const bySensor = new Map<number, TrendPoint[]>();

  sensorIds.forEach((id) => bySensor.set(id, []));
  trend.forEach((point) => {
    if (bySensor.has(point.sensorId)) {
      bySensor.get(point.sensorId)!.push(point);
    }
  });

  const allValues = trend.map((point) => point.level);
  const minValue = Math.min(40, ...(allValues.length ? allValues : [40]));
  const maxValue = Math.max(110, ...(allValues.length ? allValues : [110]));
  const range = Math.max(1, maxValue - minValue);

  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const xFor = (index: number, count: number) =>
    padding.left + (count <= 1 ? plotWidth / 2 : (index / (count - 1)) * plotWidth);

  const yFor = (value: number) =>
    padding.top + ((maxValue - value) / range) * plotHeight;

  const lineData = sensors.map((sensor) => {
    const points = bySensor.get(sensor.id) ?? [];
    return {
      sensor,
      points,
      path: points
        .map((point, index) => {
          const x = xFor(index, points.length);
          const y = yFor(point.level);
          return `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
        })
        .join(" "),
    };
  });

  const gridValues = [40, 60, 80, 100, 110].filter(
    (value) => value >= minValue && value <= maxValue,
  );

  return (
    <div className="border border-[#1f521f] bg-[#080b08]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-dashed border-[#1f521f] px-3 py-2">
        <div className="flex items-center gap-2 text-[10px] text-[#33ff00]">
          <Activity size={13} />
          NOISE_LEVEL_TREND
        </div>
        <span className="text-[8px] text-[#1f9e1f]">
          LAST {Math.max(1, Math.min(72, trend.length))} LIVE_POINTS
        </span>
      </div>

      <div className="overflow-x-auto p-2">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="min-w-[720px] w-full"
          role="img"
          aria-label="Live noise level trend"
        >
          {gridValues.map((value) => {
            const y = yFor(value);
            return (
              <g key={value}>
                <line
                  x1={padding.left}
                  x2={width - padding.right}
                  y1={y}
                  y2={y}
                  stroke="#1f521f"
                  strokeDasharray="4 5"
                  strokeWidth="1"
                />
                <text
                  x={padding.left - 8}
                  y={y + 3}
                  textAnchor="end"
                  fill="#1f9e1f"
                  fontSize="9"
                >
                  {value}
                </text>
              </g>
            );
          })}

          <line
            x1={padding.left}
            x2={padding.left}
            y1={padding.top}
            y2={height - padding.bottom}
            stroke="#1f521f"
          />
          <line
            x1={padding.left}
            x2={width - padding.right}
            y1={height - padding.bottom}
            y2={height - padding.bottom}
            stroke="#1f521f"
          />

          {lineData.map(({ sensor, path }) =>
            path ? (
              <path
                key={sensor.id}
                d={path}
                fill="none"
                strokeWidth="2"
                stroke={
                  sensor.id % 6 === 0
                    ? "#ffb000"
                    : sensor.id % 5 === 0
                      ? "#8cff66"
                      : sensor.id % 4 === 0
                        ? "#ff5555"
                        : sensor.id % 3 === 0
                          ? "#55ccff"
                          : "#33ff00"
                }
              />
            ) : null,
          )}
        </svg>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-2 border-t border-dashed border-[#1f521f] px-3 py-2">
        {sensors.map((sensor) => (
          <div key={sensor.id} className="flex items-center gap-1 text-[8px] text-[#1f9e1f]">
            <span
              className={`h-1.5 w-4 ${
                sensor.id % 6 === 0
                  ? "bg-[#ffb000]"
                  : sensor.id % 5 === 0
                    ? "bg-[#8cff66]"
                    : sensor.id % 4 === 0
                      ? "bg-[#ff5555]"
                      : sensor.id % 3 === 0
                        ? "bg-[#55ccff]"
                        : "bg-[#33ff00]"
              }`}
            />
            {sensor.sensor_code}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function LiveMonitorPanel() {
  const [sensors, setSensors] = useState<Sensor[]>([]);
  const [readings, setReadings] = useState<Reading[]>([]);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdate, setLastUpdate] = useState("");
  const [lastEvent, setLastEvent] = useState("WAITING_FOR_STREAM");
  const [highThreshold, setHighThreshold] = useState(DEFAULT_HIGH);
  const [criticalThreshold, setCriticalThreshold] = useState(DEFAULT_CRITICAL);
  const [error, setError] = useState("");

  const refreshSensors = useCallback(async () => {
    try {
      setRefreshing(true);

      const [sensorResponse, settingsResponse] = await Promise.all([
        fetch(`${API_BASE_URL}/api/sensors`, { cache: "no-store" }),
        fetch(`${API_BASE_URL}/api/settings`, { cache: "no-store" }),
      ]);

      if (!sensorResponse.ok) {
        throw new Error(`SENSOR_API_${sensorResponse.status}`);
      }

      const sensorPayload: unknown = await sensorResponse.json();
      const rows =
        Array.isArray(sensorPayload)
          ? sensorPayload
          : sensorPayload &&
              typeof sensorPayload === "object" &&
              "sensors" in sensorPayload &&
              Array.isArray((sensorPayload as { sensors?: unknown[] }).sensors)
            ? (sensorPayload as { sensors: unknown[] }).sensors
            : [];

      const nextSensors: Sensor[] = [];

      rows.forEach((row) => {
        if (!row || typeof row !== "object") return;
        const item = row as Record<string, unknown>;
        const id = Number(item.id);
        if (!Number.isFinite(id)) return;

        nextSensors.push({
          id,
          sensor_code: String(item.sensor_code ?? `NG-${String(id).padStart(3, "0")}`),
          name: String(item.name ?? `SENSOR_${id}`),
          location: String(item.location ?? item.name ?? "UNKNOWN_LOCATION"),
          latitude: safeNumber(item.latitude),
          longitude: safeNumber(item.longitude),
          current_noise_level: safeNumber(item.current_noise_level),
          status: String(item.status ?? "UNKNOWN"),
          is_active: Boolean(item.is_active ?? true),
          updated_at:
            typeof item.updated_at === "string" ? item.updated_at : null,
        });
      });

      nextSensors.sort((a, b) => a.id - b.id);
      setSensors(nextSensors);

      if (settingsResponse.ok) {
        const settings: SettingsResponse = await settingsResponse.json();
        const nextHigh = safeNumber(
          settings.settings?.high_noise_threshold_db,
          DEFAULT_HIGH,
        );
        const nextCritical = safeNumber(
          settings.settings?.critical_noise_threshold_db,
          DEFAULT_CRITICAL,
        );
        setHighThreshold(nextHigh);
        setCriticalThreshold(nextCritical);
      }

      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "BACKEND_UNAVAILABLE");
    } finally {
      setLoading(false);
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
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let unmounted = false;

    const connect = () => {
      if (unmounted) return;

      socket = new WebSocket(WS_URL);

      socket.onopen = () => {
        if (!unmounted) {
          setConnected(true);
          setLastEvent("STREAM_CONNECTED");
        }
      };

      socket.onmessage = (event) => {
        if (unmounted) return;

        try {
          const message: WebSocketMessage = JSON.parse(event.data);
          if (message.type !== "noise_reading") return;

          const reading = message.data;
          if (
            !reading ||
            !Number.isFinite(Number(reading.sensor_id)) ||
            !Number.isFinite(Number(reading.noise_level))
          ) {
            return;
          }

          setReadings((current) => [
            reading,
            ...current.filter((item) => item.id !== reading.id),
          ].slice(0, MAX_STREAM_ROWS));

          const trendPoint: TrendPoint = {
            sensorId: Number(reading.sensor_id),
            level: Number(reading.noise_level),
            recordedAt: reading.recorded_at,
          };

          setTrend((current) => [
            ...current,
            trendPoint,
          ].slice(-MAX_TREND_POINTS));

          setSensors((current) =>
            current.map((sensor) =>
              sensor.id === Number(reading.sensor_id)
                ? {
                    ...sensor,
                    current_noise_level: Number(reading.noise_level),
                    status:
                      severityFor(
                        Number(reading.noise_level),
                        highThreshold,
                        criticalThreshold,
                      ),
                    updated_at: reading.recorded_at,
                  }
                : sensor,
            ),
          );

          setLastUpdate(reading.recorded_at);
          setLastEvent(reading.event_type || "NORMAL_ACTIVITY");
          setError("");
        } catch {
          setLastEvent("MALFORMED_STREAM_MESSAGE");
        }
      };

      socket.onerror = () => {
        if (!unmounted) setConnected(false);
      };

      socket.onclose = () => {
        if (unmounted) return;

        setConnected(false);
        reconnectTimer = window.setTimeout(connect, 3000);
      };
    };

    connect();

    return () => {
      unmounted = true;

      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }

      if (socket && socket.readyState !== WebSocket.CLOSED) {
        socket.close();
      }
    };
  }, [criticalThreshold, highThreshold]);

  const stats = useMemo(() => {
    const active = sensors.filter((sensor) => sensor.is_active);
    const values = active.map((sensor) => safeNumber(sensor.current_noise_level));
    const average =
      values.length > 0
        ? values.reduce((sum, value) => sum + value, 0) / values.length
        : 0;
    const peak = values.length > 0 ? Math.max(...values) : 0;

    const counts = active.reduce(
      (result, sensor) => {
        const severity = severityFor(
          safeNumber(sensor.current_noise_level),
          highThreshold,
          criticalThreshold,
        );
        if (severity === "NORMAL") result.normal += 1;
        if (severity === "MODERATE") result.moderate += 1;
        if (severity === "HIGH") result.high += 1;
        if (severity === "CRITICAL") result.critical += 1;
        return result;
      },
      { normal: 0, moderate: 0, high: 0, critical: 0 },
    );

    return {
      activeCount: active.length,
      average,
      peak,
      ...counts,
    };
  }, [sensors, highThreshold, criticalThreshold]);

  return (
    <section className="space-y-4" aria-label="Live noise monitoring">
      <div className="border border-[#1f521f] bg-[#080b08]">
        <div className="flex flex-col gap-3 border-b border-dashed border-[#1f521f] px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-bold text-[#33ff00]">
              <Radio size={15} />
              LIVE_MONITOR
            </div>
            <div className="mt-1 text-[9px] text-[#1f9e1f]">
              REAL-TIME SENSOR TELEMETRY // WEBSOCKET STREAM // LIVE STATE
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-[8px]">
            <span
              className={connected ? "text-[#33ff00]" : "text-[#ff3333]"}
            >
              {connected ? "[ LIVE_DATA_STREAMING ]" : "[ STREAM_OFFLINE ]"}
            </span>

            <span className="text-[#1f9e1f]">
              LAST_UPDATE:{" "}
              <span className="text-[#33ff00]">
                {formatTime(lastUpdate)}
              </span>
            </span>

            <button
              type="button"
              onClick={() => void refreshSensors()}
              disabled={refreshing}
              className="terminal-button inline-flex items-center gap-2 px-3 py-2 text-[9px] disabled:opacity-50"
            >
              <RefreshCw size={11} className={refreshing ? "animate-spin" : ""} />
              [ REFRESH ]
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3 xl:grid-cols-6">
          <div className="border border-[#1f521f] p-3">
            <Radio size={13} className="text-[#33ff00]" />
            <div className="mt-2 text-[8px] text-[#1f9e1f]">ACTIVE_SENSORS</div>
            <div className="mt-1 text-xl font-bold text-[#33ff00]">
              {stats.activeCount}/{sensors.length || 6}
            </div>
            <div className="text-[8px] text-[#1f9e1f]">ONLINE</div>
          </div>

          <div className="border border-[#1f521f] p-3">
            <Activity size={13} className="text-[#33ff00]" />
            <div className="mt-2 text-[8px] text-[#1f9e1f]">CURRENT_AVERAGE</div>
            <div className="mt-1 text-xl font-bold text-[#33ff00]">
              {stats.average.toFixed(1)}
              <span className="ml-1 text-[9px] text-[#ffb000]">dB</span>
            </div>
          </div>

          <div className="border border-[#1f521f] p-3">
            <AlertTriangle size={13} className="text-[#ff3333]" />
            <div className="mt-2 text-[8px] text-[#1f9e1f]">CURRENT_PEAK</div>
            <div className="mt-1 text-xl font-bold text-[#ff3333]">
              {stats.peak.toFixed(1)}
              <span className="ml-1 text-[9px] text-[#ffb000]">dB</span>
            </div>
          </div>

          <div className="border border-[#1f521f] p-3">
            <Zap size={13} className="text-[#33ff00]" />
            <div className="mt-2 text-[8px] text-[#1f9e1f]">NORMAL</div>
            <div className="mt-1 text-xl font-bold text-[#33ff00]">{stats.normal}</div>
            <div className="text-[8px] text-[#1f9e1f]">SENSORS</div>
          </div>

          <div className="border border-[#1f521f] p-3">
            <Zap size={13} className="text-[#ffb000]" />
            <div className="mt-2 text-[8px] text-[#1f9e1f]">HIGH</div>
            <div className="mt-1 text-xl font-bold text-[#ffb000]">{stats.high}</div>
            <div className="text-[8px] text-[#1f9e1f]">SENSORS</div>
          </div>

          <div className="border border-[#1f521f] p-3">
            <Zap size={13} className="text-[#ff3333]" />
            <div className="mt-2 text-[8px] text-[#1f9e1f]">CRITICAL</div>
            <div className="mt-1 text-xl font-bold text-[#ff3333]">{stats.critical}</div>
            <div className="text-[8px] text-[#1f9e1f]">SENSORS</div>
          </div>
        </div>
      </div>

      {error ? (
        <div className="border border-[#ff3333] bg-[#120606] p-3 text-[9px] text-[#ff3333]">
          <div>[ LIVE_MONITOR_ERROR ]</div>
          <div className="mt-1">{error}</div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(360px,0.9fr)]">
        <div className="border border-[#1f521f] bg-[#080b08]">
          <div className="flex items-center justify-between border-b border-dashed border-[#1f521f] px-3 py-2">
            <div className="flex items-center gap-2 text-[10px] text-[#33ff00]">
              <Server size={13} />
              SENSOR_STATUS
            </div>
            <span className="text-[8px] text-[#1f9e1f]">
              [ {sensors.length || 0} SENSORS ]
            </span>
          </div>

          <div className="grid gap-3 p-3 sm:grid-cols-2 xl:grid-cols-3">
            {loading && sensors.length === 0 ? (
              <div className="col-span-full py-10 text-center text-[9px] text-[#1f9e1f]">
                [ LOADING_SENSOR_TELEMETRY ]
              </div>
            ) : sensors.length === 0 ? (
              <div className="col-span-full py-10 text-center text-[9px] text-[#ff3333]">
                [ NO_SENSOR_DATA ]
              </div>
            ) : (
              sensors.map((sensor) => (
                <SensorCard
                  key={sensor.id}
                  sensor={sensor}
                  highThreshold={highThreshold}
                  criticalThreshold={criticalThreshold}
                />
              ))
            )}
          </div>
        </div>

        <div className="border border-[#1f521f] bg-[#080b08]">
          <div className="flex items-center justify-between border-b border-dashed border-[#1f521f] px-3 py-2">
            <div className="flex items-center gap-2 text-[10px] text-[#33ff00]">
              <Clock3 size={13} />
              RECENT_READINGS_STREAM
            </div>
            <span className={connected ? "text-[8px] text-[#33ff00]" : "text-[8px] text-[#ff3333]"}>
              [{connected ? "LIVE" : "OFFLINE"}]
            </span>
          </div>

          <div className="max-h-[430px] overflow-auto">
            <div className="min-w-[560px] text-[8px]">
              <div className="grid grid-cols-[70px_65px_1fr_55px_100px_75px] border-b border-[#1f521f] px-2 py-2 text-[#1f9e1f]">
                <span>TIME</span>
                <span>SENSOR</span>
                <span>LOCATION</span>
                <span>dB</span>
                <span>EVENT</span>
                <span>STATUS</span>
              </div>

              {readings.length === 0 ? (
                <div className="px-3 py-10 text-center text-[#1f9e1f]">
                  [ WAITING_FOR_LIVE_READINGS ]
                </div>
              ) : (
                readings.map((reading) => {
                  const sensor = sensors.find((item) => item.id === Number(reading.sensor_id));
                  const severity = severityFor(
                    Number(reading.noise_level),
                    highThreshold,
                    criticalThreshold,
                  );

                  return (
                    <div
                      key={`${reading.id}-${reading.recorded_at}`}
                      className="grid grid-cols-[70px_65px_1fr_55px_100px_75px] items-center border-b border-[#102510] px-2 py-2"
                    >
                      <span className="text-[#1f9e1f]">
                        {formatTime(reading.recorded_at)}
                      </span>
                      <span className="text-[#33ff00]">
                        {sensor?.sensor_code ?? `ID-${reading.sensor_id}`}
                      </span>
                      <span className="truncate text-[#1f9e1f]">
                        {sensor?.location ?? "UNKNOWN"}
                      </span>
                      <span className={severityClasses(severity).split(" ")[1]}>
                        {Number(reading.noise_level).toFixed(1)}
                      </span>
                      <span className="truncate text-[#1f9e1f]">
                        {eventLabel(reading.event_type)}
                      </span>
                      <span
                        className={`w-fit border px-1.5 py-1 ${severityClasses(
                          severity,
                        )}`}
                      >
                        {severity}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(300px,0.9fr)]">
        <TrendChart sensors={sensors} trend={trend} />

        <div className="border border-[#1f521f] bg-[#080b08]">
          <div className="flex items-center justify-between border-b border-dashed border-[#1f521f] px-3 py-2">
            <div className="flex items-center gap-2 text-[10px] text-[#33ff00]">
              <BarChart3 size={13} />
              EVENT_DISTRIBUTION
            </div>
            <span className="text-[8px] text-[#1f9e1f]">
              LAST {readings.length} EVENTS
            </span>
          </div>

          <div className="space-y-3 p-3">
            {Object.entries(
              readings.reduce<Record<string, number>>((counts, reading) => {
                const key = eventLabel(reading.event_type);
                counts[key] = (counts[key] ?? 0) + 1;
                return counts;
              }, {}),
            )
              .sort(([, a], [, b]) => b - a)
              .slice(0, 6)
              .map(([event, count]) => {
                const max = Math.max(
                  1,
                  ...Object.values(
                    readings.reduce<Record<string, number>>((counts, reading) => {
                      const key = eventLabel(reading.event_type);
                      counts[key] = (counts[key] ?? 0) + 1;
                      return counts;
                    }, {}),
                  ),
                );

                return (
                  <div key={event}>
                    <div className="flex items-center justify-between text-[8px]">
                      <span className="truncate text-[#1f9e1f]">{event}</span>
                      <span className="text-[#33ff00]">{count}</span>
                    </div>
                    <div className="mt-1 h-2 border border-[#1f521f]">
                      <div
                        className="h-full bg-[#33ff00]"
                        style={{ width: `${(count / max) * 100}%` }}
                      />
                    </div>
                  </div>
                );
              })}

            {readings.length === 0 ? (
              <div className="py-8 text-center text-[9px] text-[#1f9e1f]">
                [ WAITING_FOR_EVENT_DATA ]
              </div>
            ) : null}

            <div className="border-t border-dashed border-[#1f521f] pt-3 text-[8px] text-[#1f9e1f]">
              <div className="flex items-center gap-2">
                {connected ? (
                  <Wifi size={11} className="text-[#33ff00]" />
                ) : (
                  <WifiOff size={11} className="text-[#ff3333]" />
                )}
                <span>
                  STREAM: {connected ? "CONNECTED" : "DISCONNECTED"}
                </span>
              </div>
              <div className="mt-1">
                LAST_EVENT:{" "}
                <span className="text-[#33ff00]">{eventLabel(lastEvent)}</span>
              </div>
              <div className="mt-1">
                THRESHOLDS:{" "}
                <span className="text-[#ffb000]">
                  HIGH {highThreshold.toFixed(0)} / CRITICAL {criticalThreshold.toFixed(0)} dB
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="border border-dashed border-[#1f521f] p-3 text-[9px]">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <span className="text-[#1f9e1f]">DATA_SOURCE:</span>
          <span className="text-[#33ff00]">[ BACKEND + WEBSOCKET ]</span>
          <span className="text-[#1f9e1f]">LAST_EVENT:</span>
          <span className="text-[#33ff00]">{eventLabel(lastEvent)}</span>
          <span className="text-[#1f9e1f]">UPDATED:</span>
          <span className="text-[#33ff00]">{formatDateTime(lastUpdate)}</span>
          <span className="text-[#1f9e1f]">ENGINE:</span>
          <span className="text-[#33ff00]">[ LIVE ]</span>
        </div>
      </div>
    </section>
  );
}
