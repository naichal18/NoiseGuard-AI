"use client";

import { Activity, Wifi } from "lucide-react";
import { useEffect, useState } from "react";

function getCurrentTime() {
  return new Date().toLocaleTimeString("en-GB", {
    hour12: false,
  });
}

function getCurrentDate() {
  return new Date()
    .toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    })
    .replace(/\//g, "-");
}

export default function Header() {
  const [mounted, setMounted] = useState(false);
  const [time, setTime] = useState("");
  const [date, setDate] = useState("");

  useEffect(() => {
    setMounted(true);

    const updateClock = () => {
      setTime(getCurrentTime());
      setDate(getCurrentDate());
    };

    updateClock();

    const interval = window.setInterval(updateClock, 1000);

    return () => window.clearInterval(interval);
  }, []);

  return (
    <header className="border-b border-[#1f521f] bg-[#0a0a0a] px-4 py-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        {/* Brand */}
        <div className="flex min-w-0 items-center gap-3">
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center border border-[#33ff00] text-[#33ff00]"
            aria-hidden="true"
          >
            ◈
          </div>

          <div className="min-w-0">
            <div className="terminal-glow truncate text-sm font-bold tracking-wide text-[#33ff00] sm:text-base">
              NOISEGUARD_AI
            </div>

            <div className="truncate text-[10px] text-[#1f9e1f] sm:text-xs">
              SMART_CITY_NOISE_MONITORING_SYSTEM
            </div>
          </div>
        </div>

        {/* System Information */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[10px] sm:text-xs">
          <div className="flex items-center gap-2">
            <Activity
              size={14}
              strokeWidth={2}
              aria-hidden="true"
            />

            <span className="text-[#1f9e1f]">
              SYSTEM:
            </span>

            <span className="text-[#33ff00]">
              [ONLINE]
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Wifi
              size={14}
              strokeWidth={2}
              aria-hidden="true"
            />

            <span className="text-[#1f9e1f]">
              NETWORK:
            </span>

            <span className="text-[#33ff00]">
              [CONNECTED]
            </span>
          </div>

          <div>
            <span className="text-[#1f9e1f]">
              DATE:
            </span>{" "}

            <span className="text-[#33ff00]">
              {mounted ? date : "--/--/----"}
            </span>
          </div>

          <div className="min-w-[72px]">
            <span className="text-[#1f9e1f]">
              TIME:
            </span>{" "}

            <span className="text-[#33ff00]">
              {mounted ? time : "--:--:--"}
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}