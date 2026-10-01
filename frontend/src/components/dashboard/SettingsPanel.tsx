"use client";

import { useEffect, useState } from "react";
import {
  Bell,
  Bot,
  Database,
  Gauge,
  Radio,
  RotateCcw,
  Save,
  Settings as SettingsIcon,
  ShieldAlert,
  Wifi,
} from "lucide-react";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000";

interface SettingsState {
  alert_engine_enabled: boolean;
  auto_resolve_enabled: boolean;
  high_noise_threshold_db: number;
  critical_noise_threshold_db: number;
  day_limit_db: number;
  night_limit_db: number;
  timezone: string;
  ai_analysis_enabled: boolean;
  recommendation_engine_enabled: boolean;
  simulator_enabled: boolean;
  websocket_enabled: boolean;
  simulator_interval_seconds: number;
  critical_notifications_enabled: boolean;
  high_notifications_enabled: boolean;
  browser_notifications_enabled: boolean;
}

const DEFAULTS: SettingsState = {
  alert_engine_enabled: true,
  auto_resolve_enabled: true,
  high_noise_threshold_db: 85,
  critical_noise_threshold_db: 95,
  day_limit_db: 55,
  night_limit_db: 45,
  timezone: "Asia/Kolkata",
  ai_analysis_enabled: true,
  recommendation_engine_enabled: true,
  simulator_enabled: true,
  websocket_enabled: true,
  simulator_interval_seconds: 5,
  critical_notifications_enabled: true,
  high_notifications_enabled: true,
  browser_notifications_enabled: false,
};

function Toggle({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={`border px-2 py-1 text-[9px] ${
        value
          ? "border-[#33ff00] text-[#33ff00]"
          : "border-[#1f521f] text-[#1f9e1f]"
      }`}
      aria-pressed={value}
    >
      [{value ? "ON" : "OFF"}]
    </button>
  );
}

function NumberField({
  label,
  value,
  onChange,
  suffix,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  suffix: string;
  min: number;
  max: number;
}) {
  return (
    <label className="block border border-[#1f521f] p-3">
      <span className="block text-[9px] text-[#1f9e1f]">{label}</span>
      <span className="mt-2 flex items-center gap-2">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          onChange={(event) => onChange(Number(event.target.value))}
          className="w-full border border-[#1f521f] bg-[#080b08] px-2 py-2 text-xs text-[#33ff00] outline-none focus:border-[#33ff00]"
        />
        <span className="text-[9px] text-[#ffb000]">{suffix}</span>
      </span>
    </label>
  );
}

function SettingRow({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-dashed border-[#1f521f] py-3 last:border-b-0">
      <div>
        <div className="text-[10px] text-[#33ff00]">{label}</div>
        <div className="mt-1 text-[9px] text-[#1f9e1f]">{description}</div>
      </div>
      <Toggle value={value} onChange={onChange} />
    </div>
  );
}

export default function SettingsPanel() {
  const [settings, setSettings] = useState<SettingsState>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("[ READY ]");

  const loadSettings = async () => {
    try {
      setLoading(true);
      setMessage("[ LOADING_CONFIGURATION ]");

      const response = await fetch(`${API_BASE_URL}/api/settings`, {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      setSettings({
        ...DEFAULTS,
        ...(data.settings ?? {}),
      });
      setMessage("[ CONFIGURATION_LOADED ]");
    } catch (error) {
      console.error("Settings load failed:", error);
      setMessage("[ ERR ] BACKEND_UNAVAILABLE");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSettings();
  }, []);

  const update = <K extends keyof SettingsState>(
    key: K,
    value: SettingsState[K],
  ) => {
    setSettings((current) => ({
      ...current,
      [key]: value,
    }));
    setMessage("[ UNSAVED_CHANGES ]");
  };

  const updateBrowserNotifications = async (value: boolean) => {
    update("browser_notifications_enabled", value);

    if (!value) {
      setMessage("[ UNSAVED_CHANGES ] BROWSER_NOTIFICATIONS_OFF");
      return;
    }

    if (typeof window === "undefined" || !("Notification" in window)) {
      setMessage("[ UNSAVED_CHANGES ] BROWSER_NOTIFICATIONS_UNSUPPORTED");
      return;
    }

    if (Notification.permission === "granted") {
      setMessage("[ UNSAVED_CHANGES ] BROWSER_NOTIFICATIONS_ON");
      return;
    }

    if (Notification.permission === "denied") {
      setMessage(
        "[ WARN ] BROWSER_PERMISSION_BLOCKED // ALLOW_IN_BROWSER_SETTINGS",
      );
      return;
    }

    try {
      const permission = await Notification.requestPermission();
      setMessage(
        permission === "granted"
          ? "[ UNSAVED_CHANGES ] BROWSER_PERMISSION_GRANTED"
          : "[ UNSAVED_CHANGES ] BROWSER_PERMISSION_NOT_GRANTED",
      );
    } catch {
      setMessage("[ UNSAVED_CHANGES ] BROWSER_PERMISSION_REQUEST_FAILED");
    }
  };

  const saveSettings = async () => {
    if (settings.critical_noise_threshold_db <= settings.high_noise_threshold_db) {
      setMessage("[ ERR ] CRITICAL_THRESHOLD_MUST_BE_HIGHER");
      return;
    }

    try {
      setSaving(true);
      setMessage("[ SAVING_CONFIGURATION ]");

      const response = await fetch(`${API_BASE_URL}/api/settings`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(settings),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail ?? `HTTP ${response.status}`);
      }

      setSettings({
        ...DEFAULTS,
        ...(data.settings ?? {}),
      });
      setMessage("[ OK ] SETTINGS_SAVED");
    } catch (error) {
      console.error("Settings save failed:", error);
      setMessage(
        `[ ERR ] ${error instanceof Error ? error.message : "SAVE_FAILED"}`,
      );
    } finally {
      setSaving(false);
    }
  };

  const resetSettings = async () => {
    try {
      setSaving(true);
      setMessage("[ RESTORING_DEFAULTS ]");

      const response = await fetch(`${API_BASE_URL}/api/settings/reset`, {
        method: "POST",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail ?? `HTTP ${response.status}`);
      }

      setSettings({
        ...DEFAULTS,
        ...(data.settings ?? {}),
      });
      setMessage("[ OK ] DEFAULTS_RESTORED");
    } catch (error) {
      console.error("Settings reset failed:", error);
      setMessage(
        `[ ERR ] ${error instanceof Error ? error.message : "RESET_FAILED"}`,
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="terminal-panel min-w-0 overflow-hidden">
      <div className="flex flex-col gap-2 border-b border-dashed border-[#1f521f] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <SettingsIcon size={15} className="text-[#33ff00]" />
          <span className="text-xs text-[#33ff00]">
            +--- SYSTEM_SETTINGS ---+
          </span>
        </div>
        <div className="text-[9px] text-[#1f9e1f]">
          {loading ? "[ LOADING ]" : message}
        </div>
      </div>

      <div className="space-y-4 p-4">
        <div className="grid gap-4 xl:grid-cols-2">
          <div className="border border-[#1f521f] p-4">
            <div className="mb-3 flex items-center gap-2">
              <ShieldAlert size={14} className="text-[#ffb000]" />
              <span className="text-[10px] text-[#33ff00]">
                ALERT_CONFIGURATION
              </span>
            </div>

            <SettingRow
              label="ALERT_ENGINE"
              description="Enable automatic threshold-based alert creation."
              value={settings.alert_engine_enabled}
              onChange={(value) => update("alert_engine_enabled", value)}
            />

            <SettingRow
              label="AUTO_RESOLVE"
              description="Resolve active alerts when noise returns below threshold."
              value={settings.auto_resolve_enabled}
              onChange={(value) => update("auto_resolve_enabled", value)}
            />

            <div className="grid gap-3 pt-3 sm:grid-cols-2">
              <NumberField
                label="HIGH_NOISE_THRESHOLD"
                value={settings.high_noise_threshold_db}
                onChange={(value) =>
                  update("high_noise_threshold_db", value)
                }
                suffix="dB"
                min={45}
                max={200}
              />
              <NumberField
                label="CRITICAL_NOISE_THRESHOLD"
                value={settings.critical_noise_threshold_db}
                onChange={(value) =>
                  update("critical_noise_threshold_db", value)
                }
                suffix="dB"
                min={45}
                max={200}
              />
            </div>
          </div>

          <div className="border border-[#1f521f] p-4">
            <div className="mb-3 flex items-center gap-2">
              <Gauge size={14} className="text-[#ffb000]" />
              <span className="text-[10px] text-[#33ff00]">
                NOISE_COMPLIANCE
              </span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <NumberField
                label="DAY_LIMIT"
                value={settings.day_limit_db}
                onChange={(value) => update("day_limit_db", value)}
                suffix="dB"
                min={0}
                max={200}
              />
              <NumberField
                label="NIGHT_LIMIT"
                value={settings.night_limit_db}
                onChange={(value) => update("night_limit_db", value)}
                suffix="dB"
                min={0}
                max={200}
              />
            </div>

            <div className="mt-3 border border-dashed border-[#1f521f] p-3 text-[9px]">
              <div className="text-[#1f9e1f]">TIMEZONE</div>
              <div className="mt-1 text-[#33ff00]">{settings.timezone}</div>
              <div className="mt-1 text-[#1f9e1f]">
                DAY: 06:00-22:00 / NIGHT: 22:00-06:00
              </div>
            </div>
          </div>

          <div className="border border-[#1f521f] p-4">
            <div className="mb-3 flex items-center gap-2">
              <Bot size={14} className="text-[#33ff00]" />
              <span className="text-[10px] text-[#33ff00]">
                AI_CONFIGURATION
              </span>
            </div>

            <SettingRow
              label="AI_ANALYSIS"
              description="Allow anomaly analysis features to run."
              value={settings.ai_analysis_enabled}
              onChange={(value) => update("ai_analysis_enabled", value)}
            />

            <SettingRow
              label="RECOMMENDATION_ENGINE"
              description="Enable operational recommendation generation."
              value={settings.recommendation_engine_enabled}
              onChange={(value) =>
                update("recommendation_engine_enabled", value)
              }
            />

            <div className="mt-3 border border-dashed border-[#1f521f] p-3 text-[9px]">
              <div className="text-[#1f9e1f]">AI_ENGINE</div>
              <div className="mt-1 text-[#33ff00]">[ READY ]</div>
              <div className="mt-1 text-[#1f9e1f]">
                Model configuration remains server-side.
              </div>
            </div>
          </div>

          <div className="border border-[#1f521f] p-4">
            <div className="mb-3 flex items-center gap-2">
              <Radio size={14} className="text-[#33ff00]" />
              <span className="text-[10px] text-[#33ff00]">
                DATA_AND_STREAM
              </span>
            </div>

            <SettingRow
              label="SIMULATOR"
              description="Enable the development sensor data simulator."
              value={settings.simulator_enabled}
              onChange={(value) => update("simulator_enabled", value)}
            />

            <SettingRow
              label="WEBSOCKET_STREAM"
              description="Allow live dashboard stream connections."
              value={settings.websocket_enabled}
              onChange={(value) => update("websocket_enabled", value)}
            />

            <NumberField
              label="SIMULATOR_INTERVAL"
              value={settings.simulator_interval_seconds}
              onChange={(value) =>
                update("simulator_interval_seconds", value)
              }
              suffix="SEC"
              min={1}
              max={3600}
            />

            <div className="mt-3 grid grid-cols-2 gap-2 text-[9px]">
              <div className="border border-[#1f521f] p-2">
                <Database size={12} className="mb-1 text-[#1f9e1f]" />
                <div className="text-[#33ff00]">DATABASE</div>
                <div className="text-[#1f9e1f]">[ ONLINE ]</div>
              </div>
              <div className="border border-[#1f521f] p-2">
                <Wifi size={12} className="mb-1 text-[#1f9e1f]" />
                <div className="text-[#33ff00]">STREAM</div>
                <div className="text-[#1f9e1f]">[ LIVE ]</div>
              </div>
            </div>
          </div>

          <div className="border border-[#1f521f] p-4 xl:col-span-2">
            <div className="mb-3 flex items-center gap-2">
              <Bell size={14} className="text-[#ffb000]" />
              <span className="text-[10px] text-[#33ff00]">
                NOTIFICATION_SETTINGS
              </span>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <SettingRow
                label="CRITICAL_ALERTS"
                description="Allow critical alert notifications."
                value={settings.critical_notifications_enabled}
                onChange={(value) =>
                  update("critical_notifications_enabled", value)
                }
              />
              <SettingRow
                label="HIGH_ALERTS"
                description="Allow high alert notifications."
                value={settings.high_notifications_enabled}
                onChange={(value) =>
                  update("high_notifications_enabled", value)
                }
              />
              <SettingRow
                label="BROWSER_NOTIFICATIONS"
                description="Allow desktop browser alerts for high and critical noise events."
                value={settings.browser_notifications_enabled}
                onChange={(value) => void updateBrowserNotifications(value)}
              />
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t border-dashed border-[#1f521f] pt-4 sm:flex-row">
          <button
            type="button"
            onClick={saveSettings}
            disabled={saving || loading}
            className="terminal-button flex items-center justify-center gap-2 px-4 py-2 text-[10px] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Save size={13} />
            [ SAVE_SETTINGS ]
          </button>

          <button
            type="button"
            onClick={() => void resetSettings()}
            disabled={saving}
            className="border border-[#ffb000] px-4 py-2 text-[10px] text-[#ffb000] hover:bg-[#ffb000] hover:text-black disabled:opacity-50"
          >
            <span className="inline-flex items-center gap-2">
              <RotateCcw size={13} />
              [ RESET_DEFAULTS ]
            </span>
          </button>
        </div>
      </div>
    </section>
  );
}
