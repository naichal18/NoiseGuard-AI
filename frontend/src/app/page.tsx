"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  Activity,
  AlertTriangle,
  Bell,
  Bot,
  Gauge,
  Radio,
  ShieldAlert,
} from "lucide-react";

import Header from "@/components/layout/Header";
import Sidebar, {
  type SidebarItem,
} from "@/components/layout/Sidebar";

import LiveMonitorPanel from "@/components/dashboard/LiveMonitorPanel";
import AnalyticsPanel from "@/components/dashboard/AnalyticsPanel";
import ViolationsPanel from "@/components/dashboard/ViolationsPanel";
import AIAnalysisPanel from "@/components/dashboard/AIAnalysisPanel";
import AlertsPanel from "@/components/dashboard/AlertsPanel";
import FloatingAIAssistant from "@/components/dashboard/FloatingAIAssistant";
const MapPanel = dynamic(
  () => import("@/components/dashboard/MapPanel"),
  { ssr: false },
);
import MetricCard from "@/components/dashboard/MetricCard";
import ReportsPanel from "@/components/dashboard/ReportsPanel";
import SettingsPanel from "@/components/dashboard/SettingsPanel";
import SystemConfigPanel from "@/components/dashboard/SystemConfigPanel";
import TerminalPanel from "@/components/ui/TerminalPanel";

const API_BASE_URL = "http://127.0.0.1:8000";
const WS_URL = "ws://127.0.0.1:8000/ws/noise";

interface DashboardMetrics {
  avg_noise_level: number;
  max_noise_level: number;
  active_sensors: number;
  active_alerts: number;
  updated_at: string;
}

interface NoiseReading {
  id: number;
  sensor_id: number;
  noise_level: number;
  recorded_at: string;
  source: string;
  event_type: string;
}

interface WebSocketMessage {
  type: string;
  data: NoiseReading & {
    severity?: string;
    sensor_code?: string;
    sensor_name?: string;
    message?: string;
  };
}

interface RuntimeSettings {
  websocket_enabled: boolean;
  ai_analysis_enabled: boolean;
  recommendation_engine_enabled: boolean;
  browser_notifications_enabled: boolean;
  critical_notifications_enabled: boolean;
  high_notifications_enabled: boolean;
}

interface NoiseStatus {
  label: string;
  type:
    | "ok"
    | "moderate"
    | "high"
    | "critical"
    | "warning";
}

function getNoiseStatus(value: number): NoiseStatus {
  if (value < 70) {
    return {
      label: "NORMAL",
      type: "ok",
    };
  }

  if (value < 85) {
    return {
      label: "MODERATE",
      type: "moderate",
    };
  }

  if (value < 95) {
    return {
      label: "HIGH",
      type: "high",
    };
  }

  return {
    label: "CRITICAL",
    type: "critical",
  };
}

function formatTime(value: string) {
  if (!value) {
    return "--:--:--";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "--:--:--";
  }

  return date.toLocaleTimeString("en-GB", {
    hour12: false,
  });
}

export default function Home() {
  const [activeModule, setActiveModule] =
    useState<SidebarItem>("DASHBOARD");

  const [metrics, setMetrics] =
    useState<DashboardMetrics>({
      avg_noise_level: 0,
      max_noise_level: 0,
      active_sensors: 0,
      active_alerts: 0,
      updated_at: "",
    });

  const [sensorReadings, setSensorReadings] =
    useState<Record<number, number>>({});

  const [wsConnected, setWsConnected] =
    useState(false);

  const [runtimeSettings, setRuntimeSettings] =
    useState<RuntimeSettings>({
      websocket_enabled: true,
      ai_analysis_enabled: true,
      recommendation_engine_enabled: true,
      browser_notifications_enabled: false,
      critical_notifications_enabled: true,
      high_notifications_enabled: true,
    });

  const notifiedAlertStates = useRef<Set<string>>(new Set());
  const runtimeSettingsRef = useRef<RuntimeSettings>(runtimeSettings);

  useEffect(() => {
    runtimeSettingsRef.current = runtimeSettings;
  }, [runtimeSettings]);

  useEffect(() => {
    let cancelled = false;

    const loadRuntimeSettings = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/settings`, { cache: "no-store" });
        if (!response.ok) return;
        const payload = await response.json();
        const settings = payload?.settings;
        if (!settings || cancelled) return;

        setRuntimeSettings((current) => ({
          ...current,
          websocket_enabled: Boolean(settings.websocket_enabled),
          ai_analysis_enabled: Boolean(settings.ai_analysis_enabled),
          recommendation_engine_enabled: Boolean(settings.recommendation_engine_enabled),
          browser_notifications_enabled: Boolean(settings.browser_notifications_enabled),
          critical_notifications_enabled: Boolean(settings.critical_notifications_enabled),
          high_notifications_enabled: Boolean(settings.high_notifications_enabled),
        }));
      } catch {
        // Keep the last known runtime state.
      }
    };

    loadRuntimeSettings();
    const timer = window.setInterval(loadRuntimeSettings, 2000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (
      !runtimeSettings.browser_notifications_enabled ||
      typeof window === "undefined" ||
      !("Notification" in window)
    ) {
      return;
    }

    if (Notification.permission === "default") {
      void Notification.requestPermission();
    }
  }, [runtimeSettings.browser_notifications_enabled]);

  useEffect(() => {
    let websocket: WebSocket | null = null;
    let reconnectTimer: number | null = null;

    let isUnmounted = false;
    let intentionallyClosing = false;

    const fetchInitialMetrics = async () => {
      try {
        const response = await fetch(
          `${API_BASE_URL}/api/dashboard/metrics`,
          {
            cache: "no-store",
          },
        );

        if (!response.ok) {
          throw new Error(
            `Metrics request failed: ${response.status}`,
          );
        }

        const data: DashboardMetrics =
          await response.json();

        if (!isUnmounted) {
          setMetrics(data);
        }
      } catch {
        /*
         * Initial metrics failure is intentionally
         * silent. WebSocket will provide live data
         * when available.
         */
      }
    };

    const connectWebSocket = () => {
      if (isUnmounted || !runtimeSettings.websocket_enabled) {
        setWsConnected(false);
        return;
      }

      intentionallyClosing = false;

      const socket = new WebSocket(WS_URL);

      websocket = socket;

      socket.onopen = () => {
        if (isUnmounted) {
          return;
        }

        setWsConnected(true);
        window.dispatchEvent(
          new CustomEvent("noiseguard-stream-status", {
            detail: { connected: true },
          }),
        );
      };

      socket.onmessage = (event) => {
        if (isUnmounted) {
          return;
        }

        try {
          const message: WebSocketMessage =
            JSON.parse(event.data);

          if (
            (message.type === "noise_alert" ||
              message.type === "noise_alert_updated") &&
            runtimeSettingsRef.current.browser_notifications_enabled &&
            typeof window !== "undefined" &&
            "Notification" in window &&
            Notification.permission === "granted"
          ) {
            const alertId = Number(message.data.id);
            const severity = String(message.data.severity || "").toLowerCase();
            const allowed =
              (severity === "critical" && runtimeSettingsRef.current.critical_notifications_enabled) ||
              (severity === "high" && runtimeSettingsRef.current.high_notifications_enabled);

            // Track alert + severity, not only alert id. An existing HIGH alert
            // can later become CRITICAL and must produce a new notification.
            const notificationKey = `${alertId}:${severity}`;

            console.log("[NOTIFICATION] ALERT_RECEIVED", {
              id: alertId,
              severity,
              allowed,
              browserEnabled: runtimeSettingsRef.current.browser_notifications_enabled,
              criticalEnabled: runtimeSettingsRef.current.critical_notifications_enabled,
              highEnabled: runtimeSettingsRef.current.high_notifications_enabled,
              permission: Notification.permission,
            });

            if (allowed && Number.isFinite(alertId) && (severity === "high" || severity === "critical")) {
              console.log("[NOTIFICATION] SEVERITY_ALLOWED", notificationKey);

              if (notifiedAlertStates.current.has(notificationKey)) {
                console.log("[NOTIFICATION] DUPLICATE_SKIPPED", notificationKey);
              } else {
                notifiedAlertStates.current.add(notificationKey);

                try {
                  const notification = new Notification(
                    `NoiseGuard ${severity.toUpperCase()} ALERT`,
                    {
                      body: message.data.message ||
                        `${message.data.sensor_code || "Sensor"} reported ${message.data.noise_level?.toFixed?.(1) ?? message.data.noise_level} dB`,
                      tag: `noiseguard-alert-${alertId}-${severity}-${Date.now()}`,
                      requireInteraction: true,
                      silent: false,
                    },
                  );

                  notification.onclick = () => {
                    window.focus();
                    notification.close();
                  };

                  console.log("[NOTIFICATION] TRIGGERED", notificationKey);
                } catch (error) {
                  console.error("[NOTIFICATION] FAILED", error);
                  notifiedAlertStates.current.delete(notificationKey);
                }
              }
            } else {
              console.log("[NOTIFICATION] BLOCKED", {
                id: alertId,
                severity,
                allowed,
                permission: Notification.permission,
              });
            }
          }

          if (message.type !== "noise_reading") {
            return;
          }

          const reading = message.data;

          if (
            typeof reading.sensor_id !== "number" ||
            typeof reading.noise_level !== "number"
          ) {
            return;
          }

          window.dispatchEvent(
            new CustomEvent("noiseguard-live-reading", {
              detail: reading,
            }),
          );

          setSensorReadings((previous) => {
            const next = {
              ...previous,
              [reading.sensor_id]:
                reading.noise_level,
            };

            const values =
              Object.values(next);

            const average =
              values.length > 0
                ? values.reduce(
                    (sum, value) =>
                      sum + value,
                    0,
                  ) / values.length
                : 0;

            const maximum =
              values.length > 0
                ? Math.max(...values)
                : 0;

            const activeAlerts =
              values.filter(
                (value) => value >= 85,
              ).length;

            setMetrics((current) => ({
              ...current,
              avg_noise_level:
                Number(
                  average.toFixed(1),
                ),
              max_noise_level:
                Number(
                  maximum.toFixed(1),
                ),
              active_alerts:
                activeAlerts,
              updated_at:
                reading.recorded_at,
            }));

            return next;
          });
        } catch {
          /*
           * Ignore malformed WebSocket messages.
           */
        }
      };

      socket.onerror = () => {
        if (
          !isUnmounted &&
          !intentionallyClosing
        ) {
          setWsConnected(false);
          window.dispatchEvent(
            new CustomEvent("noiseguard-stream-status", {
              detail: { connected: false },
            }),
          );
        }
      };

      socket.onclose = () => {
        if (isUnmounted) {
          return;
        }

        setWsConnected(false);
        window.dispatchEvent(
          new CustomEvent("noiseguard-stream-status", {
            detail: { connected: false },
          }),
        );

        if (reconnectTimer !== null) {
          window.clearTimeout(
            reconnectTimer,
          );
        }

        reconnectTimer =
          window.setTimeout(() => {
            if (!isUnmounted) {
              connectWebSocket();
            }
          }, 3000);
      };
    };

    fetchInitialMetrics();
    connectWebSocket();

    return () => {
      isUnmounted = true;
      intentionallyClosing = true;

      if (reconnectTimer !== null) {
        window.clearTimeout(
          reconnectTimer,
        );
      }

      if (
        websocket &&
        websocket.readyState !==
          WebSocket.CLOSED
      ) {
        websocket.close();
      }
    };
  }, [runtimeSettings.websocket_enabled]);

  const averageNoiseStatus =
    getNoiseStatus(
      metrics.avg_noise_level,
    );

  const maximumNoiseStatus =
    getNoiseStatus(
      metrics.max_noise_level,
    );

  const metricsCards = [
    {
      label: "AVG_NOISE_LEVEL",
      value:
        metrics.avg_noise_level.toFixed(1),
      unit: "dB",
      status:
        averageNoiseStatus.label,
      statusType:
        averageNoiseStatus.type,
      icon: Activity,
      progress: Math.min(
        metrics.avg_noise_level,
        100,
      ),
    },

    {
      label: "MAX_NOISE_LEVEL",
      value:
        metrics.max_noise_level.toFixed(1),
      unit: "dB",
      status:
        maximumNoiseStatus.label,
      statusType:
        maximumNoiseStatus.type,
      icon: AlertTriangle,
      progress: Math.min(
        metrics.max_noise_level,
        100,
      ),
    },

    {
      label: "ACTIVE_SENSORS",
      value: String(
        metrics.active_sensors,
      ),
      unit: "UNITS",
      status: "ONLINE",
      statusType: "ok" as const,
      icon: Radio,
      progress: Math.min(
        (metrics.active_sensors / 6) *
          100,
        100,
      ),
    },

    {
      label: "ACTIVE_ALERTS",
      value: String(
        metrics.active_alerts,
      ),
      unit: "EVENTS",
      status:
        metrics.active_alerts > 0
          ? "ACTIVE"
          : "MONITORING",
      statusType:
        metrics.active_alerts > 0
          ? ("warning" as const)
          : ("ok" as const),
      icon: Bell,
      progress: Math.min(
        (metrics.active_alerts / 10) *
          100,
        100,
      ),
    },
  ];

  const renderDashboard = () => {
    return (
      <>
        <div className="mb-4 border-b border-dashed border-[#1f521f] pb-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-[10px] text-[#1f9e1f]">
                root@noiseguard:~/dashboard$
              </div>

              <h1 className="terminal-glow mt-1 text-base font-bold tracking-wide text-[#33ff00] sm:text-lg">
                NOISEGUARD_AI :: COMMAND_CENTER
              </h1>
            </div>

            <div className="text-[9px] text-[#1f9e1f] sm:text-right">
              <div>
                MODE: REAL_TIME_MONITORING
              </div>

              <div className="mt-1 text-[#33ff00]">
                [ SYSTEM_READY ]
              </div>
            </div>
          </div>
        </div>

        <section
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
          aria-label="Noise monitoring metrics"
        >
          {metricsCards.map((metric) => (
            <MetricCard
              key={metric.label}
              label={metric.label}
              value={metric.value}
              unit={metric.unit}
              status={metric.status}
              statusType={metric.statusType}
              icon={metric.icon}
              progress={metric.progress}
            />
          ))}
        </section>

        <div className="mt-4 terminal-border px-3 py-2">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[9px]">
            <span className="text-[#1f9e1f]">
              DATA_SOURCE:
            </span>

            <span className="text-[#33ff00]">
              [ LIVE_WEBSOCKET ]
            </span>

            <span className="text-[#1f9e1f]">
              STREAM:
            </span>

            <span
              className={
                wsConnected
                  ? "text-[#33ff00]"
                  : "text-[#ff3333]"
              }
            >
              {!runtimeSettings.websocket_enabled
                ? "[ DISABLED ]"
                : wsConnected
                  ? "[ CONNECTED ]"
                  : "[ DISCONNECTED ]"}
            </span>

            <span className="text-[#1f9e1f]">
              LAST_UPDATE:
            </span>

            <span className="text-[#33ff00]">
              {formatTime(
                metrics.updated_at,
              )}
            </span>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,0.8fr)]">
          <MapPanel />
          <AlertsPanel />
        </div>

        <div className="mt-4">
          <TerminalPanel
            title="AI_SYSTEM_TERMINAL"
            headerRight={
              <span className="text-[9px] text-[#33ff00]">
                {!runtimeSettings.websocket_enabled
                  ? "[DISABLED]"
                  : wsConnected
                    ? "[LIVE]"
                    : "[WAITING]"}
              </span>
            }
          >
            <div className="space-y-2 text-[10px] leading-relaxed">
              <div>
                <span className="text-[#1f9e1f]">
                  root@noiseguard:~$
                </span>{" "}
                <span className="text-[#33ff00]">
                  system --status
                </span>
              </div>

              <div className="pl-2 text-[#1f9e1f]">
                [OK] SENSOR_NETWORK........ ONLINE
              </div>

              <div className="pl-2 text-[#1f9e1f]">
                [OK] DATA_STREAM............
                {" "}
                {wsConnected
                  ? "LIVE"
                  : "WAITING"}
              </div>

              <div className="pl-2 text-[#1f9e1f]">
                [OK] AI_ANALYSIS............ READY
              </div>

              <div className="pl-2 text-[#1f9e1f]">
                [OK] ALERT_ENGINE........... MONITORING
              </div>

              <div className="mt-3 border-t border-dashed border-[#1f521f] pt-3">
                <span className="text-[#1f9e1f]">
                  root@noiseguard:~$
                </span>{" "}
                <span className="text-[#33ff00]">
                  websocket_stream --status
                </span>
              </div>

              <div className="pl-2 text-[#1f9e1f]">
                [STREAM] LIVE_READINGS:{" "}
                {Object.keys(
                  sensorReadings,
                ).length}
                /{metrics.active_sensors}
              </div>

              <div>
                <span className="text-[#1f9e1f]">
                  root@noiseguard:~$
                </span>{" "}
                <span className="text-[#33ff00]">
                  waiting_for_command
                </span>

                <span
                  className="terminal-cursor"
                  aria-hidden="true"
                />
              </div>
            </div>
          </TerminalPanel>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="terminal-border p-3">
            <div className="flex items-center gap-2 text-[10px]">
              <Gauge
                size={13}
                strokeWidth={1.8}
                className="text-[#33ff00]"
              />

              <span className="text-[#1f9e1f]">
                ANALYTICS_ENGINE
              </span>
            </div>

            <div className="mt-2 text-xs text-[#33ff00]">
              [ ACTIVE ]
            </div>
          </div>

          <div className="terminal-border p-3">
            <div className="flex items-center gap-2 text-[10px]">
              <Bot
                size={13}
                strokeWidth={1.8}
                className="text-[#33ff00]"
              />

              <span className="text-[#1f9e1f]">
                AI_ENGINE
              </span>
            </div>

            <div className="mt-2 text-xs text-[#33ff00]">
              [ READY ]
            </div>
          </div>

          <div className="terminal-border p-3">
            <div className="flex items-center gap-2 text-[10px]">
              <ShieldAlert
                size={13}
                strokeWidth={1.8}
                className="text-[#ffb000]"
              />

              <span className="text-[#1f9e1f]">
                ALERT_ENGINE
              </span>
            </div>

            <div className="mt-2 text-xs text-[#ffb000]">
              [ MONITORING ]
            </div>
          </div>
        </div>
      </>
    );
  };

  const renderPlaceholder = (
    module: SidebarItem,
  ) => {
    const moduleCommand =
      module
        .replaceAll(" ", "_")
        .toLowerCase();

    return (
      <TerminalPanel
        title={`${module.replaceAll(
          " ",
          "_",
        )}_MODULE`}
        headerRight={
          <span className="text-[9px] text-[#ffb000]">
            [ IN DEVELOPMENT ]
          </span>
        }
      >
        <div className="space-y-3 text-[10px] leading-relaxed">
          <div>
            <span className="text-[#1f9e1f]">
              root@noiseguard:~$
            </span>{" "}
            <span className="text-[#33ff00]">
              {moduleCommand}
            </span>
          </div>

          <div className="border-y border-dashed border-[#1f521f] py-4">
            <div className="text-[#ffb000]">
              [ INFO ] MODULE_INITIALIZED
            </div>

            <div className="mt-2 text-[#1f9e1f]">
              This subsystem is connected to
              the NoiseGuard AI command center.
            </div>

            <div className="mt-1 text-[#1f9e1f]">
              Full operational controls will
              be enabled in the next implementation
              stage.
            </div>
          </div>

          <div>
            <span className="text-[#1f9e1f]">
              root@noiseguard:~$
            </span>{" "}
            <span className="text-[#33ff00]">
              status --module
            </span>
          </div>

          <div className="pl-2 space-y-1 text-[#1f9e1f]">
            <div>
              [OK] BACKEND_API........... ONLINE
            </div>

            <div>
              [OK] DATABASE.............. ONLINE
            </div>

            <div>
              [OK] SENSOR_NETWORK........ ONLINE
            </div>

            <div>
              [OK] AI_ENGINE............. READY
            </div>
          </div>

          <div>
            <span className="text-[#1f9e1f]">
              root@noiseguard:~$
            </span>

            <span className="terminal-cursor" />
          </div>
        </div>
      </TerminalPanel>
    );
  };

  const renderModule = () => {
    if (activeModule === "DASHBOARD") {
      return renderDashboard();
    }

    if (activeModule === "LIVE MONITOR") {
      return <LiveMonitorPanel />;
    }


    if (activeModule === "ANALYTICS") {
      return <AnalyticsPanel />;
    }

    if (activeModule === "AI ANALYSIS") {
      return <AIAnalysisPanel />;
    }

    if (activeModule === "VIOLATIONS") {
      return <ViolationsPanel />;
    }

    
    if (activeModule === "REPORTS") {
      return <ReportsPanel />;
    }

    if (activeModule === "SETTINGS") {
      return <SettingsPanel />;
    }

    if (activeModule === "SYSTEM CONFIG") {
      return <SystemConfigPanel />;
    }

    return renderPlaceholder(
      activeModule,
    );
  };

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-[#33ff00]">
      <div className="min-h-screen">
        <Header />

        <div className="flex min-h-[calc(100vh-65px)] flex-col lg:flex-row">
          <Sidebar
            activeItem={activeModule}
            onNavigate={setActiveModule}
          />

          <div className="min-w-0 flex-1">
            <div className="p-3 sm:p-4 lg:p-5">
              {activeModule !==
                "DASHBOARD" &&
                activeModule !==
                "AI ANALYSIS" &&
                activeModule !==
                "REPORTS" &&
                activeModule !==
                "SETTINGS" &&
                activeModule !==
                "SYSTEM CONFIG" && (
                  <div className="mb-4 border-b border-dashed border-[#1f521f] pb-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="text-[10px] text-[#1f9e1f]">
                          root@noiseguard:~$
                        </div>

                        <h1 className="terminal-glow mt-1 text-base font-bold tracking-wide text-[#33ff00] sm:text-lg">
                          NOISEGUARD_AI ::
                          {" "}
                          {activeModule}
                        </h1>
                      </div>

                      <div className="text-[9px] text-[#1f9e1f] sm:text-right">
                        <div>
                          MODE: MODULE_INTERFACE
                        </div>

                        <div className="mt-1 text-[#33ff00]">
                          [ SYSTEM_READY ]
                        </div>
                      </div>
                    </div>
                  </div>
                )}

              {activeModule ===
                "AI ANALYSIS" && (
                <div className="mb-4 border-b border-dashed border-[#1f521f] pb-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="text-[10px] text-[#1f9e1f]">
                        root@noiseguard:~/ai$
                      </div>

                      <h1 className="terminal-glow mt-1 text-base font-bold tracking-wide text-[#33ff00] sm:text-lg">
                        NOISEGUARD_AI ::
                        {" "}
                        AI_ANALYSIS
                      </h1>
                    </div>

                    <div className="text-[9px] text-[#1f9e1f] sm:text-right">
                      <div>
                        MODE: AI_INTELLIGENCE
                      </div>

                      <div className="mt-1 text-[#33ff00]">
                        [ ENGINE_READY ]
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {renderModule()}
            </div>
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* DASHBOARD FLOATING AI ASSISTANT                                    */}
      {/* ------------------------------------------------------------------ */}
      {activeModule === "DASHBOARD" && (
        <FloatingAIAssistant />
      )}

      <div
        className="crt-overlay"
        aria-hidden="true"
      />
    </main>
  );
}
