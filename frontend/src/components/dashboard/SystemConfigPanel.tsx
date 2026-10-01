"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  Activity,
  Clock3,
  Database,
  FileText,
  HardDrive,
  RadioTower,
  RefreshCw,
  RotateCcw,
  Save,
  Server,
  Settings2,
  ShieldCheck,
  Trash2,
  Wrench,
} from "lucide-react";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000";

type ToggleKey =
  | "reload_dev"
  | "auto_backup"
  | "auto_discover"
  | "auto_cleanup"
  | "enable_cors"
  | "api_key_required";

interface SystemConfig {
  app_name: string;
  environment: string;
  log_level: string;
  timezone: string;
  host: string;
  port: number;
  workers: number;
  reload_dev: boolean;
  database_type: string;
  database_url: string;
  auto_backup: boolean;
  backup_interval_hours: number;
  default_interval_seconds: number;
  max_sensors: number;
  sensor_timeout_seconds: number;
  auto_discover: boolean;
  readings_retention_days: number;
  alerts_retention_days: number;
  logs_retention_days: number;
  auto_cleanup: boolean;
  enable_cors: boolean;
  allowed_origins: string;
  api_key_required: boolean;
  rate_limit_per_minute: number;
  simulator_enabled: boolean;
  websocket_enabled: boolean;
  ai_analysis_enabled: boolean;
  recommendation_engine_enabled: boolean;
  high_noise_threshold_db: number;
  critical_noise_threshold_db: number;
}

interface SystemLog {
  timestamp: string;
  level: "INFO" | "WARN" | "ERROR";
  message: string;
}

interface SystemResponse {
  config: SystemConfig;
  logs: SystemLog[];
  status: {
    system: string;
    api: string;
    database: string;
    stream: string;
    sensor_count: number;
  };
}

const DEFAULTS: SystemConfig = {
  app_name: "NoiseGuard AI",
  environment: "Development",
  log_level: "INFO",
  timezone: "Asia/Kolkata",
  host: "0.0.0.0",
  port: 8000,
  workers: 4,
  reload_dev: true,
  database_type: "Configured by backend",
  database_url: "Configured by backend",
  auto_backup: true,
  backup_interval_hours: 24,
  default_interval_seconds: 5,
  max_sensors: 100,
  sensor_timeout_seconds: 30,
  auto_discover: true,
  readings_retention_days: 90,
  alerts_retention_days: 180,
  logs_retention_days: 30,
  auto_cleanup: true,
  enable_cors: true,
  allowed_origins: "http://localhost:3000,http://127.0.0.1:3000",
  api_key_required: false,
  rate_limit_per_minute: 100,
  simulator_enabled: true,
  websocket_enabled: true,
  ai_analysis_enabled: true,
  recommendation_engine_enabled: true,
  high_noise_threshold_db: 85,
  critical_noise_threshold_db: 95,
};

function Panel({
  title,
  icon,
  children,
  className = "",
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`terminal-border p-4 ${className}`}>
      <div className="mb-4 flex items-center gap-2 border-b border-dashed border-[#1f521f] pb-2">
        <span className="text-[#33ff00]">{icon}</span>
        <h2 className="text-[11px] font-bold tracking-wide text-[#33ff00]">
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  suffix,
  disabled = false,
  readOnly = false,
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  type?: "text" | "number";
  suffix?: string;
  disabled?: boolean;
  readOnly?: boolean;
}) {
  return (
    <label className="grid grid-cols-[minmax(110px,0.8fr)_minmax(0,1.2fr)] items-center gap-3 text-[10px]">
      <span className="text-[#66cc66]">{label}</span>
      <span className="flex min-w-0 items-center gap-2">
        <input
          type={type}
          value={value}
          disabled={disabled}
          readOnly={readOnly}
          title={String(value)}
          onChange={(event) => onChange(event.target.value)}
          className="min-w-0 w-full border border-[#1f7a1f] bg-[#050805] px-2 py-2 text-[10px] text-[#33ff00] outline-none transition focus:border-[#33ff00] disabled:cursor-not-allowed disabled:opacity-50 read-only:cursor-default read-only:opacity-80"
        />
        {suffix ? <span className="shrink-0 text-[8px] text-[#ffb000]">{suffix}</span> : null}
      </span>
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="grid grid-cols-[minmax(110px,0.8fr)_minmax(0,1.2fr)] items-center gap-3 text-[10px]">
      <span className="text-[#66cc66]">{label}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="w-full border border-[#1f7a1f] bg-[#050805] px-2 py-2 text-[10px] text-[#33ff00] outline-none focus:border-[#33ff00] disabled:cursor-not-allowed disabled:opacity-80"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (value: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={`border px-3 py-1 text-[9px] font-bold tracking-wide transition ${
        value
          ? "border-[#33ff00] text-[#33ff00]"
          : "border-[#6f4b00] text-[#ffb000]"
      }`}
    >
      [ {value ? "ON" : "OFF"} ]
    </button>
  );
}

function ToggleRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-[10px]">
      <span className="text-[#66cc66]">{label}</span>
      <Toggle value={value} onChange={onChange} />
    </div>
  );
}

export default function SystemConfigPanel() {
  const [config, setConfig] = useState<SystemConfig>(DEFAULTS);
  const [logs, setLogs] = useState<SystemLog[]>([]);
  const [status, setStatus] = useState<SystemResponse["status"]>({
    system: "ONLINE",
    api: "CONNECTED",
    database: "ONLINE",
    stream: "LIVE",
    sensor_count: 0,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [message, setMessage] = useState("[ READY ]");
  const [confirmReset, setConfirmReset] = useState(false);

  const loadConfig = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/system-config`, {
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.detail ?? `HTTP ${response.status}`);
      setConfig({ ...DEFAULTS, ...(data.config ?? {}) });
      setLogs(Array.isArray(data.logs) ? data.logs : []);
      setStatus({
        system: data.status?.system ?? "ONLINE",
        api: data.status?.api ?? "CONNECTED",
        database: data.status?.database ?? "ONLINE",
        stream: data.status?.stream ?? "LIVE",
        sensor_count: Number(data.status?.sensor_count ?? 0),
      });
    } catch (error) {
      setMessage(`[ ERR ] ${error instanceof Error ? error.message : "CONFIG_LOAD_FAILED"}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  const update = <K extends keyof SystemConfig>(key: K, value: SystemConfig[K]) => {
    setConfig((current) => ({ ...current, [key]: value }));
  };

  const updateNumber = (key: keyof SystemConfig, value: string) => {
    const numberValue = Number(value);
    if (!Number.isNaN(numberValue)) {
      setConfig((current) => ({ ...current, [key]: numberValue } as SystemConfig));
    }
  };

  const updateToggle = (key: ToggleKey, value: boolean) => update(key, value);

  const saveConfig = async () => {
    if (saving) return;
    if (config.critical_noise_threshold_db <= config.high_noise_threshold_db) {
      setMessage("[ ERR ] CRITICAL_THRESHOLD_MUST_BE_HIGHER");
      return;
    }
    setSaving(true);
    setMessage("[ SAVING_CONFIGURATION ]");
    try {
      const response = await fetch(`${API_BASE_URL}/api/system-config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(config),
        cache: "no-store",
      });
      const raw = await response.text();
      let data: any = null;
      try { data = raw ? JSON.parse(raw) : null; } catch { /* handled below */ }
      if (!response.ok) throw new Error(data?.detail ?? (raw || `HTTP ${response.status}`));
      setConfig({ ...DEFAULTS, ...(data.config ?? config) });
      setLogs(Array.isArray(data.logs) ? data.logs : logs);
      setMessage(data.restart_required ? "[ OK ] SAVED :: RESTART_REQUIRED" : "[ OK ] SYSTEM_CONFIG_SAVED");
    } catch (error) {
      setMessage(`[ ERR ] ${error instanceof Error ? error.message : "SAVE_FAILED"}`);
    } finally {
      setSaving(false);
    }
  };

  const runAction = async (action: string, body: Record<string, unknown> = {}) => {
    if (busyAction) return;
    setBusyAction(action);
    setMessage(`[ ${action.toUpperCase()} ]`);
    try {
      const response = await fetch(`${API_BASE_URL}/api/system-config/actions/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
      });
      const raw = await response.text();
      let data: any = null;
      try { data = raw ? JSON.parse(raw) : null; } catch { /* handled below */ }
      if (!response.ok) throw new Error(data?.detail ?? (raw || `HTTP ${response.status}`));
      setMessage(`[ OK ] ${String(data?.message ?? `${action.toUpperCase()}_COMPLETED`)}`);
      if (Array.isArray(data?.logs)) setLogs(data.logs);
      if (data?.config) setConfig({ ...DEFAULTS, ...data.config });
      if (action === "factory-reset") setConfirmReset(false);
      await loadConfig();
    } catch (error) {
      setMessage(`[ ERR ] ${error instanceof Error ? error.message : `${action.toUpperCase()}_FAILED`}`);
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="mb-4 border-b border-dashed border-[#1f521f] pb-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[#33ff00]">
              <Settings2 size={22} />
              <h1 className="terminal-glow text-base font-bold tracking-wide sm:text-lg">
                SYSTEM CONFIGURATION
              </h1>
            </div>
            <p className="mt-1 text-[9px] text-[#1f9e1f]">
              Manage application, server and infrastructure settings.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-[8px]">
            {["SYSTEM", "API", "DATABASE", "STREAM"].map((item) => {
              const value =
                item === "SYSTEM" ? status.system :
                item === "API" ? status.api :
                item === "DATABASE" ? status.database : status.stream;
              return (
                <span key={item} className="border border-[#1f521f] px-2 py-1 text-[#1f9e1f]">
                  <span className="text-[#33ff00]">●</span> {item}:{" "}
                  <span className="text-[#33ff00]">{value}</span>
                </span>
              );
            })}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="terminal-border p-5 text-[10px] text-[#1f9e1f]">[ LOADING_SYSTEM_CONFIGURATION... ]</div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <Panel title="APPLICATION SETTINGS" icon={<FileText size={15} />}>
              <div className="space-y-3">
                <Field label="App Name" value={config.app_name} onChange={(v) => update("app_name", v)} />
                <SelectField label="Environment" value={config.environment} options={["Development", "Production", "Testing"]} onChange={(v) => update("environment", v)} />
                <SelectField label="Log Level" value={config.log_level} options={["DEBUG", "INFO", "WARNING", "ERROR"]} onChange={(v) => update("log_level", v)} />
                <SelectField label="Timezone" value={config.timezone} options={["Asia/Kolkata", "UTC", "Asia/Dubai", "Europe/London", "America/New_York"]} onChange={(v) => update("timezone", v)} />
              </div>
            </Panel>

            <Panel title="SERVER CONFIGURATION" icon={<Server size={15} />}>
              <div className="space-y-3">
                <Field label="Host" value={config.host} onChange={(v) => update("host", v)} />
                <Field label="Port" type="number" value={config.port} onChange={(v) => updateNumber("port", v)} />
                <Field label="Workers" type="number" value={config.workers} onChange={(v) => updateNumber("workers", v)} />
                <ToggleRow label="Reload (Dev)" value={config.reload_dev} onChange={(v) => updateToggle("reload_dev", v)} />
              </div>
              <p className="mt-3 text-[8px] text-[#ffb000]">[ PORT / WORKERS / HOST ] APPLY AFTER SERVER RESTART</p>
            </Panel>

            <Panel title="DATABASE CONFIGURATION" icon={<Database size={15} />}>
              <div className="space-y-3">
                <SelectField label="Database Type" value={config.database_type} options={[config.database_type]} disabled onChange={() => undefined} />
                <Field label="Database URL" value={config.database_url} readOnly onChange={() => undefined} />
                <p className="text-[8px] text-[#ffb000]">[ ACTIVE DATABASE ] READ-ONLY :: CHANGE DATABASE ENGINE IN BACKEND CONFIG</p>
                <ToggleRow label="Auto Backup" value={config.auto_backup} onChange={(v) => updateToggle("auto_backup", v)} />
                <Field label="Backup Interval" type="number" value={config.backup_interval_hours} onChange={(v) => updateNumber("backup_interval_hours", v)} suffix="HOURS" />
              </div>
            </Panel>

            <Panel title="SENSOR CONFIGURATION" icon={<RadioTower size={15} />}>
              <div className="space-y-3">
                <Field label="Default Interval" type="number" value={config.default_interval_seconds} onChange={(v) => updateNumber("default_interval_seconds", v)} suffix="SECONDS" />
                <Field label="Max Sensors" type="number" value={config.max_sensors} onChange={(v) => updateNumber("max_sensors", v)} />
                <Field label="Sensor Timeout" type="number" value={config.sensor_timeout_seconds} onChange={(v) => updateNumber("sensor_timeout_seconds", v)} suffix="SECONDS" />
                <ToggleRow label="Auto Discover" value={config.auto_discover} onChange={(v) => updateToggle("auto_discover", v)} />
                <ToggleRow label="Simulator" value={config.simulator_enabled} onChange={(v) => update("simulator_enabled", v)} />
                <ToggleRow label="WebSocket" value={config.websocket_enabled} onChange={(v) => update("websocket_enabled", v)} />
              </div>
            </Panel>

            <Panel title="DATA RETENTION" icon={<Clock3 size={15} />}>
              <div className="space-y-3">
                <Field label="Readings Retention" type="number" value={config.readings_retention_days} onChange={(v) => updateNumber("readings_retention_days", v)} suffix="DAYS" />
                <Field label="Alerts Retention" type="number" value={config.alerts_retention_days} onChange={(v) => updateNumber("alerts_retention_days", v)} suffix="DAYS" />
                <Field label="Logs Retention" type="number" value={config.logs_retention_days} onChange={(v) => updateNumber("logs_retention_days", v)} suffix="DAYS" />
                <ToggleRow label="Auto Cleanup" value={config.auto_cleanup} onChange={(v) => updateToggle("auto_cleanup", v)} />
              </div>
            </Panel>

            <Panel title="SECURITY & ACCESS" icon={<ShieldCheck size={15} />}>
              <div className="space-y-3">
                <ToggleRow label="Enable CORS" value={config.enable_cors} onChange={(v) => updateToggle("enable_cors", v)} />
                <Field label="Allowed Origins" value={config.allowed_origins} onChange={(v) => update("allowed_origins", v)} />
                <ToggleRow label="API Key Required" value={config.api_key_required} onChange={(v) => updateToggle("api_key_required", v)} />
                <Field label="Rate Limit" type="number" value={config.rate_limit_per_minute} onChange={(v) => updateNumber("rate_limit_per_minute", v)} suffix="REQ/MIN" />
              </div>
              <p className="mt-3 text-[8px] text-[#ffb000]">[ SECURITY CHANGES ] APPLY AFTER SERVER RESTART</p>
            </Panel>
          </div>

          <div className="terminal-border flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-[9px] text-[#1f9e1f]">
              STATUS: <span className="text-[#33ff00]">{message}</span>
            </div>
            <button
              type="button"
              onClick={() => void saveConfig()}
              disabled={saving || Boolean(busyAction)}
              className="inline-flex items-center justify-center gap-2 border border-[#33ff00] px-5 py-2 text-[10px] font-bold text-[#33ff00] transition hover:bg-[#33ff00] hover:text-black disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Save size={14} /> [ SAVE_SYSTEM_CONFIG ]
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <Panel title="SYSTEM ACTIONS" icon={<Wrench size={15} />}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <ActionButton label="RESTART SERVER" icon={<RefreshCw size={15} />} tone="green" busy={busyAction === "restart"} onClick={() => void runAction("restart")} />
                <ActionButton label="CLEAR LOGS" icon={<Trash2 size={15} />} tone="orange" busy={busyAction === "clear-logs"} onClick={() => void runAction("clear-logs")} />
                <ActionButton label="BACKUP DATABASE" icon={<HardDrive size={15} />} tone="blue" busy={busyAction === "backup-database"} onClick={() => void runAction("backup-database")} />
                <ActionButton label="FACTORY RESET" icon={<RotateCcw size={15} />} tone="red" busy={busyAction === "factory-reset"} onClick={() => setConfirmReset(true)} />
              </div>
              {confirmReset ? (
                <div className="mt-3 border border-[#ff3333] bg-[#120606] p-3 text-[9px] text-[#ff6666]">
                  <div className="font-bold">[ WARNING ] FACTORY RESET WILL RESTORE DEFAULT SYSTEM CONFIGURATION.</div>
                  <div className="mt-2 flex gap-2">
                    <button type="button" onClick={() => setConfirmReset(false)} className="border border-[#1f521f] px-3 py-1 text-[#33ff00]">[ CANCEL ]</button>
                    <button type="button" onClick={() => void runAction("factory-reset")} className="border border-[#ff3333] px-3 py-1 text-[#ff3333]">[ CONFIRM_RESET ]</button>
                  </div>
                </div>
              ) : null}
            </Panel>

            <Panel title="SYSTEM LOGS" icon={<Activity size={15} />}>
              <div className="mb-2 flex items-center justify-between text-[8px]">
                <span className="text-[#33ff00]">● LIVE</span>
                <button type="button" onClick={() => void loadConfig()} className="border border-[#1f7a1f] px-2 py-1 text-[#33ff00]">
                  {"{ REFRESH }"}
                </button>
              </div>
              <div className="max-h-64 overflow-auto border border-[#123512] bg-[#020402] p-3 font-mono text-[8px] leading-relaxed">
                {logs.length === 0 ? (
                  <div className="text-[#1f9e1f]">[ NO_SYSTEM_LOGS ]</div>
                ) : (
                  logs.map((log, index) => (
                    <div key={`${log.timestamp}-${index}`} className={log.level === "ERROR" ? "text-[#ff3333]" : log.level === "WARN" ? "text-[#ffb000]" : "text-[#66cc66]"}>
                      [{new Date(log.timestamp).toLocaleString("sv-SE")}] {log.level.padEnd(5, " ")} {log.message}
                    </div>
                  ))
                )}
              </div>
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}

function ActionButton({
  label,
  icon,
  tone,
  busy,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  tone: "green" | "orange" | "blue" | "red";
  busy: boolean;
  onClick: () => void;
}) {
  const toneClasses = {
    green: "border-[#33ff00] text-[#33ff00] hover:bg-[#33ff00] hover:text-black",
    orange: "border-[#ffb000] text-[#ffb000] hover:bg-[#ffb000] hover:text-black",
    blue: "border-[#00aaff] text-[#00aaff] hover:bg-[#00aaff] hover:text-black",
    red: "border-[#ff3333] text-[#ff3333] hover:bg-[#ff3333] hover:text-black",
  }[tone];

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={`flex items-center justify-center gap-2 border px-3 py-3 text-[9px] font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${toneClasses}`}
    >
      {icon}
      [ {busy ? "PROCESSING..." : label} ]
    </button>
  );
}
