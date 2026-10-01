"use client";

import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Clock3,
  Gauge,
  RefreshCw,
  ShieldAlert,
  Siren,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import TerminalPanel from "@/components/ui/TerminalPanel";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000";

type Source = "all" | "dataset" | "simulator" | "api" | "sensor";
type Severity = "all" | "MODERATE" | "HIGH" | "CRITICAL";
type Period = "all" | "DAY" | "NIGHT";

interface Violation {
  id: number;
  incident_id?: string;
  sensor_id: number;
  sensor_code: string;
  sensor_name: string;
  location: string;
  measured_db: number;
  peak_db?: number;
  average_db?: number;
  allowed_db: number;
  excess_db: number;
  severity: Exclude<Severity, "all">;
  period: Exclude<Period, "all">;
  observed_at: string | null;
  start_at?: string | null;
  end_at?: string | null;
  duration_minutes?: number;
  reading_count?: number;
  source: string;
  event_type: string;
}

interface Summary {
  period: {
    hours: number;
    start: string;
    end: string;
  };
  source: Source;
  timezone?: string;
  count_mode?: string;
  limits: {
    day_db: number;
    night_db: number;
    day_window: string;
    night_window: string;
  };
  counts: {
    total: number;
    moderate: number;
    high: number;
    critical: number;
    day: number;
    night: number;
  };
}

interface ListResponse {
  count: number;
  total_incidents?: number;
  violations: Violation[];
}

const SOURCE_OPTIONS: Array<{ value: Source; label: string }> = [
  { value: "all", label: "ALL SOURCES" },
  { value: "dataset", label: "HISTORICAL DATASET" },
  { value: "simulator", label: "LIVE SIMULATOR" },
  { value: "api", label: "API" },
  { value: "sensor", label: "SENSOR" },
];

const PERIOD_OPTIONS: Array<{ value: Period; label: string }> = [
  { value: "all", label: "ALL PERIODS" },
  { value: "DAY", label: "DAY" },
  { value: "NIGHT", label: "NIGHT" },
];

const SEVERITY_OPTIONS: Array<{ value: Severity; label: string }> = [
  { value: "all", label: "ALL SEVERITIES" },
  { value: "CRITICAL", label: "CRITICAL" },
  { value: "HIGH", label: "HIGH" },
  { value: "MODERATE", label: "MODERATE" },
];

function formatTime(value: string | null | undefined) {
  if (!value) return "--";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";

  return date.toLocaleString("en-GB", {
    timeZone: "Asia/Kolkata",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(minutes: number | undefined) {
  if (minutes === undefined || minutes === null) return "--";
  if (minutes < 1) return "<1 MIN";
  if (minutes < 60) return `${minutes.toFixed(0)} MIN`;

  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);

  return mins ? `${hours}H ${mins}M` : `${hours}H`;
}

function severityClass(severity: Violation["severity"]) {
  if (severity === "CRITICAL") {
    return "border-[#ff3333] text-[#ff3333]";
  }

  if (severity === "HIGH") {
    return "border-[#ffb000] text-[#ffb000]";
  }

  return "border-[#33ff00] text-[#33ff00]";
}

function sourceLabel(source: string) {
  return source.replace(/_/g, " ").toUpperCase();
}

function calculateCounts(violations: Violation[]) {
  return {
    total: violations.length,
    moderate: violations.filter((item) => item.severity === "MODERATE").length,
    high: violations.filter((item) => item.severity === "HIGH").length,
    critical: violations.filter((item) => item.severity === "CRITICAL").length,
    day: violations.filter((item) => item.period === "DAY").length,
    night: violations.filter((item) => item.period === "NIGHT").length,
  };
}

export default function ViolationsPanel() {
  const [hours, setHours] = useState(24);
  const [source, setSource] = useState<Source>("all");
  const [period, setPeriod] = useState<Period>("all");
  const [severity, setSeverity] = useState<Severity>("all");

  const [summary, setSummary] = useState<Summary | null>(null);
  const [violations, setViolations] = useState<Violation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const query = useMemo(() => {
    const params = new URLSearchParams({
      hours: String(hours),
      source,
      period,
      severity,
      limit: "500",
    });

    return params.toString();
  }, [hours, source, period, severity]);

  const loadData = useCallback(
    async (manual = false) => {
      if (manual) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      setError("");

      try {
        const [summaryResponse, listResponse] = await Promise.all([
          fetch(
            `${API_BASE_URL}/api/violations/summary?hours=${hours}&source=${source}`,
            { cache: "no-store" },
          ),
          fetch(`${API_BASE_URL}/api/violations?${query}`, {
            cache: "no-store",
          }),
        ]);

        if (!summaryResponse.ok) {
          throw new Error("Violation summary request failed.");
        }

        if (!listResponse.ok) {
          throw new Error("Violation list request failed.");
        }

        const summaryPayload = (await summaryResponse.json()) as Summary;
        const listPayload = (await listResponse.json()) as ListResponse;

        setSummary(summaryPayload);
        setViolations(listPayload.violations ?? []);
        setExpandedId(null);
      } catch (requestError) {
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to load violations.",
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [hours, query, source],
  );

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const counts = useMemo(() => calculateCounts(violations), [violations]);

  const hotspots = useMemo(() => {
    const buckets = new Map<
      number,
      {
        sensor_id: number;
        sensor_code: string;
        sensor_name: string;
        location: string;
        violation_count: number;
        peak_db: number;
        max_excess_db: number;
      }
    >();

    for (const violation of violations) {
      const current = buckets.get(violation.sensor_id);

      if (!current) {
        buckets.set(violation.sensor_id, {
          sensor_id: violation.sensor_id,
          sensor_code: violation.sensor_code,
          sensor_name: violation.sensor_name,
          location: violation.location,
          violation_count: 1,
          peak_db: violation.peak_db ?? violation.measured_db,
          max_excess_db: violation.excess_db,
        });
        continue;
      }

      current.violation_count += 1;
      current.peak_db = Math.max(
        current.peak_db,
        violation.peak_db ?? violation.measured_db,
      );
      current.max_excess_db = Math.max(
        current.max_excess_db,
        violation.excess_db,
      );
    }

    return [...buckets.values()]
      .sort(
        (a, b) =>
          b.violation_count - a.violation_count ||
          b.max_excess_db - a.max_excess_db ||
          b.peak_db - a.peak_db,
      )
      .slice(0, 10);
  }, [violations]);

  const peakViolation = useMemo(() => {
    if (!violations.length) return null;

    return violations.reduce((peak, current) =>
      (current.peak_db ?? current.measured_db) >
      (peak.peak_db ?? peak.measured_db)
        ? current
        : peak,
    );
  }, [violations]);

  const metricCards: Array<{ label: string; value: number; Icon: LucideIcon }> = [
    { label: "TOTAL", value: counts.total, Icon: ShieldAlert },
    { label: "CRITICAL", value: counts.critical, Icon: Siren },
    { label: "HIGH", value: counts.high, Icon: AlertTriangle },
    { label: "MODERATE", value: counts.moderate, Icon: Gauge },
    { label: "DAY", value: counts.day, Icon: Clock3 },
    { label: "NIGHT", value: counts.night, Icon: Clock3 },
  ];

  const filterDescription = [
    `${hours}H WINDOW`,
    source === "all" ? "ALL SOURCES" : sourceLabel(source),
    period === "all" ? "ALL PERIODS" : period,
    severity === "all" ? "ALL SEVERITIES" : severity,
  ].join(" / ");

  return (
    <div className="space-y-4">
      <TerminalPanel title="VIOLATION CONTROL">
        <div className="grid gap-3 md:grid-cols-4">
          <label className="text-[10px] text-[#1f9e1f]">
            TIME WINDOW
            <select
              value={hours}
              onChange={(event) => setHours(Number(event.target.value))}
              className="mt-1 w-full border border-[#1f521f] bg-[#090909] px-2 py-2 text-[11px] text-[#33ff00] outline-none focus:border-[#33ff00]"
            >
              <option value={24}>LAST 24 HOURS</option>
              <option value={72}>LAST 72 HOURS</option>
              <option value={168}>LAST 7 DAYS</option>
              <option value={720}>LAST 30 DAYS</option>
            </select>
          </label>

          <label className="text-[10px] text-[#1f9e1f]">
            SOURCE
            <select
              value={source}
              onChange={(event) =>
                setSource(event.target.value as Source)
              }
              className="mt-1 w-full border border-[#1f521f] bg-[#090909] px-2 py-2 text-[11px] text-[#33ff00] outline-none focus:border-[#33ff00]"
            >
              {SOURCE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-[10px] text-[#1f9e1f]">
            PERIOD
            <select
              value={period}
              onChange={(event) =>
                setPeriod(event.target.value as Period)
              }
              className="mt-1 w-full border border-[#1f521f] bg-[#090909] px-2 py-2 text-[11px] text-[#33ff00] outline-none focus:border-[#33ff00]"
            >
              {PERIOD_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-[10px] text-[#1f9e1f]">
            SEVERITY
            <select
              value={severity}
              onChange={(event) =>
                setSeverity(event.target.value as Severity)
              }
              className="mt-1 w-full border border-[#1f521f] bg-[#090909] px-2 py-2 text-[11px] text-[#33ff00] outline-none focus:border-[#33ff00]"
            >
              {SEVERITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-3 flex flex-col gap-3 border-t border-dashed border-[#1f521f] pt-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-[10px] text-[#1f9e1f]">
              CODE LIMITS: DAY {summary?.limits.day_db ?? 55} dB /
              NIGHT {summary?.limits.night_db ?? 45} dB
            </div>
            <div className="mt-1 text-[8px] text-[#1f9e1f]">
              TIMEZONE: {summary?.timezone ?? "Asia/Kolkata"} ·
              GROUPING: INCIDENTS
            </div>
          </div>

          <button
            type="button"
            onClick={() => void loadData(true)}
            disabled={loading || refreshing}
            className="terminal-button inline-flex items-center justify-center gap-2 px-3 py-2 text-[10px] font-bold disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw
              size={13}
              className={refreshing ? "animate-spin" : ""}
            />
            [ REFRESH ]
          </button>
        </div>

        <div className="mt-3 border-t border-dashed border-[#1f521f] pt-2 text-[8px] text-[#1f9e1f]">
          root@noiseguard:~$ violations --filter {filterDescription}
        </div>
      </TerminalPanel>

      {error && (
        <TerminalPanel title="VIOLATION ERROR">
          <div className="flex items-center gap-2 text-[11px] text-[#ff3333]">
            <AlertTriangle size={14} />
            {error}
          </div>
        </TerminalPanel>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {metricCards.map(({ label, value, Icon }) => (
          <div key={label} className="terminal-panel min-w-0 p-3">
            <div className="flex items-center gap-2 text-[9px] text-[#1f9e1f]">
              <Icon size={13} />
              {label}
            </div>
            <div className="mt-2 text-2xl font-bold text-[#33ff00]">
              {value}
            </div>
            <div className="mt-1 text-[9px] text-[#1f9e1f]">
              FILTERED INCIDENTS
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <TerminalPanel title="VIOLATION LOG">
          <div className="mb-3 flex items-center justify-between border-b border-dashed border-[#1f521f] pb-2">
            <span className="text-[9px] text-[#1f9e1f]">
              INCIDENTS MATCHED
            </span>
            <span className="text-[10px] font-bold text-[#33ff00]">
              {violations.length}
            </span>
          </div>

          {loading ? (
            <div className="py-10 text-center text-[11px] text-[#1f9e1f]">
              root@noiseguard:~$ violations --scan
              <span className="terminal-cursor" />
            </div>
          ) : violations.length === 0 ? (
            <div className="py-10 text-center text-[11px] text-[#1f9e1f]">
              [ OK ] NO VIOLATIONS MATCH CURRENT FILTERS
            </div>
          ) : (
            <div className="space-y-2">
              {violations.map((violation) => {
                const expanded = expandedId === violation.id;
                const peakDb = violation.peak_db ?? violation.measured_db;
                const averageDb =
                  violation.average_db ?? violation.measured_db;

                return (
                  <div
                    key={violation.incident_id ?? violation.id}
                    className="border border-[#1f521f] bg-[#090909]"
                  >
                    <button
                      type="button"
                      aria-expanded={expanded}
                      onClick={() =>
                        setExpandedId(expanded ? null : violation.id)
                      }
                      className="flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-[#111711]"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[11px] font-bold text-[#33ff00]">
                            {violation.sensor_code}
                          </span>

                          <span
                            className={`border px-1.5 py-0.5 text-[8px] font-bold ${severityClass(
                              violation.severity,
                            )}`}
                          >
                            {violation.severity}
                          </span>

                          <span className="text-[8px] text-[#1f9e1f]">
                            {violation.period}
                          </span>

                          <span className="text-[8px] text-[#1f9e1f]">
                            {sourceLabel(violation.source)}
                          </span>
                        </div>

                        <div className="mt-1 truncate text-[10px] text-[#1f9e1f]">
                          {violation.location} · {violation.event_type}
                        </div>
                      </div>

                      <div className="hidden shrink-0 text-right sm:block">
                        <div className="text-[8px] text-[#1f9e1f]">
                          PEAK
                        </div>
                        <div className="text-sm font-bold text-[#ffb000]">
                          {peakDb.toFixed(1)} dB
                        </div>
                      </div>

                      <div className="shrink-0 text-right">
                        <div className="text-[8px] text-[#1f9e1f]">
                          EXCESS
                        </div>
                        <div className="text-[10px] font-bold text-[#ffb000]">
                          +{violation.excess_db.toFixed(1)} dB
                        </div>
                      </div>

                      {expanded ? (
                        <ChevronUp size={14} />
                      ) : (
                        <ChevronDown size={14} />
                      )}
                    </button>

                    {expanded && (
                      <div className="grid gap-3 border-t border-dashed border-[#1f521f] px-3 py-3 text-[9px] text-[#1f9e1f] sm:grid-cols-2 lg:grid-cols-3">
                        <div>
                          SENSOR
                          <div className="mt-1 text-[#33ff00]">
                            {violation.sensor_name}
                          </div>
                        </div>

                        <div>
                          SOURCE
                          <div className="mt-1 text-[#33ff00]">
                            {sourceLabel(violation.source)}
                          </div>
                        </div>

                        <div>
                          EVENT TYPE
                          <div className="mt-1 text-[#33ff00]">
                            {violation.event_type}
                          </div>
                        </div>

                        <div>
                          PEAK
                          <div className="mt-1 font-bold text-[#ff3333]">
                            {peakDb.toFixed(1)} dB
                          </div>
                        </div>

                        <div>
                          AVERAGE
                          <div className="mt-1 text-[#33ff00]">
                            {averageDb.toFixed(1)} dB
                          </div>
                        </div>

                        <div>
                          ALLOWED
                          <div className="mt-1 text-[#33ff00]">
                            {violation.allowed_db.toFixed(1)} dB
                          </div>
                        </div>

                        <div>
                          EXCESS
                          <div className="mt-1 font-bold text-[#ffb000]">
                            +{violation.excess_db.toFixed(1)} dB
                          </div>
                        </div>

                        <div>
                          DURATION
                          <div className="mt-1 text-[#33ff00]">
                            {formatDuration(violation.duration_minutes)}
                          </div>
                        </div>

                        <div>
                          READINGS
                          <div className="mt-1 text-[#33ff00]">
                            {violation.reading_count ?? "--"}
                          </div>
                        </div>

                        <div>
                          START — IST
                          <div className="mt-1 text-[#33ff00]">
                            {formatTime(
                              violation.start_at ?? violation.observed_at,
                            )}
                          </div>
                        </div>

                        <div>
                          END — IST
                          <div className="mt-1 text-[#33ff00]">
                            {formatTime(
                              violation.end_at ?? violation.observed_at,
                            )}
                          </div>
                        </div>

                        <div>
                          INCIDENT ID
                          <div className="mt-1 truncate text-[#33ff00]">
                            {violation.incident_id ?? `READING-${violation.id}`}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </TerminalPanel>

        <TerminalPanel title="HOTSPOT VIOLATIONS">
          {!hotspots.length ? (
            <div className="py-8 text-center text-[10px] text-[#1f9e1f]">
              [ INFO ] NO VIOLATION HOTSPOTS
            </div>
          ) : (
            <div className="space-y-3">
              {hotspots.map((sensor, index) => (
                <div
                  key={sensor.sensor_id}
                  className="border-b border-dashed border-[#1f521f] pb-3 last:border-b-0"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <span className="mr-2 text-[#ffb000]">
                        #{index + 1}
                      </span>
                      <span className="text-[10px] font-bold text-[#33ff00]">
                        {sensor.sensor_code}
                      </span>
                    </div>

                    <span className="shrink-0 text-[11px] font-bold text-[#ffb000]">
                      {sensor.violation_count}
                    </span>
                  </div>

                  <div className="mt-1 truncate text-[9px] text-[#1f9e1f]">
                    {sensor.location}
                  </div>

                  <div className="mt-2 grid grid-cols-2 gap-2 text-[8px] text-[#1f9e1f]">
                    <div>
                      INCIDENTS{" "}
                      <span className="text-[#33ff00]">
                        {sensor.violation_count}
                      </span>
                    </div>

                    <div>
                      PEAK{" "}
                      <span className="text-[#33ff00]">
                        {sensor.peak_db.toFixed(1)} dB
                      </span>
                    </div>

                    <div>
                      MAX EXCESS{" "}
                      <span className="text-[#ffb000]">
                        +{sensor.max_excess_db.toFixed(1)} dB
                      </span>
                    </div>

                    <div>
                      RISK{" "}
                      <span className="text-[#ff3333]">
                        {sensor.max_excess_db >= 30
                          ? "CRITICAL"
                          : sensor.max_excess_db >= 15
                            ? "HIGH"
                            : "MODERATE"}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TerminalPanel>
      </div>

      <TerminalPanel title="PEAK VIOLATION">
        {peakViolation ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <div>
              <div className="text-[8px] text-[#1f9e1f]">SENSOR</div>
              <div className="mt-1 text-[11px] font-bold text-[#33ff00]">
                {peakViolation.sensor_code}
              </div>
            </div>

            <div>
              <div className="text-[8px] text-[#1f9e1f]">PEAK</div>
              <div className="mt-1 text-[11px] font-bold text-[#ff3333]">
                {(peakViolation.peak_db ?? peakViolation.measured_db).toFixed(
                  1,
                )}{" "}
                dB
              </div>
            </div>

            <div>
              <div className="text-[8px] text-[#1f9e1f]">LIMIT</div>
              <div className="mt-1 text-[11px] font-bold text-[#33ff00]">
                {peakViolation.allowed_db.toFixed(1)} dB
              </div>
            </div>

            <div>
              <div className="text-[8px] text-[#1f9e1f]">EXCESS</div>
              <div className="mt-1 text-[11px] font-bold text-[#ffb000]">
                +{peakViolation.excess_db.toFixed(1)} dB
              </div>
            </div>

            <div>
              <div className="text-[8px] text-[#1f9e1f]">DURATION</div>
              <div className="mt-1 text-[11px] font-bold text-[#33ff00]">
                {formatDuration(peakViolation.duration_minutes)}
              </div>
            </div>

            <div>
              <div className="text-[8px] text-[#1f9e1f]">OBSERVED — IST</div>
              <div className="mt-1 text-[10px] font-bold text-[#33ff00]">
                {formatTime(
                  peakViolation.start_at ?? peakViolation.observed_at,
                )}
              </div>
            </div>

            <div className="sm:col-span-2 lg:col-span-6">
              <div className="border-t border-dashed border-[#1f521f] pt-2 text-[9px] text-[#1f9e1f]">
                {peakViolation.location} · {peakViolation.event_type} ·{" "}
                {sourceLabel(peakViolation.source)} ·{" "}
                {peakViolation.reading_count ?? "--"} READINGS
              </div>
            </div>
          </div>
        ) : (
          <div className="text-[10px] text-[#1f9e1f]">
            [ INFO ] NO PEAK VIOLATION AVAILABLE
          </div>
        )}
      </TerminalPanel>
    </div>
  );
}
