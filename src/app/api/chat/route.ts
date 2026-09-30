import Anthropic from "@anthropic-ai/sdk";
import { getWorkspaceData } from "@/lib/data/store";
import { templates } from "@/lib/data/templates";
import { getToday } from "@/lib/domain/clock";
import { ask } from "@/lib/domain/ask";
import {
  ASSISTANT_SYSTEM_INSTRUCTIONS,
  buildAssistantContext,
} from "@/lib/domain/context";

export const runtime = "nodejs";
export const maxDuration = 60;

// Default to the current Opus. Override with CASTELLAN_CHAT_MODEL if desired.
const MODEL = process.env.CASTELLAN_CHAT_MODEL || "claude-opus-5-5";

type ChatMessage = { role: "user" | "assistant"; content: string };

function streamText(text: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/** Deterministic, grounded answer used when no API key is configured. */
function groundedFallback(templateId: string, question: string): string {
  const data = getWorkspaceData(templateId);
  const today = getToday();
  const r = ask(data, question, today);
  const lines: string[] = [r.answer];
  if (r.note) lines.push("", r.note);
  if (r.rows.length) {
    lines.push("", r.columns.join(" · "));
    for (const row of r.rows.slice(0, 25)) lines.push("- " + row.cells.join(" · "));
  }
  lines.push("", r.citationLabel);
  lines.push(
    "",
    "(Grounded answer from your data. Add an ANTHROPIC_API_KEY to enable the full conversational assistant.)",
  );
  return lines.join("\n");
}

export async function POST(req: Request) {
  let body: { messages?: ChatMessage[]; templateId?: string };
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid request body.", { status: 400 });
  }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  const templateId =
    typeof body.templateId === "string" && templates.some((t) => t.id === body.templateId)
      ? body.templateId
      : "uk-landlord";

  const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  if (!lastUser.trim()) return new Response("Ask a question.", { status: 400 });

  // No key configured → deterministic grounded answer so the live site still works.
  if (!process.env.ANTHROPIC_API_KEY) {
    return streamText(groundedFallback(templateId, lastUser));
  }

  const data = getWorkspaceData(templateId);
  const today = getToday();
  const context = buildAssistantContext(data, today);
  const system = [
    { type: "text" as const, text: ASSISTANT_SYSTEM_INSTRUCTIONS },
    {
      type: "text" as const,
      text: `DATA SNAPSHOT (the user's own portfolio — answer only from this):\n\n${context}`,
      cache_control: { type: "ephemeral" as const },
    },
  ];

  const client = new Anthropic();
  const encoder = new TextEncoder();

  try {
    const anthropicStream = client.messages.stream({
      model: MODEL,
      max_tokens: 2048,
      thinking: { type: "adaptive" },
      system,
      messages: messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role, content: m.content })),
    });

    const stream = new ReadableStream({
      async start(controller) {
        try {
          anthropicStream.on("text", (t) => controller.enqueue(encoder.encode(t)));
          await anthropicStream.finalMessage();
          controller.close();
        } catch (err) {
          const msg =
            err instanceof Anthropic.AuthenticationError
              ? "The configured ANTHROPIC_API_KEY was rejected. Check it in the deployment settings."
              : "The assistant hit an error reaching Claude. Please try again.";
          controller.enqueue(encoder.encode("\n\n" + msg));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  } catch {
    // Fall back to a grounded answer rather than failing the request.
    return streamText(groundedFallback(templateId, lastUser));
  }
}
