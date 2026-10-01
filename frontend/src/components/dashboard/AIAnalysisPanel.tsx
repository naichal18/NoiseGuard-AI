"use client";

import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock3,
  Database,
  RefreshCw,
  Radio,
  Target,
  TrendingUp,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

const API_BASE_URL = "http://127.0.0.1:8000";

type SourceFilter = "all" | "dataset" | "simulator" | "api" | "sensor";
type PeriodFilter = 24 | 168;

interface Recommendation {
  recommendation_id: string;
  generated_at: string;

  sensor_id: number;
  sensor_code: string | null;
  sensor_name: string | null;
  location: string | null;

  event_id: string | number;
  event_type: string;
  source: string;

  severity: string;
  priority: string;

  anomaly_score: number;
  confidence: number;

  peak_noise: number;
  average_noise: number;
  baseline_noise: number;
  baseline_std_dev: number;
  z_score: number;
  deviation_db: number;

  duration_minutes: number;
  reading_count: number;

  recommendation: string;
  action: string;

  /*
   * Backend versions may return evidence in different shapes.
   * We normalize it before rendering.
   */
  evidence:
    | string[]
    | string
    | Record<string, unknown>
    | null
    | undefined;
}

interface RecommendationsResponse {
  analysis: {
    period_hours: number;
    baseline_hours: number;
    sensor_id: number | null;
    source: string;
    anomaly_count: number;
    recommendation_count: number;
  };

  recommendations: Recommendation[];
}

interface SensorSummary {
  id: number;
  sensor_code: string;
  name: string;
  location: string;
  current_noise_level: number;
  status: string;
  is_active: boolean;
}

/* -------------------------------------------------------------------------- */
/* HELPERS                                                                    */
/* -------------------------------------------------------------------------- */

function safeNumber(
  value: number | null | undefined,
): number {
  return Number.isFinite(value) ? Number(value) : 0;
}

function formatNumber(
  value: number | null | undefined,
  decimals = 1,
): string {
  return safeNumber(value).toFixed(decimals);
}

function formatDate(value: string): string {
  if (!value) {
    return "--";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "--";
  }

  return date.toLocaleString();
}

/*
 * Converts backend evidence into a safe string array.
 *
 * Supported:
 * - ["item 1", "item 2"]
 * - "single evidence"
 * - { key: "value" }
 * - null / undefined
 */
function normalizeEvidence(
  evidence: Recommendation["evidence"],
): string[] {
  if (Array.isArray(evidence)) {
    return evidence
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }

        if (
          typeof item === "number" ||
          typeof item === "boolean"
        ) {
          return String(item);
        }

        if (
          item !== null &&
          typeof item === "object"
        ) {
          try {
            return JSON.stringify(item);
          } catch {
            return "";
          }
        }

        return "";
      })
      .filter(Boolean);
  }

  if (typeof evidence === "string") {
    return evidence.trim() ? [evidence] : [];
  }

  if (
    evidence !== null &&
    evidence !== undefined &&
    typeof evidence === "object"
  ) {
    return Object.entries(evidence)
      .map(([key, value]) => {
        if (
          typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean"
        ) {
          return `${key}: ${value}`;
        }

        try {
          return `${key}: ${JSON.stringify(value)}`;
        } catch {
          return "";
        }
      })
      .filter(Boolean);
  }

  return [];
}

function severityClass(severity: string): string {
  const normalized = severity.toUpperCase();

  if (normalized === "CRITICAL") {
    return "border-red-500/60 text-red-400";
  }

  if (normalized === "HIGH") {
    return "border-orange-500/60 text-orange-400";
  }

  if (normalized === "MODERATE") {
    return "border-yellow-500/60 text-yellow-400";
  }

  return "border-green-500/60 text-green-400";
}

function severityIcon(severity: string) {
  const normalized = severity.toUpperCase();

  if (normalized === "CRITICAL") {
    return <AlertTriangle size={14} />;
  }

  if (normalized === "HIGH") {
    return <Zap size={14} />;
  }

  if (normalized === "MODERATE") {
    return <TrendingUp size={14} />;
  }

  return <CheckCircle2 size={14} />;
}

function sourceIcon(source: string) {
  if (source === "dataset") {
    return <Database size={13} />;
  }

  if (source === "simulator") {
    return <Radio size={13} />;
  }

  return <Target size={13} />;
}

/* -------------------------------------------------------------------------- */
/* STAT CARD                                                                  */
/* -------------------------------------------------------------------------- */

function StatCard({
  label,
  value,
  unit,
  icon,
}: {
  label: string;
  value: string | number;
  unit?: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="terminal-panel min-w-0 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="text-[10px] tracking-[0.22em] text-[#1f8a1f]">
          {label}
        </span>

        <span className="text-[#33ff00]">
          {icon}
        </span>
      </div>

      <div className="flex items-end gap-2">
        <span className="text-2xl font-bold leading-none text-[#33ff00] terminal-glow">
          {value}
        </span>

        {unit ? (
          <span className="pb-0.5 text-[10px] text-[#1f8a1f]">
            {unit}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* PROGRESS BAR                                                               */
/* -------------------------------------------------------------------------- */

function ProgressBar({
  value,
  label,
}: {
  value: number;
  label?: string;
}) {
  const percentage = Math.max(
    0,
    Math.min(100, safeNumber(value)),
  );

  const blocks = 20;
  const filled = Math.round(
    (percentage / 100) * blocks,
  );

  return (
    <div className="min-w-0">
      {label ? (
        <div className="mb-1 flex justify-between text-[9px] tracking-wider text-[#1f8a1f]">
          <span>{label}</span>
          <span>{percentage.toFixed(0)}%</span>
        </div>
      ) : null}

      <div className="overflow-hidden font-mono text-[9px] leading-none text-[#33ff00]">
        {"█".repeat(filled)}

        <span className="text-[#163b16]">
          {"░".repeat(blocks - filled)}
        </span>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* RECOMMENDATION CARD                                                        */
/* -------------------------------------------------------------------------- */

function RecommendationCard({
  recommendation,
}: {
  recommendation: Recommendation;
}) {
  const severity =
    recommendation.severity?.toUpperCase() ||
    "NORMAL";

  const evidence = normalizeEvidence(
    recommendation.evidence,
  );

  return (
    <article className="terminal-panel overflow-hidden">
      {/* CARD HEADER */}
      <div className="flex flex-col gap-3 border-b border-[#1f521f] p-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="text-[10px] text-[#1f8a1f]">
              {recommendation.recommendation_id}
            </span>

            <span
              className={`flex items-center gap-1 border px-2 py-1 text-[9px] tracking-widest ${severityClass(
                severity,
              )}`}
            >
              {severityIcon(severity)}
              {severity}
            </span>

            <span className="border border-[#1f521f] px-2 py-1 text-[9px] text-[#ffb000]">
              {(
                recommendation.priority || "NORMAL"
              ).toUpperCase()}
            </span>
          </div>

          <h3 className="truncate text-sm font-bold tracking-wide text-[#33ff00] terminal-glow">
            {recommendation.sensor_code ||
              "UNKNOWN_SENSOR"}
          </h3>

          <p className="mt-1 text-[10px] text-[#5f9f5f]">
            {recommendation.sensor_name ||
              "UNKNOWN SENSOR"}

            <span className="text-[#1f521f]">
              {" "}
              //{" "}
            </span>

            {recommendation.location ||
              "UNKNOWN LOCATION"}
          </p>
        </div>

        <div className="shrink-0 text-left lg:text-right">
          <div className="text-[9px] tracking-[0.18em] text-[#1f8a1f]">
            EVENT
          </div>

          <div className="mt-1 text-[11px] text-[#ffb000]">
            {recommendation.event_type ||
              "UNKNOWN_EVENT"}
          </div>

          <div className="mt-1 flex items-center gap-1 text-[9px] text-[#5f9f5f] lg:justify-end">
            {sourceIcon(
              recommendation.source || "unknown",
            )}

            {(
              recommendation.source || "unknown"
            ).toUpperCase()}
          </div>
        </div>
      </div>

      {/* PRIMARY METRICS */}
      <div className="grid grid-cols-2 gap-px bg-[#1f521f] md:grid-cols-4">
        <div className="bg-[#0d0d0d] p-3">
          <div className="text-[9px] text-[#1f8a1f]">
            PEAK
          </div>

          <div className="mt-1 text-lg text-[#ffb000]">
            {formatNumber(
              recommendation.peak_noise,
            )}

            <span className="ml-1 text-[9px] text-[#5f9f5f]">
              dB
            </span>
          </div>
        </div>

        <div className="bg-[#0d0d0d] p-3">
          <div className="text-[9px] text-[#1f8a1f]">
            AVERAGE
          </div>

          <div className="mt-1 text-lg text-[#33ff00]">
            {formatNumber(
              recommendation.average_noise,
            )}

            <span className="ml-1 text-[9px] text-[#5f9f5f]">
              dB
            </span>
          </div>
        </div>

        <div className="bg-[#0d0d0d] p-3">
          <div className="text-[9px] text-[#1f8a1f]">
            BASELINE
          </div>

          <div className="mt-1 text-lg text-[#33ff00]">
            {formatNumber(
              recommendation.baseline_noise,
            )}

            <span className="ml-1 text-[9px] text-[#5f9f5f]">
              dB
            </span>
          </div>
        </div>

        <div className="bg-[#0d0d0d] p-3">
          <div className="text-[9px] text-[#1f8a1f]">
            DURATION
          </div>

          <div className="mt-1 text-lg text-[#33ff00]">
            {formatNumber(
              recommendation.duration_minutes,
            )}

            <span className="ml-1 text-[9px] text-[#5f9f5f]">
              MIN
            </span>
          </div>
        </div>
      </div>

      {/* AI DETAILS */}
      <div className="space-y-4 p-4">
        <div>
          <div className="mb-2 text-[9px] tracking-[0.2em] text-[#1f8a1f]">
            AI_ANOMALY_ANALYSIS
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <ProgressBar
              value={recommendation.anomaly_score}
              label="ANOMALY_SCORE"
            />

            <ProgressBar
              value={recommendation.confidence}
              label="CONFIDENCE"
            />
          </div>
        </div>

        {/* SECONDARY METRICS */}
        <div className="grid gap-3 text-[10px] sm:grid-cols-2 lg:grid-cols-4">
          <div className="border border-[#1f521f] p-2">
            <div className="text-[#1f8a1f]">
              DEVIATION
            </div>

            <div className="mt-1 text-[#ffb000]">
              {recommendation.deviation_db >= 0
                ? "+"
                : ""}
              {formatNumber(
                recommendation.deviation_db,
              )}{" "}
              dB
            </div>
          </div>

          <div className="border border-[#1f521f] p-2">
            <div className="text-[#1f8a1f]">
              Z_SCORE
            </div>

            <div className="mt-1 text-[#33ff00]">
              {formatNumber(
                recommendation.z_score,
                2,
              )}
            </div>
          </div>

          <div className="border border-[#1f521f] p-2">
            <div className="text-[#1f8a1f]">
              STD_DEV
            </div>

            <div className="mt-1 text-[#33ff00]">
              {formatNumber(
                recommendation.baseline_std_dev,
                2,
              )}
            </div>
          </div>

          <div className="border border-[#1f521f] p-2">
            <div className="text-[#1f8a1f]">
              READINGS
            </div>

            <div className="mt-1 text-[#33ff00]">
              {recommendation.reading_count ?? 0}
            </div>
          </div>
        </div>

        {/* AI RECOMMENDATION */}
        <div className="border-l-2 border-[#33ff00] bg-[#0a120a] p-3">
          <div className="mb-2 flex items-center gap-2 text-[9px] tracking-[0.2em] text-[#33ff00]">
            <Bot size={13} />

            AI_RECOMMENDATION
          </div>

          <p className="text-xs leading-6 text-[#a8d8a8]">
            {recommendation.recommendation ||
              "No recommendation returned by the AI engine."}
          </p>
        </div>

        {/* ACTION */}
        <div className="border border-dashed border-[#1f521f] p-3">
          <div className="mb-2 text-[9px] tracking-[0.2em] text-[#ffb000]">
            RECOMMENDED_ACTION
          </div>

          <p className="text-[11px] leading-5 text-[#d2d2d2]">
            {recommendation.action ||
              "No action returned by the AI engine."}
          </p>
        </div>

        {/* EVIDENCE */}
        {evidence.length > 0 ? (
          <div>
            <div className="mb-2 text-[9px] tracking-[0.2em] text-[#1f8a1f]">
              EVIDENCE
            </div>

            <div className="space-y-1">
              {evidence.map((item, index) => (
                <div
                  key={`${recommendation.recommendation_id}-evidence-${index}`}
                  className="text-[10px] leading-5 text-[#7fb57f]"
                >
                  <span className="mr-2 text-[#33ff00]">
                    &gt;
                  </span>

                  {item}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="text-[9px] text-[#315631]">
            &gt; NO_ADDITIONAL_EVIDENCE_RETURNED
          </div>
        )}

        {/* FOOTER */}
        <div className="flex flex-col gap-1 border-t border-[#1f521f] pt-3 text-[9px] text-[#4c804c] sm:flex-row sm:items-center sm:justify-between">
          <span>
            EVENT_ID:{" "}
            {recommendation.event_id ?? "--"}
          </span>

          <span className="flex items-center gap-1">
            <Clock3 size={11} />

            {formatDate(
              recommendation.generated_at,
            )}
          </span>
        </div>
      </div>
    </article>
  );
}

/* -------------------------------------------------------------------------- */
/* MAIN COMPONENT                                                             */
/* -------------------------------------------------------------------------- */

export default function AIAnalysisPanel() {
  const [period, setPeriod] =
    useState<PeriodFilter>(24);

  const [source, setSource] =
    useState<SourceFilter>("all");

  const [data, setData] =
    useState<RecommendationsResponse | null>(
      null,
    );

  const [loading, setLoading] =
    useState(true);

  const [refreshing, setRefreshing] =
    useState(false);

  const [error, setError] =
    useState<string | null>(null);

  const [sensors, setSensors] =
    useState<SensorSummary[]>([]);

  /* ---------------------------------------------------------------------- */
  /* FETCH LIVE SENSOR NETWORK                                                */
  /* ---------------------------------------------------------------------- */

  const fetchSensors = useCallback(async () => {
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/sensors?_ai_refresh=${Date.now()}`,
        {
          cache: "no-store",
        },
      );

      if (!response.ok) {
        return;
      }

      const payload = await response.json();

      const rawRows: unknown[] = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.sensors)
          ? payload.sensors
          : [];

      const rows: Record<string, unknown>[] = rawRows.filter(
        (item: unknown): item is Record<string, unknown> =>
          item !== null &&
          typeof item === "object" &&
          !Array.isArray(item),
      );

      const normalizedSensors: SensorSummary[] = rows
        .map((item: Record<string, unknown>) => ({
          id: Number(item.id),
          sensor_code: String(
            item.sensor_code ?? item.code ?? `SENSOR-${item.id ?? "--"}`,
          ),
          name: String(
            item.name ?? item.sensor_name ?? "UNKNOWN SENSOR",
          ),
          location: String(
            item.location ?? "UNKNOWN LOCATION",
          ),
          current_noise_level: safeNumber(
            Number(
              item.current_noise_level ??
                item.noise_level ??
                item.currentNoiseLevel,
            ),
          ),
          status: String(item.status ?? "UNKNOWN"),
          is_active: item.is_active !== false,
        }))
        .filter(
          (sensor: SensorSummary) =>
            Number.isFinite(sensor.id) &&
            sensor.is_active,
        )
        .sort(
          (a: SensorSummary, b: SensorSummary) =>
            a.id - b.id,
        );

      setSensors(normalizedSensors);
    } catch {
      // Keep the last successful sensor snapshot visible.
    }
  }, []);

  /* ---------------------------------------------------------------------- */
  /* FETCH AI ANALYSIS                                                       */
  /* ---------------------------------------------------------------------- */

  const fetchRecommendations = useCallback(
    async (isRefresh = false) => {
      try {
        if (isRefresh) {
          setRefreshing(true);
        } else {
          setLoading(true);
        }

        setError(null);

        const params = new URLSearchParams({
          hours: String(period),
          baseline_hours: String(period),
          limit: "100",
          source,
        });

        const response = await fetch(
          `${API_BASE_URL}/api/analytics/recommendations?${params.toString()}`,
          {
            cache: "no-store",
          },
        );

        if (!response.ok) {
          throw new Error(
            `AI analysis request failed with HTTP ${response.status}`,
          );
        }

        const result =
          (await response.json()) as RecommendationsResponse;

        /*
         * Defensive normalization:
         * recommendations should always be an array.
         */
        const normalizedResult: RecommendationsResponse =
          {
            ...result,

            recommendations:
              Array.isArray(result.recommendations)
                ? result.recommendations
                : [],
          };

        setData(normalizedResult);
      } catch (requestError) {
        const message =
          requestError instanceof Error
            ? requestError.message
            : "Unable to load AI analysis.";

        setError(message);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [period, source],
  );

  useEffect(() => {
    void fetchRecommendations();
  }, [fetchRecommendations]);

  useEffect(() => {
    void fetchSensors();

    const interval = window.setInterval(() => {
      void fetchSensors();
    }, 5000);

    return () => {
      window.clearInterval(interval);
    };
  }, [fetchSensors]);

  /* ---------------------------------------------------------------------- */
  /* STATISTICS                                                              */
  /* ---------------------------------------------------------------------- */

  const statistics = useMemo(() => {
    const recommendations =
      data?.recommendations ?? [];

    const critical = recommendations.filter(
      (item) =>
        item.severity?.toUpperCase() ===
        "CRITICAL",
    ).length;

    const high = recommendations.filter(
      (item) =>
        item.severity?.toUpperCase() === "HIGH",
    ).length;

    const averageScore =
      recommendations.length > 0
        ? recommendations.reduce(
            (total, item) =>
              total +
              safeNumber(item.anomaly_score),
            0,
          ) / recommendations.length
        : 0;

    const averageConfidence =
      recommendations.length > 0
        ? recommendations.reduce(
            (total, item) =>
              total +
              safeNumber(item.confidence),
            0,
          ) / recommendations.length
        : 0;

    return {
      total: data?.analysis?.anomaly_count ?? 0,
      critical,
      high,
      averageScore,
      averageConfidence,
    };
  }, [data]);

  /* ---------------------------------------------------------------------- */
  /* UI                                                                      */
  /* ---------------------------------------------------------------------- */

  return (
    <section className="space-y-4">
      {/* HEADER */}
      <div className="terminal-panel">
        <div className="flex flex-col gap-4 border-b border-dashed border-[#1f521f] p-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <Bot
                size={18}
                className="text-[#33ff00]"
              />

              <h1 className="text-sm font-bold tracking-[0.18em] text-[#33ff00] terminal-glow">
                AI_ANALYSIS_ENGINE
              </h1>

              <span className="terminal-cursor" />
            </div>

            <p className="text-[10px] text-[#4c804c]">
              ANOMALY DETECTION // EVIDENCE ANALYSIS //
              ACTION RECOMMENDATIONS
            </p>
          </div>

          <button
            type="button"
            onClick={() =>
              void fetchRecommendations(true)
            }
            disabled={refreshing}
            className="terminal-button flex items-center justify-center gap-2 px-4 py-2 text-[10px] tracking-widest disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw
              size={13}
              className={
                refreshing ? "animate-spin" : ""
              }
            />

            {refreshing
              ? "[ ANALYZING ]"
              : "[ REFRESH_AI ]"}
          </button>
        </div>

        {/* FILTERS */}
        <div className="grid gap-3 p-4 md:grid-cols-2">
          <div>
            <label
              htmlFor="ai-period"
              className="mb-2 block text-[9px] tracking-[0.18em] text-[#1f8a1f]"
            >
              ANALYSIS_PERIOD
            </label>

            <select
              id="ai-period"
              value={period}
              onChange={(event) =>
                setPeriod(
                  Number(
                    event.target.value,
                  ) as PeriodFilter,
                )
              }
              className="w-full border border-[#1f521f] bg-[#080808] px-3 py-2 text-xs text-[#33ff00] outline-none focus:border-[#33ff00]"
            >
              <option value={24}>
                LAST_24_HOURS
              </option>

              <option value={168}>
                LAST_7_DAYS
              </option>
            </select>
          </div>

          <div>
            <label
              htmlFor="ai-source"
              className="mb-2 block text-[9px] tracking-[0.18em] text-[#1f8a1f]"
            >
              DATA_SOURCE
            </label>

            <select
              id="ai-source"
              value={source}
              onChange={(event) =>
                setSource(
                  event.target
                    .value as SourceFilter,
                )
              }
              className="w-full border border-[#1f521f] bg-[#080808] px-3 py-2 text-xs text-[#33ff00] outline-none focus:border-[#33ff00]"
            >
              <option value="all">
                ALL_SOURCES
              </option>

              <option value="dataset">
                HISTORICAL_DATASET
              </option>

              <option value="simulator">
                LIVE_SIMULATOR
              </option>

              <option value="api">
                API_DATA
              </option>

              <option value="sensor">
                PHYSICAL_SENSOR
              </option>
            </select>
          </div>
        </div>
      </div>

      {/* ENGINE STATUS */}
      <div className="flex flex-wrap items-center gap-3 border border-[#1f521f] bg-[#080808] px-3 py-2 text-[9px]">
        <span className="flex items-center gap-2 text-[#33ff00]">
          <span className="h-1.5 w-1.5 animate-pulse bg-[#33ff00]" />

          AI_ENGINE_ONLINE
        </span>

        <span className="text-[#1f521f]">
          |
        </span>

        <span className="text-[#5f9f5f]">
          PERIOD:{" "}
          {period === 24 ? "24H" : "7D"}
        </span>

        <span className="text-[#1f521f]">
          |
        </span>

        <span className="text-[#5f9f5f]">
          SOURCE: {source.toUpperCase()}
        </span>

        {data ? (
          <>
            <span className="text-[#1f521f]">
              |
            </span>

            <span className="text-[#5f9f5f]">
              BASELINE:{" "}
              {data.analysis.baseline_hours}H
            </span>
          </>
        ) : null}
      </div>

      {/* ERROR */}
      {error ? (
        <div className="border border-[#ff3333]/60 bg-[#160707] p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle
              size={16}
              className="mt-0.5 shrink-0 text-[#ff3333]"
            />

            <div>
              <div className="text-[10px] tracking-widest text-[#ff3333]">
                AI_ANALYSIS_ERROR
              </div>

              <p className="mt-1 text-[11px] leading-5 text-[#c77c7c]">
                {error}
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {/* LOADING */}
      {loading ? (
        <div className="terminal-panel p-8 text-center">
          <div className="mb-3 text-[11px] tracking-[0.2em] text-[#33ff00]">
            &gt; RUNNING_AI_ANALYSIS
            <span className="terminal-cursor" />
          </div>

          <p className="text-[10px] text-[#4c804c]">
            ANALYZING NOISE EVENTS, BASELINES AND
            ANOMALY PATTERNS...
          </p>
        </div>
      ) : null}

      {/* DATA */}
      {!loading && !error ? (
        <>
          {/* SUMMARY */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <StatCard
              label="ANOMALIES"
              value={statistics.total}
              icon={
                <AlertTriangle size={15} />
              }
            />

            <StatCard
              label="CRITICAL"
              value={statistics.critical}
              icon={<Zap size={15} />}
            />

            <StatCard
              label="HIGH"
              value={statistics.high}
              icon={
                <TrendingUp size={15} />
              }
            />

            <StatCard
              label="AVG_SCORE"
              value={formatNumber(
                statistics.averageScore,
              )}
              unit="/100"
              icon={
                <Target size={15} />
              }
            />

            <StatCard
              label="AVG_CONFIDENCE"
              value={formatNumber(
                statistics.averageConfidence,
              )}
              unit="%"
              icon={
                <CheckCircle2 size={15} />
              }
            />
          </div>

          {/* LIVE SENSOR NETWORK */}
          <div className="space-y-3">
            <div className="flex flex-col gap-1 border-b border-dashed border-[#1f521f] pb-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-[10px] tracking-[0.2em] text-[#33ff00]">
                &gt; LIVE_SENSOR_NETWORK
              </div>
              <div className="text-[9px] text-[#4c804c]">
                {sensors.length} ACTIVE SENSOR{sensors.length === 1 ? "" : "S"}
                {" // AUTO_REFRESH 5S"}
              </div>
            </div>

            {sensors.length > 0 ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {sensors.map((sensor) => {
                  const level = safeNumber(sensor.current_noise_level);
                  const severity =
                    level >= 95
                      ? "CRITICAL"
                      : level >= 85
                        ? "HIGH"
                        : level >= 70
                          ? "MODERATE"
                          : "NORMAL";

                  const severityColor =
                    severity === "CRITICAL"
                      ? "text-red-400 border-red-500/60"
                      : severity === "HIGH"
                        ? "text-orange-400 border-orange-500/60"
                        : severity === "MODERATE"
                          ? "text-yellow-400 border-yellow-500/60"
                          : "text-green-400 border-green-500/60";

                  return (
                    <article
                      key={sensor.id}
                      className="terminal-panel min-w-0 p-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-[11px] font-bold text-[#33ff00] terminal-glow">
                            {sensor.sensor_code}
                          </div>
                          <div className="mt-1 truncate text-[9px] text-[#5f9f5f]">
                            {sensor.name}
                          </div>
                          <div className="mt-1 truncate text-[9px] text-[#4c804c]">
                            {sensor.location}
                          </div>
                        </div>

                        <span
                          className={`shrink-0 border px-2 py-1 text-[8px] tracking-widest ${severityColor}`}
                        >
                          {severity}
                        </span>
                      </div>

                      <div className="mt-3 flex items-end justify-between border-t border-[#1f521f] pt-2">
                        <div>
                          <div className="text-[8px] tracking-widest text-[#1f8a1f]">
                            CURRENT
                          </div>
                          <div className="mt-1 text-xl font-bold text-[#33ff00] terminal-glow">
                            {level.toFixed(1)}
                            <span className="ml-1 text-[9px] text-[#5f9f5f]">
                              dB
                            </span>
                          </div>
                        </div>

                        <div className="text-right">
                          <div className="text-[8px] tracking-widest text-[#1f8a1f]">
                            STATUS
                          </div>
                          <div className="mt-1 text-[9px] text-[#a8d8a8]">
                            {sensor.status.toUpperCase()}
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="terminal-panel p-6 text-center text-[10px] text-[#4c804c]">
                &gt; LOADING_ACTIVE_SENSOR_NETWORK...
              </div>
            )}
          </div>

          {/* RECOMMENDATIONS */}
          {data?.recommendations?.length ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between border-b border-dashed border-[#1f521f] pb-2">
                <div className="text-[10px] tracking-[0.2em] text-[#33ff00]">
                  &gt; AI_RECOMMENDATIONS
                </div>

                <div className="text-[9px] text-[#4c804c]">
                  {data.recommendations.length}{" "}
                  RESULT
                  {data.recommendations.length === 1
                    ? ""
                    : "S"}
                </div>
              </div>

              {data.recommendations.map(
                (recommendation) => (
                  <RecommendationCard
                    key={
                      recommendation.recommendation_id
                    }
                    recommendation={
                      recommendation
                    }
                  />
                ),
              )}
            </div>
          ) : (
            <div className="terminal-panel p-8 text-center">
              <CheckCircle2
                size={22}
                className="mx-auto mb-3 text-[#33ff00]"
              />

              <div className="text-[11px] tracking-[0.18em] text-[#33ff00]">
                NO_ANOMALIES_DETECTED
              </div>

              <p className="mt-2 text-[10px] text-[#4c804c]">
                AI ANALYSIS FOUND NO ACTIONABLE
                EVENTS FOR THE SELECTED PERIOD AND
                SOURCE.
              </p>
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}