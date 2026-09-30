"use client";

import { useRef, useState } from "react";

interface Msg {
  role: "user" | "assistant";
  content: string;
}

const SUGGESTIONS = [
  "Which properties are uninsured?",
  "What's overdue right now, and who should handle it?",
  "Show EPC D or worse in Hackney with their rent",
  "What gas checks are due in the next 90 days?",
];

export function AssistantChat({ templateId }: { templateId: string }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy) return;
    setInput("");
    const next: Msg[] = [...messages, { role: "user", content: question }];
    setMessages([...next, { role: "assistant", content: "" }]);
    setBusy(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next, templateId }),
      });
      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => "Something went wrong.");
        setMessages((m) => setLast(m, errText || "Something went wrong."));
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setMessages((m) => setLast(m, acc));
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
      }
    } catch {
      setMessages((m) => setLast(m, "Couldn't reach the assistant. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-[calc(100vh-var(--hdr))] flex-col" style={{ ["--hdr" as string]: "150px" }}>
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-5 py-5 md:px-8">
        {messages.length === 0 ? (
          <div className="mx-auto max-w-2xl">
            <p className="text-body text-ink-muted">
              Ask about your portfolio in plain English. Answers come only from your own
              data, and name the records they use. This is read-only — it won&apos;t change
              anything without your say-so.
            </p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="rounded-panel border border-rule bg-surface px-4 py-3 text-left text-table text-ink hover:bg-canvas"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-2xl space-y-4">
            {messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
                <div
                  className={
                    m.role === "user"
                      ? "max-w-[85%] rounded-panel bg-brand px-4 py-2.5 text-body text-white"
                      : "max-w-full rounded-panel border border-rule bg-surface px-4 py-3 text-body text-ink"
                  }
                >
                  {m.content === "" ? (
                    <span className="text-ink-muted">Thinking…</span>
                  ) : (
                    <pre className="whitespace-pre-wrap break-words font-sans">{m.content}</pre>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
        className="border-t border-rule bg-surface px-5 py-3 md:px-8"
      >
        <div className="mx-auto flex max-w-2xl items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            rows={1}
            placeholder="Ask about your portfolio…"
            className="min-h-[44px] flex-1 resize-none rounded-ctl border border-rule bg-surface px-3 py-2.5 text-body text-ink placeholder:text-ink-muted"
            aria-label="Message the assistant"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="min-h-[44px] rounded-ctl bg-brand px-4 py-2 text-table font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}

function setLast(m: Msg[], content: string): Msg[] {
  if (m.length === 0) return m;
  const copy = m.slice();
  copy[copy.length - 1] = { role: "assistant", content };
  return copy;
}
