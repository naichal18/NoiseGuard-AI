import type { LucideIcon } from "lucide-react";

interface MetricCardProps {
  label: string;
  value: string;
  unit?: string;
  status: string;
  statusType?: "ok" | "moderate" | "high" | "warning" | "critical";
  icon: LucideIcon;
  progress?: number;
}

const statusClasses = {
  ok: "text-[#33ff00]",
  moderate: "text-[#ffb000]",
  high: "text-[#ff3333]",
  warning: "text-[#ffb000]",
  critical: "text-[#ff3333]",
};

export default function MetricCard({
  label,
  value,
  unit,
  status,
  statusType = "ok",
  icon: Icon,
  progress = 70,
}: MetricCardProps) {
  const safeProgress = Math.min(100, Math.max(0, progress));

  const filledBars = Math.round(safeProgress / 8);
  const totalBars = 12;

  return (
    <article className="terminal-panel min-w-0">
      <div className="flex items-center justify-between gap-3 border-b border-dashed border-[#1f521f] px-3 py-2">
        <span className="truncate text-[10px] text-[#1f9e1f]">
          {label}
        </span>

        <Icon
          size={14}
          strokeWidth={1.8}
          className="shrink-0 text-[#1f9e1f]"
          aria-hidden="true"
        />
      </div>

      <div className="p-3">
        <div className="flex items-end gap-2">
          <span className="terminal-glow-strong text-2xl font-bold leading-none text-[#33ff00] sm:text-3xl">
            {value}
          </span>

          {unit && (
            <span className="pb-0.5 text-xs text-[#1f9e1f]">
              {unit}
            </span>
          )}
        </div>

        <div
          className={`mt-3 text-[10px] ${statusClasses[statusType]}`}
        >
          STATUS: [{status}]
        </div>

        <div
          className="mt-3 flex gap-1 overflow-hidden font-mono text-[10px] text-[#1f9e1f]"
          aria-label={`${safeProgress}% capacity`}
        >
          {Array.from({ length: totalBars }).map((_, index) => (
            <span key={index}>
              {index < filledBars ? "|" : "."}
            </span>
          ))}
        </div>

        <div className="mt-1 flex justify-between text-[8px] text-[#1f521f]">
          <span>0%</span>
          <span>{safeProgress}%</span>
          <span>100%</span>
        </div>
      </div>
    </article>
  );
}