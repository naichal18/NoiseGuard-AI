import type { ReactNode } from "react";

interface TerminalPanelProps {
  title: string;
  children: ReactNode;
  className?: string;
  headerRight?: ReactNode;
}

export default function TerminalPanel({
  title,
  children,
  className = "",
  headerRight,
}: TerminalPanelProps) {
  return (
    <section
      className={`terminal-panel overflow-hidden ${className}`}
    >
      <div className="flex min-h-10 items-center justify-between gap-4 border-b border-dashed border-[#1f521f] px-4 py-2 text-xs">
        <span className="min-w-0 truncate text-[#33ff00]">
          +--- {title} ---+
        </span>

        {headerRight && (
          <div className="shrink-0 text-[#1f9e1f]">
            {headerRight}
          </div>
        )}
      </div>

      <div className="p-4">{children}</div>
    </section>
  );
}