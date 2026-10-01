"use client";

import {
  AlertTriangle,
  BarChart3,
  Download,
  FileText,
  Printer,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import TerminalPanel from "@/components/ui/TerminalPanel";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/+$/, "") ||
  "http://127.0.0.1:8000";

type Source = "all" | "dataset" | "simulator" | "api" | "sensor";
type Severity = "all" | "MODERATE" | "HIGH" | "CRITICAL";
type Period = "all" | "DAY" | "NIGHT";

interface Sensor {
  id: number;
  sensor_code: string;
  name: string;
  location: string;
}

interface ReportIncident {
  incident_id?: string;
  sensor_code: string;
  sensor_name: string;
  location: string;
  severity: string;
  period: string;
  source: string;
  event_type: string;
  peak_db: number;
  average_db: number;
  allowed_db: number;
  excess_db: number;
  duration_minutes: number;
  reading_count: number;
  start_at: string | null;
  end_at: string | null;
}

interface ReportData {
  report: {
    title: string;
    generated_at: string;
    timezone: string;
    window: {
      hours: number;
      start: string;
      end: string;
    };
    filters: {
      source: string;
      sensor_id: number | null;
      period: string;
      severity: string;
    };
  };
  compliance: {
    area_category: string;
    day_limit_db: number;
    night_limit_db: number;
    day_window: string;
    night_window: string;
  };
  summary: {
    incident_count: number;
    critical_count: number;
    high_count: number;
    moderate_count: number;
    day_count: number;
    night_count: number;
    average_peak_db: number;
    highest_peak_db: number;
    highest_excess_db: number;
    total_incident_duration_minutes: number;
  };
  breakdowns: {
    by_source: Array<{ source: string; count: number }>;
    by_event_type: Array<{ event_type: string; count: number }>;
  };
  top_sensors: Array<{
    sensor_id: number;
    sensor_code: string;
    sensor_name: string;
    location: string;
    incident_count: number;
    critical_count: number;
    high_count: number;
    moderate_count: number;
    peak_db: number;
    max_excess_db: number;
  }>;
  peak_incident: ReportIncident | null;
  ai_analysis: {
    available: boolean;
    anomaly_count: number;
    critical_count: number;
    high_count: number;
    error?: string | null;
  };
  incidents: ReportIncident[];
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

function formatDuration(minutes: number) {
  if (minutes < 1) return "<1 MIN";
  if (minutes < 60) return `${minutes.toFixed(0)} MIN`;

  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);

  return mins ? `${hours}H ${mins}M` : `${hours}H`;
}

function sourceLabel(source: string) {
  return source.replace(/_/g, " ").toUpperCase();
}

function severityClass(severity: string) {
  if (severity === "CRITICAL") {
    return "text-[#ff3333]";
  }

  if (severity === "HIGH") {
    return "text-[#ffb000]";
  }

  return "text-[#33ff00]";
}

export default function ReportsPanel() {
  const [hours, setHours] = useState(24);
  const [source, setSource] = useState<Source>("all");
  const [period, setPeriod] = useState<Period>("all");
  const [severity, setSeverity] = useState<Severity>("all");
  const [sensorId, setSensorId] = useState<number | null>(null);

  const [sensors, setSensors] = useState<Sensor[]>([]);
  const [report, setReport] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

  const query = useMemo(() => {
    const params = new URLSearchParams({
      hours: String(hours),
      source,
      period,
      severity,
    });

    if (sensorId !== null) {
      params.set("sensor_id", String(sensorId));
    }

    return params.toString();
  }, [hours, source, period, severity, sensorId]);

  const loadSensors = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/sensors`, {
        cache: "no-store",
      });

      if (!response.ok) return;

      const payload = await response.json();
      const sensorList = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.sensors)
          ? payload.sensors
          : [];

      setSensors(sensorList);
    } catch {
      // Sensor selection remains optional if the endpoint is unavailable.
    }
  }, []);

  const generateReport = useCallback(async () => {
    setGenerating(true);
    setError("");

    try {
      const response = await fetch(
        `${API_BASE}/api/reports/generate?${query}`,
        { cache: "no-store" },
      );

      if (!response.ok) {
        throw new Error("Report generation request failed.");
      }

      const payload = (await response.json()) as ReportData;
      setReport(payload);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to generate report.",
      );
    } finally {
      setLoading(false);
      setGenerating(false);
    }
  }, [query]);

  useEffect(() => {
    void loadSensors();
  }, [loadSensors]);

  useEffect(() => {
    void generateReport();
  }, [generateReport]);

  const downloadCsv = useCallback(async () => {
    setError("");

    try {
      const response = await fetch(
        `${API_BASE}/api/reports/export.csv?${query}`,
        { cache: "no-store" },
      );

      if (!response.ok) {
        throw new Error("CSV export failed.");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");

      anchor.href = url;
      anchor.download = `noiseguard_report_${Date.now()}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to export CSV.",
      );
    }
  }, [query]);

  const sensorLabel =
    sensorId === null
      ? "ALL SENSORS"
      : sensors.find((sensor) => sensor.id === sensorId)?.sensor_code ??
        `SENSOR ${sensorId}`;

  const filterText = [
    `${hours}H`,
    sourceLabel(source),
    sensorLabel,
    period === "all" ? "ALL PERIODS" : period,
    severity === "all" ? "ALL SEVERITIES" : severity,
  ].join(" / ");

  return (
    <div className="space-y-4">
      <div className="print:hidden">
        <TerminalPanel title="REPORT GENERATOR">
          <div className="grid gap-3 md:grid-cols-5">
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
              SENSOR
              <select
                value={sensorId ?? ""}
                onChange={(event) =>
                  setSensorId(
                    event.target.value
                      ? Number(event.target.value)
                      : null,
                  )
                }
                className="mt-1 w-full border border-[#1f521f] bg-[#090909] px-2 py-2 text-[11px] text-[#33ff00] outline-none focus:border-[#33ff00]"
              >
                <option value="">ALL SENSORS</option>
                {sensors.map((sensor) => (
                  <option key={sensor.id} value={sensor.id}>
                    {sensor.sensor_code} — {sensor.location}
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
                root@noiseguard:~$ report --generate
              </div>
              <div className="mt-1 text-[8px] text-[#33ff00]">
                FILTER: {filterText}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void generateReport()}
                disabled={generating}
                className="terminal-button inline-flex items-center gap-2 px-3 py-2 text-[10px] font-bold disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RefreshCw
                  size={13}
                  className={generating ? "animate-spin" : ""}
                />
                [ GENERATE ]
              </button>

              <button
                type="button"
                onClick={() => void downloadCsv()}
                disabled={generating || !report}
                className="terminal-button inline-flex items-center gap-2 px-3 py-2 text-[10px] font-bold disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Download size={13} />
                [ CSV ]
              </button>

              <button
                type="button"
                onClick={() => window.print()}
                disabled={!report}
                className="terminal-button inline-flex items-center gap-2 px-3 py-2 text-[10px] font-bold disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Printer size={13} />
                [ PRINT / PDF ]
              </button>
            </div>
          </div>
        </TerminalPanel>
      </div>

      {error && (
        <div className="print:hidden">
          <TerminalPanel title="REPORT ERROR">
            <div className="flex items-center gap-2 text-[11px] text-[#ff3333]">
              <AlertTriangle size={14} />
              {error}
            </div>
          </TerminalPanel>
        </div>
      )}

      {loading && !report ? (
        <TerminalPanel title="REPORT OUTPUT">
          <div className="py-12 text-center text-[11px] text-[#1f9e1f]">
            root@noiseguard:~$ report --scan
            <span className="terminal-cursor" />
          </div>
        </TerminalPanel>
      ) : report ? (
        <>
          <div className="border border-[#1f521f] bg-[#0a0a0a] p-4">
            <div className="flex flex-col gap-3 border-b border-dashed border-[#1f521f] pb-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="text-[9px] text-[#1f9e1f]">
                  NOISEGUARD_AI :: OFFICIAL REPORT
                </div>
                <h1 className="terminal-glow mt-1 text-base font-bold text-[#33ff00]">
                  {report.report.title}
                </h1>
                <div className="mt-1 text-[9px] text-[#1f9e1f]">
                  GENERATED: {formatTime(report.report.generated_at)} IST
                </div>
              </div>

              <div className="text-[9px] text-[#1f9e1f] sm:text-right">
                <div>
                  WINDOW: LAST {report.report.window.hours} HOURS
                </div>
                <div className="mt-1">
                  SOURCE: {sourceLabel(report.report.filters.source)}
                </div>
                <div className="mt-1">
                  TIMEZONE: {report.report.timezone}
                </div>
              </div>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
              {[
                ["INCIDENTS", report.summary.incident_count],
                ["CRITICAL", report.summary.critical_count],
                ["HIGH", report.summary.high_count],
                ["MODERATE", report.summary.moderate_count],
                ["DAY", report.summary.day_count],
                ["NIGHT", report.summary.night_count],
              ].map(([label, value]) => (
                <div
                  key={String(label)}
                  className="border border-[#1f521f] p-3"
                >
                  <div className="text-[9px] text-[#1f9e1f]">
                    {label}
                  </div>
                  <div className="mt-1 text-2xl font-bold text-[#33ff00]">
                    {value}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <TerminalPanel title="COMPLIANCE SUMMARY">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="text-[9px] text-[#1f9e1f]">
                    AREA CATEGORY
                  </div>
                  <div className="mt-1 text-[11px] text-[#33ff00]">
                    {report.compliance.area_category}
                  </div>
                </div>

                <div>
                  <div className="text-[9px] text-[#1f9e1f]">
                    CODE LIMITS
                  </div>
                  <div className="mt-1 text-[11px] text-[#33ff00]">
                    DAY {report.compliance.day_limit_db} dB / NIGHT{" "}
                    {report.compliance.night_limit_db} dB
                  </div>
                </div>

                <div>
                  <div className="text-[9px] text-[#1f9e1f]">
                    AVERAGE PEAK
                  </div>
                  <div className="mt-1 text-[14px] font-bold text-[#ffb000]">
                    {report.summary.average_peak_db.toFixed(1)} dB
                  </div>
                </div>

                <div>
                  <div className="text-[9px] text-[#1f9e1f]">
                    HIGHEST PEAK
                  </div>
                  <div className="mt-1 text-[14px] font-bold text-[#ff3333]">
                    {report.summary.highest_peak_db.toFixed(1)} dB
                  </div>
                </div>

                <div>
                  <div className="text-[9px] text-[#1f9e1f]">
                    MAX EXCESS
                  </div>
                  <div className="mt-1 text-[14px] font-bold text-[#ffb000]">
                    +{report.summary.highest_excess_db.toFixed(1)} dB
                  </div>
                </div>

                <div>
                  <div className="text-[9px] text-[#1f9e1f]">
                    TOTAL INCIDENT TIME
                  </div>
                  <div className="mt-1 text-[14px] font-bold text-[#33ff00]">
                    {formatDuration(
                      report.summary.total_incident_duration_minutes,
                    )}
                  </div>
                </div>
              </div>
            </TerminalPanel>

            <TerminalPanel title="AI ANALYSIS">
              <div className="flex items-center gap-2 text-[10px]">
                <ShieldAlert
                  size={14}
                  className={
                    report.ai_analysis.available
                      ? "text-[#33ff00]"
                      : "text-[#ff3333]"
                  }
                />
                <span
                  className={
                    report.ai_analysis.available
                      ? "text-[#33ff00]"
                      : "text-[#ff3333]"
                  }
                >
                  {report.ai_analysis.available
                    ? "[ AI_CONTEXT_AVAILABLE ]"
                    : "[ AI_CONTEXT_UNAVAILABLE ]"}
                </span>
              </div>

              {report.ai_analysis.available ? (
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <div className="border border-[#1f521f] p-2">
                    <div className="text-[8px] text-[#1f9e1f]">
                      ANOMALIES
                    </div>
                    <div className="mt-1 text-lg text-[#33ff00]">
                      {report.ai_analysis.anomaly_count}
                    </div>
                  </div>

                  <div className="border border-[#1f521f] p-2">
                    <div className="text-[8px] text-[#1f9e1f]">
                      CRITICAL
                    </div>
                    <div className="mt-1 text-lg text-[#ff3333]">
                      {report.ai_analysis.critical_count}
                    </div>
                  </div>

                  <div className="border border-[#1f521f] p-2">
                    <div className="text-[8px] text-[#1f9e1f]">
                      HIGH
                    </div>
                    <div className="mt-1 text-lg text-[#ffb000]">
                      {report.ai_analysis.high_count}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mt-3 text-[9px] text-[#ff3333]">
                  {report.ai_analysis.error ??
                    "AI analysis was unavailable for this report."}
                </div>
              )}
            </TerminalPanel>
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
            <TerminalPanel title="TOP HOTSPOTS">
              {!report.top_sensors.length ? (
                <div className="py-8 text-center text-[10px] text-[#1f9e1f]">
                  [ INFO ] NO HOTSPOTS IN CURRENT REPORT
                </div>
              ) : (
                <div className="space-y-2">
                  {report.top_sensors.map((sensor, index) => (
                    <div
                      key={sensor.sensor_id}
                      className="border-b border-dashed border-[#1f521f] pb-2"
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
                        <span className="text-[10px] text-[#ffb000]">
                          {sensor.incident_count} INCIDENTS
                        </span>
                      </div>

                      <div className="mt-1 text-[8px] text-[#1f9e1f]">
                        {sensor.location}
                      </div>

                      <div className="mt-2 grid grid-cols-3 gap-2 text-[8px] text-[#1f9e1f]">
                        <div>
                          PEAK{" "}
                          <span className="text-[#33ff00]">
                            {sensor.peak_db.toFixed(1)}
                          </span>
                        </div>
                        <div>
                          EXCESS{" "}
                          <span className="text-[#ffb000]">
                            +{sensor.max_excess_db.toFixed(1)}
                          </span>
                        </div>
                        <div>
                          CRITICAL{" "}
                          <span className="text-[#ff3333]">
                            {sensor.critical_count}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </TerminalPanel>

            <TerminalPanel title="EVENT BREAKDOWN">
              <div className="space-y-2">
                {report.breakdowns.by_event_type.length ? (
                  report.breakdowns.by_event_type.map((event) => (
                    <div
                      key={event.event_type}
                      className="flex items-center justify-between border-b border-dashed border-[#1f521f] pb-2"
                    >
                      <span className="truncate pr-3 text-[9px] text-[#1f9e1f]">
                        {event.event_type}
                      </span>
                      <span className="text-[10px] font-bold text-[#33ff00]">
                        {event.count}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="py-8 text-center text-[9px] text-[#1f9e1f]">
                    [ INFO ] NO EVENTS
                  </div>
                )}
              </div>
            </TerminalPanel>
          </div>

          <TerminalPanel title="PEAK INCIDENT">
            {report.peak_incident ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
                <div>
                  <div className="text-[8px] text-[#1f9e1f]">
                    SENSOR
                  </div>
                  <div className="mt-1 text-[11px] font-bold text-[#33ff00]">
                    {report.peak_incident.sensor_code}
                  </div>
                </div>

                <div>
                  <div className="text-[8px] text-[#1f9e1f]">
                    PEAK
                  </div>
                  <div className="mt-1 text-[11px] font-bold text-[#ff3333]">
                    {report.peak_incident.peak_db.toFixed(1)} dB
                  </div>
                </div>

                <div>
                  <div className="text-[8px] text-[#1f9e1f]">
                    LIMIT
                  </div>
                  <div className="mt-1 text-[11px] text-[#33ff00]">
                    {report.peak_incident.allowed_db.toFixed(1)} dB
                  </div>
                </div>

                <div>
                  <div className="text-[8px] text-[#1f9e1f]">
                    EXCESS
                  </div>
                  <div className="mt-1 text-[11px] text-[#ffb000]">
                    +{report.peak_incident.excess_db.toFixed(1)} dB
                  </div>
                </div>

                <div>
                  <div className="text-[8px] text-[#1f9e1f]">
                    DURATION
                  </div>
                  <div className="mt-1 text-[11px] text-[#33ff00]">
                    {formatDuration(
                      report.peak_incident.duration_minutes,
                    )}
                  </div>
                </div>

                <div>
                  <div className="text-[8px] text-[#1f9e1f]">
                    SEVERITY
                  </div>
                  <div
                    className={`mt-1 text-[11px] font-bold ${severityClass(
                      report.peak_incident.severity,
                    )}`}
                  >
                    {report.peak_incident.severity}
                  </div>
                </div>

                <div className="sm:col-span-2 lg:col-span-6 border-t border-dashed border-[#1f521f] pt-2 text-[9px] text-[#1f9e1f]">
                  {report.peak_incident.location} ·{" "}
                  {report.peak_incident.event_type} ·{" "}
                  {sourceLabel(report.peak_incident.source)} ·{" "}
                  {report.peak_incident.reading_count} READINGS ·{" "}
                  {formatTime(report.peak_incident.start_at)} →{" "}
                  {formatTime(report.peak_incident.end_at)} IST
                </div>
              </div>
            ) : (
              <div className="text-[10px] text-[#1f9e1f]">
                [ INFO ] NO PEAK INCIDENT AVAILABLE
              </div>
            )}
          </TerminalPanel>

          <div className="print:hidden">
            <TerminalPanel title="INCIDENT REGISTER">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] border-collapse text-left text-[9px]">
                  <thead>
                    <tr className="border-b border-[#1f521f] text-[#1f9e1f]">
                      <th className="px-2 py-2">SENSOR</th>
                      <th className="px-2 py-2">SEVERITY</th>
                      <th className="px-2 py-2">PERIOD</th>
                      <th className="px-2 py-2">EVENT</th>
                      <th className="px-2 py-2">PEAK</th>
                      <th className="px-2 py-2">EXCESS</th>
                      <th className="px-2 py-2">DURATION</th>
                      <th className="px-2 py-2">START — IST</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.incidents.slice(0, 100).map((incident) => (
                      <tr
                        key={incident.incident_id ?? `${incident.sensor_code}-${incident.start_at}`}
                        className="border-b border-dashed border-[#1f521f]"
                      >
                        <td className="px-2 py-2 text-[#33ff00]">
                          {incident.sensor_code}
                        </td>
                        <td
                          className={`px-2 py-2 font-bold ${severityClass(
                            incident.severity,
                          )}`}
                        >
                          {incident.severity}
                        </td>
                        <td className="px-2 py-2 text-[#1f9e1f]">
                          {incident.period}
                        </td>
                        <td className="max-w-[180px] truncate px-2 py-2 text-[#1f9e1f]">
                          {incident.event_type}
                        </td>
                        <td className="px-2 py-2 text-[#ffb000]">
                          {incident.peak_db.toFixed(1)}
                        </td>
                        <td className="px-2 py-2 text-[#ffb000]">
                          +{incident.excess_db.toFixed(1)}
                        </td>
                        <td className="px-2 py-2 text-[#33ff00]">
                          {formatDuration(incident.duration_minutes)}
                        </td>
                        <td className="px-2 py-2 text-[#33ff00]">
                          {formatTime(incident.start_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {report.incidents.length > 100 && (
                <div className="mt-3 border-t border-dashed border-[#1f521f] pt-2 text-[8px] text-[#1f9e1f]">
                  [ INFO ] DISPLAYING FIRST 100 OF{" "}
                  {report.incidents.length} INCIDENTS. USE CSV EXPORT FOR
                  THE COMPLETE REPORT.
                </div>
              )}
            </TerminalPanel>
          </div>
        </>
      ) : null}

      <style jsx global>{`
        @media print {
          body {
            background: #ffffff !important;
            color: #000000 !important;
          }

          .terminal-panel,
          .terminal-border {
            border-color: #444444 !important;
            background: #ffffff !important;
            color: #000000 !important;
          }

          .terminal-glow,
          .text-\\[\\#33ff00\\],
          .text-\\[\\#ffb000\\],
          .text-\\[\\#ff3333\\],
          .text-\\[\\#1f9e1f\\] {
            color: #000000 !important;
            text-shadow: none !important;
          }

          .crt-overlay {
            display: none !important;
          }
        }
      `}</style>
    </div>
  );
}
