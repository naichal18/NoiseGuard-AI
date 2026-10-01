"use client";

import { useState } from "react";
import {
  Bot,
  BrainCircuit,
  MessageCircle,
  X,
} from "lucide-react";

import AIChatPanel from "@/components/dashboard/AIChatPanel";

interface FloatingAIAssistantProps {
  showOnMobile?: boolean;
}

export default function FloatingAIAssistant({
  showOnMobile = true,
}: FloatingAIAssistantProps) {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);

  return (
    <>
      {/* ------------------------------------------------------------------ */}
      {/* FLOATING AI WINDOW                                                 */}
      {/* ------------------------------------------------------------------ */}

      {open && (
        <div className="fixed bottom-[72px] right-3 z-[10000] h-[min(650px,calc(100vh-74px))] w-[min(680px,calc(100vw-20px))] sm:bottom-[68px] sm:right-5 sm:h-[min(650px,calc(100vh-82px))]">
          <div className="relative h-full max-h-[calc(100vh-74px)] overflow-hidden">
            {/* Terminal corner marker */}
            <div className="pointer-events-none absolute -top-2 left-4 z-10 bg-[#0a0a0a] px-2 text-[8px] tracking-[0.12em] text-[#33ff00]">
              [ AI_LINK_ACTIVE ]
            </div>

            {/* Close button */}
            <button
              type="button"
              aria-label="Close NoiseGuard AI"
              onClick={() => setOpen(false)}
              className="absolute right-2 top-2 z-20 flex h-7 w-7 items-center justify-center border border-[#1f521f] bg-[#080b08] text-[#33ff00] transition-colors hover:border-[#ff3333] hover:bg-[#120606] hover:text-[#ff3333]"
            >
              <X size={13} />
            </button>

            <div className="h-full max-h-[calc(100vh-74px)] overflow-y-auto">
              <AIChatPanel />
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* FLOATING AI BUTTON                                                  */}
      {/* ------------------------------------------------------------------ */}

      <div
        className={`fixed bottom-3 right-4 z-[10001] sm:bottom-4 sm:right-6 ${
          showOnMobile ? "" : "hidden sm:block"
        }`}
      >
        {/* Hover prompt */}
        <div
          className={`pointer-events-none absolute bottom-[calc(100%+12px)] right-0 w-[235px] origin-bottom-right transition-all duration-200 ${
            hovered && !open
              ? "translate-y-0 scale-100 opacity-100"
              : "translate-y-2 scale-95 opacity-0"
          }`}
        >
          <div className="relative border border-[#1f521f] bg-[#080b08] px-3 py-2.5">
            {/* Tooltip title */}
            <div className="flex items-center gap-2">
              <Bot
                size={12}
                className="text-[#33ff00]"
              />

              <span className="text-[9px] font-bold tracking-[0.12em] text-[#33ff00]">
                NOISEGUARD_AI
              </span>

              <span className="ml-auto text-[7px] text-[#1f9e1f]">
                ONLINE
              </span>
            </div>

            <div className="mt-1.5 text-[9px] leading-5 text-[#9fbd9f]">
              Ask AI for any doubts &amp;
              questions
            </div>

            <div className="mt-1 text-[7px] text-[#1f521f]">
              CLICK TO OPEN ASSISTANT
            </div>

            {/* Terminal pointer */}
            <div className="absolute -bottom-1.5 right-5 h-3 w-3 rotate-45 border-b border-r border-[#1f521f] bg-[#080b08]" />
          </div>
        </div>

        <button
          type="button"
          aria-label={
            open
              ? "Close NoiseGuard AI"
              : "Open NoiseGuard AI"
          }
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          className="group relative flex h-[58px] w-[58px] items-center justify-center rounded-full border border-[#33ff00] bg-[#050805] text-[#33ff00] shadow-[0_0_18px_rgba(51,255,0,0.18)] transition-all duration-200 hover:scale-105 hover:bg-[#071007] hover:shadow-[0_0_28px_rgba(51,255,0,0.35)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#33ff00] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0a]"
        >
          {/* Outer rotating/pulsing ring */}
          <span
            className={`pointer-events-none absolute inset-[-5px] rounded-full border border-dashed border-[#1f521f] transition-all duration-300 ${
              open
                ? "rotate-45 border-[#33ff00] opacity-90"
                : "animate-[spin_12s_linear_infinite] opacity-70 group-hover:border-[#33ff00]"
            }`}
          />

          {/* Inner ring */}
          <span className="pointer-events-none absolute inset-[5px] rounded-full border border-[#1f521f] transition-colors duration-200 group-hover:border-[#33ff00]" />

          {/* Neural-network symbol */}
          <span className="relative flex h-8 w-8 items-center justify-center">
            <BrainCircuit
              size={29}
              strokeWidth={1.45}
              className="relative z-10 text-[#33ff00] transition-transform duration-200 group-hover:scale-110"
            />

            {/* Center AI core */}
            <span className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#33ff00] shadow-[0_0_8px_rgba(51,255,0,0.9)]" />
          </span>

          {/* Live indicator */}
          <span className="absolute right-[2px] top-[2px] h-2.5 w-2.5 rounded-full border border-[#050805] bg-[#33ff00] shadow-[0_0_7px_rgba(51,255,0,0.9)]" />

          {/* Open state icon accent */}
          {open && (
            <span className="absolute inset-0 flex items-center justify-center rounded-full bg-[#33ff00]/5">
              <MessageCircle
                size={10}
                className="absolute bottom-1 right-1 text-[#ffb000]"
              />
            </span>
          )}
        </button>
      </div>
    </>
  );
}
