"use client";

import {
  Bot,
  CheckCircle2,
  CircleAlert,
  Loader2,
  MessageSquare,
  RefreshCw,
  Send,
  Terminal,
  Trash2,
  User,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { FormEvent, KeyboardEvent } from "react";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/+$/, "") ||
  "http://127.0.0.1:8000";

type MessageRole = "user" | "assistant";

interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: string;
}

interface ApiHistoryMessage {
  role: MessageRole;
  content: string;
}

interface ChatResponse {
  answer: string;
  model: string;
  generated_at: string;
  context?: {
    active_sensors?: number;
    active_alerts?: number;
    readings_24h?: number;
  };
}

interface ApiErrorPayload {
  detail?: string | { message?: string };
}

const QUICK_PROMPTS = [
  "Which sensor has the highest current noise?",
  "Are there any active critical alerts?",
  "What are the most important noise issues right now?",
];

const STORAGE_KEY = "noiseguard-ai-chat-v1";

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 9)}`;
}

function getInitialMessage(): ChatMessage {
  return {
    id: "system-welcome",
    role: "assistant",
    content:
      "NoiseGuard AI online. I analyze the data currently supplied by the NoiseGuard backend. Ask me about sensors, noise levels, alerts, readings, anomalies, or recommended actions.",
    createdAt: new Date().toISOString(),
  };
}

function formatClock(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "--:--:--";
  }

  return date.toLocaleTimeString("en-GB", {
    hour12: false,
  });
}

function getErrorMessage(error: unknown) {
  if (error instanceof TypeError) {
    return "Unable to reach the NoiseGuard backend. Check that FastAPI is running on port 8000.";
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "The AI request failed. Please try again.";
}

export default function AIChatPanel() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    getInitialMessage(),
  ]);
  const [historyLoaded, setHistoryLoaded] = useState(false);

  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [backendReady, setBackendReady] = useState<boolean | null>(null);
  const [lastModel, setLastModel] = useState("openai/gpt-5-mini");
  const [lastContext, setLastContext] =
    useState<ChatResponse["context"]>();
  const [error, setError] = useState("");

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const apiHistory = useMemo<ApiHistoryMessage[]>(
    () =>
      messages
        .filter((message) => message.id !== "system-welcome")
        .slice(-12)
        .map((message) => ({
          role: message.role,
          content: message.content,
        })),
    [messages],
  );

  const checkStatus = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/ai/status`, {
        method: "GET",
        cache: "no-store",
      });

      if (!response.ok) {
        setBackendReady(false);
        return;
      }

      const data = (await response.json()) as {
        status?: string;
        model?: string;
      };

      setBackendReady(data.status === "ready");

      if (data.model) {
        setLastModel(data.model);
      }
    } catch {
      setBackendReady(false);
    }
  }, []);

  useEffect(() => {
    void checkStatus();

    const interval = window.setInterval(() => {
      void checkStatus();
    }, 15000);

    return () => {
      window.clearInterval(interval);
    };
  }, [checkStatus]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);

      if (stored) {
        const parsed = JSON.parse(stored);

        if (Array.isArray(parsed)) {
          const validMessages = parsed.filter(
            (item): item is ChatMessage =>
              item &&
              (item.role === "user" ||
                item.role === "assistant") &&
              typeof item.content === "string" &&
              typeof item.id === "string",
          );

          if (validMessages.length > 0) {
            setMessages(validMessages.slice(-40));
          }
        }
      }
    } catch {
      // Chat history persistence is optional.
    } finally {
      setHistoryLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!historyLoaded) {
      return;
    }

    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(messages.slice(-40)),
      );
    } catch {
      // Chat history persistence is optional.
    }
  }, [historyLoaded, messages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end",
    });
  }, [messages, loading]);

  useEffect(() => {
    const textarea = textareaRef.current;

    if (!textarea) {
      return;
    }

    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(
      Math.max(textarea.scrollHeight, 42),
      132,
    )}px`;
  }, [input]);

  const sendMessage = useCallback(
    async (event?: FormEvent) => {
      event?.preventDefault();

      const message = input.trim();

      if (!message || loading) {
        return;
      }

      setError("");
      setInput("");

      const userMessage: ChatMessage = {
        id: makeId("user"),
        role: "user",
        content: message,
        createdAt: new Date().toISOString(),
      };

      setMessages((current) => [...current, userMessage]);
      setLoading(true);

      try {
        const response = await fetch(`${API_BASE}/api/ai/chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message,
            history: apiHistory,
          }),
        });

        let payload:
          | ChatResponse
          | ApiErrorPayload
          | null = null;

        try {
          payload = await response.json();
        } catch {
          payload = null;
        }

        if (!response.ok) {
          const detail =
            payload &&
            "detail" in payload &&
            typeof payload.detail === "string"
              ? payload.detail
              : payload &&
                  "detail" in payload &&
                  payload.detail &&
                  typeof payload.detail === "object"
                ? payload.detail.message
                : undefined;

          throw new Error(
            detail ||
              `AI backend returned HTTP ${response.status}.`,
          );
        }

        const data = payload as ChatResponse;

        if (!data.answer?.trim()) {
          throw new Error(
            "The AI backend returned an empty response.",
          );
        }

        const assistantMessage: ChatMessage = {
          id: makeId("assistant"),
          role: "assistant",
          content: data.answer.trim(),
          createdAt: data.generated_at || new Date().toISOString(),
        };

        setMessages((current) => [
          ...current,
          assistantMessage,
        ]);

        setLastModel(data.model || lastModel);
        setLastContext(data.context);
        setBackendReady(true);
      } catch (requestError) {
        const messageText = getErrorMessage(requestError);

        setError(messageText);
        setBackendReady(false);

        const errorMessage: ChatMessage = {
          id: makeId("assistant-error"),
          role: "assistant",
          content: `[ ERROR ] ${messageText}`,
          createdAt: new Date().toISOString(),
        };

        setMessages((current) => [
          ...current,
          errorMessage,
        ]);
      } finally {
        setLoading(false);

        window.setTimeout(() => {
          textareaRef.current?.focus();
        }, 0);
      }
    },
    [apiHistory, input, lastModel, loading],
  );

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }

    event.preventDefault();
    void sendMessage();
  };

  const clearChat = () => {
    setMessages([getInitialMessage()]);
    setInput("");
    setError("");
    setLastContext(undefined);

    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore storage failures.
    }

    window.setTimeout(() => {
      textareaRef.current?.focus();
    }, 0);
  };

  const useQuickPrompt = (prompt: string) => {
    if (loading) {
      return;
    }

    setInput(prompt);

    window.setTimeout(() => {
      textareaRef.current?.focus();
    }, 0);
  };

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden border border-[#1f521f] bg-[#080b08] text-[#33ff00]">
      {/* Terminal title bar */}
      <div className="shrink-0 border-b border-dashed border-[#1f521f] px-3 py-2">
        <div className="flex items-center gap-2">
          <Terminal
            size={13}
            strokeWidth={1.7}
            className="shrink-0 text-[#33ff00]"
            aria-hidden="true"
          />

          <div className="min-w-0 flex-1">
            <div className="truncate text-[11px] font-bold tracking-[0.12em] text-[#33ff00]">
              NOISEGUARD_AI // COMMAND_ASSISTANT
            </div>

            <div className="mt-0.5 truncate text-[10px] tracking-[0.12em] text-[#1f9e1f]">
              root@noiseguard:~/ai/chat
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5 text-[10px]">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                backendReady
                  ? "bg-[#33ff00] shadow-[0_0_7px_rgba(51,255,0,0.8)]"
                  : backendReady === false
                    ? "bg-[#ff3333]"
                    : "bg-[#ffb000]"
              }`}
            />

            <span
              className={
                backendReady
                  ? "text-[#33ff00]"
                  : backendReady === false
                    ? "text-[#ff3333]"
                    : "text-[#ffb000]"
              }
            >
              {backendReady
                ? "ONLINE"
                : backendReady === false
                  ? "OFFLINE"
                  : "CHECKING"}
            </span>
          </div>
        </div>
      </div>

      {/* Status strip */}
      <div className="shrink-0 border-b border-[#1f521f] bg-[#0a0d0a] px-3 py-1.5">
        <div className="flex items-center gap-2 overflow-x-auto whitespace-nowrap text-[10px] tracking-[0.1em]">
          <span className="text-[#1f9e1f]">MODEL:</span>
          <span className="text-[#33ff00]">
            {lastModel}
          </span>

          <span className="text-[#1f521f]">|</span>

          <span className="text-[#1f9e1f]">DATA:</span>
          <span className="text-[#33ff00]">
            LIVE_BACKEND_CONTEXT
          </span>

          {lastContext && (
            <>
              <span className="text-[#1f521f]">|</span>

              <span className="text-[#1f9e1f]">
                SENSORS:{lastContext.active_sensors ?? "--"}
              </span>

              <span className="text-[#1f9e1f]">
                ALERTS:{lastContext.active_alerts ?? "--"}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <div className="space-y-3">
          {messages.map((message) => {
            const isUser = message.role === "user";
            const isError =
              message.content.startsWith("[ ERROR ]");

            return (
              <div
                key={message.id}
                className={`flex gap-2 ${
                  isUser ? "justify-end" : "justify-start"
                }`}
              >
                {!isUser && (
                  <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center border border-[#1f521f] bg-[#0b100b]">
                    {isError ? (
                      <CircleAlert
                        size={12}
                        className="text-[#ff3333]"
                      />
                    ) : (
                      <Bot
                        size={12}
                        className="text-[#33ff00]"
                      />
                    )}
                  </div>
                )}

                <div
                  className={`max-w-[88%] border px-2.5 py-2 ${
                    isUser
                      ? "border-[#33ff00]/70 bg-[#0d130d]"
                      : isError
                        ? "border-[#ff3333]/60 bg-[#140909]"
                        : "border-[#1f521f] bg-[#0a0d0a]"
                  }`}
                >
                  <div className="mb-1 flex items-center gap-2 text-[10px] tracking-[0.1em]">
                    {isUser ? (
                      <>
                        <User
                          size={9}
                          className="text-[#ffb000]"
                        />
                        <span className="text-[#ffb000]">
                          OPERATOR
                        </span>
                      </>
                    ) : (
                      <>
                        <Bot
                          size={9}
                          className={
                            isError
                              ? "text-[#ff3333]"
                              : "text-[#33ff00]"
                          }
                        />
                        <span
                          className={
                            isError
                              ? "text-[#ff3333]"
                              : "text-[#33ff00]"
                          }
                        >
                          NOISEGUARD_AI
                        </span>
                      </>
                    )}

                    <span className="text-[#1f521f]">
                      {formatClock(message.createdAt)}
                    </span>
                  </div>

                  <div
                    className={`whitespace-pre-wrap break-words text-[11px] leading-6 ${
                      isError
                        ? "text-[#ff7777]"
                        : isUser
                          ? "text-[#d8ffd8]"
                          : "text-[#b9d6b9]"
                    }`}
                  >
                    {message.content}
                  </div>
                </div>

                {isUser && (
                  <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center border border-[#3a2d0c] bg-[#0e0c06]">
                    <User
                      size={12}
                      className="text-[#ffb000]"
                    />
                  </div>
                )}
              </div>
            );
          })}

          {loading && (
            <div className="flex items-start gap-2">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center border border-[#1f521f] bg-[#0b100b]">
                <Bot
                  size={12}
                  className="text-[#33ff00]"
                />
              </div>

              <div className="border border-dashed border-[#1f521f] bg-[#0a0d0a] px-2.5 py-2">
                <div className="flex items-center gap-2 text-[10px] text-[#1f9e1f]">
                  <Loader2
                    size={11}
                    className="animate-spin text-[#33ff00]"
                  />

                  <span>ANALYZING_BACKEND_CONTEXT...</span>
                </div>

                <div className="mt-1 text-[10px] text-[#1f521f]">
                  QUERY → DATABASE_CONTEXT → GPT-5_MINI
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Quick prompts */}
      {!loading && messages.length <= 1 && (
        <div className="shrink-0 border-t border-dashed border-[#1f521f] px-3 py-2">
          <div className="mb-1.5 flex items-center gap-1.5 text-[10px] tracking-[0.1em] text-[#1f9e1f]">
            <MessageSquare size={9} />
            QUICK_QUERIES
          </div>

          <div className="flex gap-1.5 overflow-x-auto pb-0.5">
            {QUICK_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => useQuickPrompt(prompt)}
                className="shrink-0 border border-[#1f521f] bg-transparent px-2 py-1.5 text-left text-[10px] text-[#73a873] transition-colors hover:border-[#33ff00] hover:bg-[#0c120c] hover:text-[#33ff00]"
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Error/status */}
      {error && (
        <div className="shrink-0 border-t border-[#5a1f1f] bg-[#120909] px-3 py-1.5 text-[10px] text-[#ff6666]">
          [ERR] {error}
        </div>
      )}

      {/* Composer */}
      <form
        onSubmit={(event) => void sendMessage(event)}
        className="shrink-0 border-t border-[#1f521f] bg-[#070a07] p-2.5"
      >
        <div className="mb-1.5 flex items-center justify-between text-[10px] tracking-[0.1em]">
          <span className="text-[#1f9e1f]">
            root@noiseguard:~/ai$
          </span>

          <span className="text-[#1f521f]">
            ENTER=SEND // SHIFT+ENTER=NEWLINE
          </span>
        </div>

        <div className="flex items-end gap-2">
          <div className="flex min-w-0 flex-1 items-end border border-[#1f521f] bg-[#050705] focus-within:border-[#33ff00]">
            <span className="self-start px-2 pt-2 text-[10px] text-[#33ff00]">
              &gt;
            </span>

            <textarea
              ref={textareaRef}
              value={input}
              onChange={(event) =>
                setInput(event.target.value)
              }
              onKeyDown={handleKeyDown}
              disabled={loading}
              rows={1}
              maxLength={4000}
              placeholder={
                loading
                  ? "AI PROCESSING..."
                  : "Ask NoiseGuard AI..."
              }
              aria-label="Ask NoiseGuard AI"
              className="min-h-[42px] max-h-[132px] min-w-0 flex-1 resize-none bg-transparent px-1 py-2 text-[11px] leading-6 text-[#d8ffd8] outline-none placeholder:text-[#285c28] disabled:cursor-wait disabled:opacity-60"
            />
          </div>

          <button
            type="submit"
            disabled={!input.trim() || loading}
            aria-label="Send message"
            className="flex h-[42px] w-[42px] shrink-0 items-center justify-center border border-[#33ff00] bg-transparent text-[#33ff00] transition-colors hover:bg-[#33ff00] hover:text-black disabled:cursor-not-allowed disabled:border-[#1f521f] disabled:text-[#285c28] disabled:hover:bg-transparent disabled:hover:text-[#285c28]"
          >
            {loading ? (
              <Loader2
                size={14}
                className="animate-spin"
              />
            ) : (
              <Send size={14} />
            )}
          </button>
        </div>

        <div className="mt-1.5 flex items-center justify-between text-[10px]">
          <span className="text-[#1f521f]">
            {input.length}/4000
          </span>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={clearChat}
              disabled={loading}
              className="flex items-center gap-1 text-[#1f521f] transition-colors hover:text-[#ff3333] disabled:opacity-40"
            >
              <Trash2 size={9} />
              CLEAR
            </button>

            <button
              type="button"
              onClick={() => void checkStatus()}
              className="flex items-center gap-1 text-[#1f521f] transition-colors hover:text-[#33ff00]"
            >
              <RefreshCw size={9} />
              STATUS
            </button>
          </div>
        </div>
      </form>

      {/* Tiny footer */}
      <div className="shrink-0 border-t border-dashed border-[#1f521f] px-3 py-1 text-[7px] tracking-[0.08em] text-[#1f521f]">
        <div className="flex items-center justify-between gap-2">
          <span>NOISEGUARD_AI // OPERATOR_ASSIST</span>
          <span className="flex items-center gap-1">
            <CheckCircle2 size={8} />
            BACKEND_CONTEXT_ONLY
          </span>
        </div>
      </div>
    </section>
  );
}
