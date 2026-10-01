"use client";

import {
  Activity,
  Bot,
  FileText,
  Gauge,
  LayoutDashboard,
  Settings,
  ShieldAlert,
  SlidersHorizontal,
} from "lucide-react";
import { useEffect, useState } from "react";

export type SidebarItem =
  | "DASHBOARD"
  | "LIVE MONITOR"
  | "ANALYTICS"
  | "AI ANALYSIS"
  | "VIOLATIONS"
  | "REPORTS"
  | "SETTINGS"
  | "SYSTEM CONFIG";

interface SidebarProps {
  activeItem: SidebarItem;
  onNavigate: (item: SidebarItem) => void;
}

const API_BASE_URL = "http://127.0.0.1:8000";

const menuItems: {
  label: SidebarItem;
  icon: typeof LayoutDashboard;
}[] = [
  {
    label: "DASHBOARD",
    icon: LayoutDashboard,
  },
  {
    label: "LIVE MONITOR",
    icon: Activity,
  },
  {
    label: "ANALYTICS",
    icon: Gauge,
  },
  {
    label: "AI ANALYSIS",
    icon: Bot,
  },
  {
    label: "VIOLATIONS",
    icon: ShieldAlert,
  },
  {
    label: "REPORTS",
    icon: FileText,
  },
];

const systemItems: {
  label: SidebarItem;
  icon: typeof Settings;
}[] = [
  {
    label: "SETTINGS",
    icon: Settings,
  },
  {
    label: "SYSTEM CONFIG",
    icon: SlidersHorizontal,
  },
];

interface SensorSummary {
  id?: number;
  sensor_code?: string;
  name?: string;
  is_active?: boolean;
  status?: string;
}

function extractSensors(payload: unknown): SensorSummary[] {
  if (Array.isArray(payload)) {
    return payload as SensorSummary[];
  }

  if (
    payload &&
    typeof payload === "object" &&
    "sensors" in payload &&
    Array.isArray(
      (payload as { sensors?: unknown }).sensors,
    )
  ) {
    return (payload as { sensors: SensorSummary[] }).sensors;
  }

  return [];
}

export default function Sidebar({
  activeItem,
  onNavigate,
}: SidebarProps) {
  const [activeSensorCount, setActiveSensorCount] =
    useState<number>(0);

  useEffect(() => {
    let cancelled = false;

    const fetchSensorCount = async () => {
      try {
        const response = await fetch(
          `${API_BASE_URL}/api/sensors?_sidebar_refresh=${Date.now()}`,
          {
            method: "GET",
            cache: "no-store",
          },
        );

        if (!response.ok) {
          throw new Error(
            `Sensor API returned HTTP ${response.status}`,
          );
        }

        const payload: unknown = await response.json();
        const sensors = extractSensors(payload);

        const activeSensors = sensors.filter(
          (sensor) => sensor.is_active !== false,
        );

        if (!cancelled) {
          setActiveSensorCount(activeSensors.length);
        }
      } catch {
        // Keep the last known sensor count if the API
        // temporarily becomes unavailable.
      }
    };

    fetchSensorCount();

    const intervalId = window.setInterval(
      fetchSensorCount,
      5000,
    );

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  return (
    <aside
      className="flex h-auto w-full flex-col border-b border-[#1f521f] bg-[#080808] lg:sticky lg:top-0 lg:h-[calc(100vh-65px)] lg:w-64 lg:shrink-0 lg:border-b-0 lg:border-r"
    >
      {/* TERMINAL HEADER */}
      <div className="border-b border-dashed border-[#1f521f] px-4 py-3">
        <div className="flex items-center gap-2 text-[10px] tracking-[0.18em] text-[#33ff00]">
          <span className="h-2 w-2 animate-pulse bg-[#33ff00]" />

          <span className="terminal-glow">
            NOISEGUARD_AI
          </span>
        </div>

        <div className="mt-1 text-[8px] tracking-[0.16em] text-[#1f8a1f]">
          CONTROL_TERMINAL
        </div>
      </div>

      {/* NAVIGATION */}
      <div className="flex-1 overflow-y-auto p-3">
        <div className="mb-2 px-1 text-[8px] tracking-[0.2em] text-[#1f8a1f]">
          // MODULES
        </div>

        <nav className="space-y-1">
          {menuItems.map(
            ({ label, icon: Icon }) => {
              const isActive =
                activeItem === label;

              return (
                <button
                  key={label}
                  type="button"
                  onClick={() =>
                    onNavigate(label)
                  }
                  className={
                    isActive
                      ? "flex w-full items-center gap-3 border border-[#33ff00] bg-[#33ff00] px-3 py-2 text-left text-[10px] tracking-[0.12em] text-black"
                      : "group flex w-full items-center gap-3 border border-transparent px-3 py-2 text-left text-[10px] tracking-[0.12em] text-[#4c804c] transition-all duration-150 hover:border-[#1f521f] hover:bg-[#0d140d] hover:text-[#33ff00]"
                  }
                >
                  <Icon
                    size={14}
                    className={
                      isActive
                        ? "text-black"
                        : "text-[#1f8a1f] group-hover:text-[#33ff00]"
                    }
                  />

                  <span className="truncate">
                    {isActive ? "> " : ""}
                    {label}
                  </span>

                  {isActive ? (
                    <span className="ml-auto text-[9px]">
                      ●
                    </span>
                  ) : null}
                </button>
              );
            },
          )}
        </nav>

        {/* SYSTEM */}
        <div className="mb-2 mt-6 px-1 text-[8px] tracking-[0.2em] text-[#1f8a1f]">
          // SYSTEM
        </div>

        <nav className="space-y-1">
          {systemItems.map(
            ({ label, icon: Icon }) => {
              const isActive =
                activeItem === label;

              return (
                <button
                  key={label}
                  type="button"
                  onClick={() =>
                    onNavigate(label)
                  }
                  className={
                    isActive
                      ? "flex w-full items-center gap-3 border border-[#33ff00] bg-[#33ff00] px-3 py-2 text-left text-[10px] tracking-[0.12em] text-black"
                      : "group flex w-full items-center gap-3 border border-transparent px-3 py-2 text-left text-[10px] tracking-[0.12em] text-[#4c804c] transition-all duration-150 hover:border-[#1f521f] hover:bg-[#0d140d] hover:text-[#33ff00]"
                  }
                >
                  <Icon
                    size={14}
                    className={
                      isActive
                        ? "text-black"
                        : "text-[#1f8a1f] group-hover:text-[#33ff00]"
                    }
                  />

                  <span className="truncate">
                    {isActive ? "> " : ""}
                    {label}
                  </span>

                  {isActive ? (
                    <span className="ml-auto text-[9px]">
                      ●
                    </span>
                  ) : null}
                </button>
              );
            },
          )}
        </nav>
      </div>

      {/* SYSTEM STATUS */}
      <div className="border-t border-dashed border-[#1f521f] p-3">
        <div className="border border-[#1f521f] bg-[#050505] p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[8px] tracking-[0.16em] text-[#1f8a1f]">
              SYSTEM_STATUS
            </span>

            <span className="flex items-center gap-1 text-[8px] text-[#33ff00]">
              <span className="h-1.5 w-1.5 animate-pulse bg-[#33ff00]" />
              ONLINE
            </span>
          </div>

          <div className="space-y-1 text-[8px] text-[#4c804c]">
            <div className="flex justify-between">
              <span>AI_ENGINE</span>

              <span className="text-[#33ff00]">
                READY
              </span>
            </div>

            <div className="flex justify-between">
              <span>SENSORS</span>

              <span className="text-[#33ff00]">
                {activeSensorCount} ACTIVE
              </span>
            </div>

            <div className="flex justify-between">
              <span>STREAM</span>

              <span className="text-[#33ff00]">
                LIVE
              </span>
            </div>
          </div>
        </div>

        <div className="mt-2 text-center text-[8px] text-[#1f521f]">
          NOISEGUARD AI // v1.0.0
        </div>
      </div>
    </aside>
  );
}