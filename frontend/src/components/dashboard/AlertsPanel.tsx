"use client";

import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Clock3,
  Volume2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000";

const WS_URL =
  process.env.NEXT_PUBLIC_WS_URL ?? "ws://127.0.0.1:8000/ws/noise";

interface BackendAlert {
  id: number;
  sensor_id: number;
  sensor_code: string | null;
  sensor_name: string | null;
  location: string | null;
  noise_level: number;
  severity: string;
  event_type: string;
  message: string;
  acknowledged: boolean;
  resolved: boolean;
  created_at: string;
  resolved_at: string | null;
}

interface AlertItem {
  id: number;
  type: "HIGH" | "WARN" | "CRITICAL";
  event: string;
  location: string;
  level: number;
  status: "ACTIVE" | "ACKNOWLEDGED";
  time: string;
  resolved: boolean;
}

const typeStyles = {
  HIGH: {
    text: "text-[#ff3333]",
    border: "border-[#ff3333]",
    icon: AlertTriangle,
  },
  WARN: {
    text: "text-[#ffb000]",
    border: "border-[#ffb000]",
    icon: Bell,
  },
  CRITICAL: {
    text: "text-[#ff3333]",
    border: "border-[#ff3333]",
    icon: Volume2,
  },
};

function mapSeverityToType(
  severity: string,
): AlertItem["type"] {
  const normalized = severity.toLowerCase();

  if (normalized === "critical") {
    return "CRITICAL";
  }

  if (
    normalized === "warn" ||
    normalized === "warning"
  ) {
    return "WARN";
  }

  return "HIGH";
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    return "--:--:--";
  }

  return date.toLocaleTimeString("en-IN", {
    hour12: false,
  });
}

function mapBackendAlert(
  alert: BackendAlert,
): AlertItem {
  return {
    id: alert.id,
    type: mapSeverityToType(alert.severity),
    event: alert.event_type,
    location:
      alert.location ||
      alert.sensor_name ||
      alert.sensor_code ||
      "UNKNOWN_LOCATION",
    level: alert.noise_level,
    status: alert.acknowledged
      ? "ACKNOWLEDGED"
      : "ACTIVE",
    time: formatTime(alert.created_at),
    resolved: alert.resolved,
  };
}

export default function AlertsPanel() {
  const [alerts, setAlerts] =
    useState<AlertItem[]>([]);

  const [showAcknowledged, setShowAcknowledged] =
    useState(true);

  const [loading, setLoading] =
    useState(true);

  const [wsConnected, setWsConnected] =
    useState(false);

  const socketRef =
    useRef<WebSocket | null>(null);

  const reconnectTimerRef =
    useRef<number | null>(null);

  const isUnmountedRef =
    useRef(false);

  /*
   * INITIAL ALERT LOAD
   */
  useEffect(() => {
    let cancelled = false;

    const loadAlerts = async () => {
      try {
        const response = await fetch(
          `${API_BASE_URL}/api/alerts`,
          {
            cache: "no-store",
          },
        );

        if (!response.ok) {
          throw new Error(
            `HTTP ${response.status}`,
          );
        }

        const data: BackendAlert[] =
          await response.json();

        if (!cancelled) {
          setAlerts(
            data.map(mapBackendAlert),
          );
        }
      } catch {
        if (!cancelled) {
          setAlerts([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadAlerts();

    return () => {
      cancelled = true;
    };
  }, []);

  /*
   * LIVE ALERT WEBSOCKET
   */
  useEffect(() => {
    isUnmountedRef.current = false;

    const connectWebSocket = () => {
      if (isUnmountedRef.current) {
        return;
      }

      if (
        socketRef.current?.readyState ===
        WebSocket.OPEN
      ) {
        return;
      }

      const socket = new WebSocket(
        WS_URL,
      );

      socketRef.current = socket;

      socket.onopen = () => {
        if (!isUnmountedRef.current) {
          setWsConnected(true);
        }
      };

      socket.onmessage = (event) => {
        if (isUnmountedRef.current) {
          return;
        }

        try {
          const message = JSON.parse(
            event.data,
          );

          /*
           * NEW ALERT
           */
          if (
            message?.type ===
            "noise_alert"
          ) {
            const backendAlert =
              message.data as BackendAlert;

            if (
              !backendAlert ||
              typeof backendAlert.id !==
                "number"
            ) {
              return;
            }

            const newAlert =
              mapBackendAlert(
                backendAlert,
              );

            setAlerts((currentAlerts) => {
              const existingIndex =
                currentAlerts.findIndex(
                  (alert) =>
                    alert.id ===
                    newAlert.id,
                );

              if (existingIndex === -1) {
                return [
                  newAlert,
                  ...currentAlerts,
                ];
              }

              const updatedAlerts = [
                ...currentAlerts,
              ];

              updatedAlerts[
                existingIndex
              ] = newAlert;

              return updatedAlerts;
            });

            return;
          }

          /*
           * EXISTING ALERT UPDATED
           *
           * The alert ID stays the same.
           * Only level/severity/event/status
           * changes.
           */
          if (
            message?.type ===
            "noise_alert_updated"
          ) {
            const backendAlert =
              message.data as BackendAlert;

            if (
              !backendAlert ||
              typeof backendAlert.id !==
                "number"
            ) {
              return;
            }

            const updatedAlert =
              mapBackendAlert(
                backendAlert,
              );

            setAlerts((currentAlerts) => {
              const existingIndex =
                currentAlerts.findIndex(
                  (alert) =>
                    alert.id ===
                    updatedAlert.id,
                );

              if (existingIndex === -1) {
                return [
                  updatedAlert,
                  ...currentAlerts,
                ];
              }

              const nextAlerts = [
                ...currentAlerts,
              ];

              nextAlerts[
                existingIndex
              ] = updatedAlert;

              return nextAlerts;
            });

            return;
          }

          /*
           * ALERT RESOLVED
           *
           * Remove it immediately from the
           * visible frontend alert state.
           */
          if (
            message?.type ===
            "noise_alert_resolved"
          ) {
            const backendAlert =
              message.data as BackendAlert;

            if (
              !backendAlert ||
              typeof backendAlert.id !==
                "number"
            ) {
              return;
            }

            setAlerts((currentAlerts) =>
              currentAlerts.map(
                (alert) =>
                  alert.id ===
                  backendAlert.id
                    ? mapBackendAlert(
                        backendAlert,
                      )
                    : alert,
              ),
            );

            return;
          }
        } catch {
          // Ignore malformed WebSocket messages.
        }
      };

      socket.onerror = () => {
        if (
          !isUnmountedRef.current
        ) {
          setWsConnected(false);
        }
      };

      socket.onclose = () => {
        if (isUnmountedRef.current) {
          return;
        }

        setWsConnected(false);
        socketRef.current = null;

        reconnectTimerRef.current =
          window.setTimeout(
            connectWebSocket,
            3000,
          );
      };
    };

    connectWebSocket();

    return () => {
      isUnmountedRef.current = true;

      if (
        reconnectTimerRef.current !==
        null
      ) {
        window.clearTimeout(
          reconnectTimerRef.current,
        );

        reconnectTimerRef.current = null;
      }

      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
    };
  }, []);

  /*
   * ACKNOWLEDGE ALERT
   */
  const acknowledgeAlert = async (
    id: number,
  ) => {
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/alerts/${id}/acknowledge`,
        {
          method: "PUT",
        },
      );

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status}`,
        );
      }

      const updatedAlert: BackendAlert =
        await response.json();

      setAlerts((currentAlerts) =>
        currentAlerts.map((alert) =>
          alert.id === id
            ? mapBackendAlert(
                updatedAlert,
              )
            : alert,
        ),
      );
    } catch {
      // Keep current UI state if request fails.
    }
  };

  /*
   * CLEAR ACKNOWLEDGED
   */
  const clearAcknowledged = () => {
    setAlerts((currentAlerts) =>
      currentAlerts.filter(
        (alert) =>
          alert.status !==
          "ACKNOWLEDGED",
      ),
    );
  };

  /*
   * VISIBLE ALERTS
   */
  const visibleAlerts = useMemo(() => {
    const filteredAlerts =
      showAcknowledged
        ? alerts
        : alerts.filter(
            (alert) =>
              alert.status !==
              "ACKNOWLEDGED",
          );

    return filteredAlerts.filter(
      (alert) => !alert.resolved,
    );
  }, [
    alerts,
    showAcknowledged,
  ]);

  /*
   * ACTIVE COUNT
   *
   * Resolved alerts are never counted.
   */
  const activeCount = alerts.filter(
    (alert) =>
      alert.status === "ACTIVE" &&
      !alert.resolved,
  ).length;

  return (
    <section className="terminal-panel min-w-0 overflow-hidden">
      <div className="flex flex-col gap-2 border-b border-dashed border-[#1f521f] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">

        <div className="flex items-center gap-2">
          <Bell
            size={14}
            strokeWidth={1.8}
            className="text-[#ffb000]"
            aria-hidden="true"
          />

          <span className="text-xs text-[#33ff00]">
            +--- ALERTS_PANEL ---+
          </span>
        </div>

        <div className="flex items-center gap-3 text-[9px]">

          <span
            className={
              wsConnected
                ? "text-[#33ff00]"
                : "text-[#ff3333]"
            }
          >
            WS: [
            {wsConnected
              ? "CONNECTED"
              : "OFFLINE"}
            ]
          </span>

          <span className="text-[#ffb000]">
            ACTIVE: [{activeCount}]
          </span>

        </div>
      </div>

      <div className="flex items-center justify-between border-b border-dashed border-[#1f521f] px-4 py-2">

        <button
          type="button"
          onClick={() =>
            setShowAcknowledged(
              (current) =>
                !current,
            )
          }
          className="text-[9px] text-[#1f9e1f] transition-colors hover:text-[#33ff00]"
        >
          [
          {showAcknowledged
            ? "ACTIVE_ONLY"
            : "SHOW_ALL"}
          ]
        </button>

        <button
          type="button"
          onClick={clearAcknowledged}
          className="text-[9px] text-[#1f9e1f] transition-colors hover:text-[#ff3333]"
        >
          [CLEAR_ACK]
        </button>

      </div>

      <div className="max-h-[390px] overflow-y-auto">

        {loading ? (
          <div className="flex min-h-[250px] items-center justify-center px-4 text-center">
            <div className="text-[10px] text-[#1f9e1f]">
              [ LOADING_ALERTS... ]
            </div>
          </div>
        ) : visibleAlerts.length ===
          0 ? (
          <div className="flex min-h-[250px] flex-col items-center justify-center px-4 text-center">

            <CheckCircle2
              size={28}
              strokeWidth={1.5}
              className="mb-3 text-[#33ff00]"
              aria-hidden="true"
            />

            <div className="text-xs text-[#33ff00]">
              [ NO_ACTIVE_ALERTS ]
            </div>

            <div className="mt-1 text-[9px] text-[#1f9e1f]">
              SYSTEM_STATUS: NORMAL
            </div>

          </div>
        ) : (
          visibleAlerts.map(
            (alert) => {
              const style =
                typeStyles[
                  alert.type
                ];

              const AlertIcon =
                style.icon;

              const isAcknowledged =
                alert.status ===
                "ACKNOWLEDGED";

              return (
                <article
                  key={alert.id}
                  className={`border-b border-dashed border-[#1f521f] px-4 py-4${
                    isAcknowledged
                      ? " opacity-50"
                      : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">

                    <div className="flex min-w-0 items-center gap-2">

                      <AlertIcon
                        size={13}
                        strokeWidth={1.8}
                        className={`shrink-0 ${style.text}`}
                        aria-hidden="true"
                      />

                      <span
                        className={`truncate text-[10px] font-bold ${style.text}`}
                      >
                        [{alert.type}]{" "}
                        {alert.event}
                      </span>

                    </div>

                    <span className="flex shrink-0 items-center gap-1 text-[8px] text-[#1f521f]">

                      <Clock3
                        size={10}
                        strokeWidth={1.5}
                      />

                      {alert.time}

                    </span>

                  </div>

                  <div className="mt-3 space-y-1 text-[9px]">

                    <div>
                      <span className="text-[#1f9e1f]">
                        Location:{" "}
                      </span>

                      <span className="text-[#33ff00]">
                        {alert.location}
                      </span>
                    </div>

                    <div>
                      <span className="text-[#1f9e1f]">
                        Level:{" "}
                      </span>

                      <span
                        className={
                          style.text
                        }
                      >
                        {alert.level.toFixed(
                          1,
                        )}{" "}
                        dB
                      </span>
                    </div>

                    <div>
                      <span className="text-[#1f9e1f]">
                        Status:{" "}
                      </span>

                      <span
                        className={
                          isAcknowledged
                            ? "text-[#1f9e1f]"
                            : style.text
                        }
                      >
                        [{alert.status}]
                      </span>
                    </div>

                  </div>

                  {!isAcknowledged && (
                    <button
                      type="button"
                      onClick={() =>
                        acknowledgeAlert(
                          alert.id,
                        )
                      }
                      className={`mt-3 border ${style.border} px-2 py-1 text-[8px] ${style.text} transition-colors hover:bg-[#111711]`}
                    >
                      [ ACKNOWLEDGE ]
                    </button>
                  )}

                  {isAcknowledged && (
                    <div className="mt-3 text-[8px] text-[#1f9e1f]">
                      [ EVENT_ACKNOWLEDGED ]
                    </div>
                  )}

                </article>
              );
            },
          )
        )}

      </div>

      <div className="border-t border-dashed border-[#1f521f] px-4 py-3">

        <div className="flex items-center justify-between text-[9px]">

          <span className="text-[#1f9e1f]">
            TOTAL_EVENTS
          </span>

          <span className="text-[#33ff00]">
            [{alerts.length}]
          </span>

        </div>

      </div>
    </section>
  );
}