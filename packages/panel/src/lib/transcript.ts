import type { StoredImage } from "./api.ts";

export type Entry =
  | {
      kind: "user";
      id: string;
      at: number;
      text: string;
      images: StoredImage[];
      steered: boolean;
      /** Shown immediately on send, still waiting for the stream to echo it. */
      pending?: boolean;
      /**
       * Local data URLs, used until the core answers with real image ids.
       * Without these the preview points at an id the server does not have yet
       * and renders as a broken image for as long as the turn takes.
       */
      previews?: string[];
      /** What her eye reported about the attachments, kept out of the typed text. */
      visionReading?: string;
    }
  | { kind: "gaia"; id: string; at: number; text: string; streaming: boolean }
  | {
      kind: "tool";
      id: string;
      at: number;
      name: string;
      args: Record<string, unknown>;
      status: "running" | "done" | "error";
      durationMs?: number;
      summary?: string;
    }
  | { kind: "note"; id: string; at: number; text: string; tone: "info" | "error" };

/** Only these two matter to a reader; the rest is machinery. */
const TOOL_LABELS: Record<string, string> = {
  remember: "gravando na memória",
  delegate_code: "delegando código",
  look_at_image: "olhando a imagem",
};

export const toolLabel = (name: string): string => TOOL_LABELS[name] ?? name;

/** Mirrors VISION_MARKER in the core: what Paulo typed, then what the eye saw. */
const VISION_MARKER = "⟦vision⟧";

export const splitVision = (full: string): { text: string; reading?: string } => {
  const [text = "", reading] = full.split(VISION_MARKER);
  return reading === undefined ? { text: text.trim() } : { text: text.trim(), reading: reading.trim() };
};

interface AssistantLike {
  role?: string;
  content?: { type: string; text?: string }[];
  timestamp?: number;
}

const textOf = (message: unknown): string => {
  const content = (message as AssistantLike).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("")
    .trim();
};

const roleOf = (message: unknown): string | undefined =>
  typeof message === "object" && message !== null ? (message as AssistantLike).role : undefined;

/**
 * The in-flight reply is not necessarily the last entry: a message steered into
 * the running turn, or a tool call, lands after it. Looking only at the tail
 * made `message_end` create a second entry and duplicate the whole reply.
 */
const findStreamingIndex = (entries: Entry[]): number => {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.kind === "gaia" && entry.streaming) return index;
  }
  return -1;
};

export interface ReduceContext {
  /** True while a run is active, which is what makes an arriving message "steered". */
  running: boolean;
}

/**
 * Folds one agent event into the transcript.
 *
 * The panel does not keep its own idea of what was said: everything visible
 * comes from the same event stream the core emits, so a message steered into a
 * running turn shows up here exactly as the loop saw it.
 */
export const reduceEvent = (
  entries: Entry[],
  type: string,
  data: unknown,
  ctx: ReduceContext,
): { entries: Entry[]; running: boolean } => {
  const event = data as Record<string, any>;
  const now = Date.now();

  switch (type) {
    case "agent_start":
      return { entries, running: true };

    case "agent_end":
      return {
        entries: entries.map((entry) =>
          entry.kind === "gaia" && entry.streaming ? { ...entry, streaming: false } : entry,
        ),
        running: false,
      };

    case "message_start": {
      if (roleOf(event["message"]) !== "user") return { entries, running: ctx.running };
      const full = textOf(event["message"]);
      if (full === "") return { entries, running: ctx.running };
      const { text, reading } = splitVision(full);

      /**
       * The sender already rendered this optimistically. The stream echoing it
       * back is confirmation, not a second message; matching on text keeps the
       * original entry (and its attachments) instead of duplicating it.
       *
       * An attached image makes the text sent to the brain longer than what was
       * typed, so the optimistic text is a prefix rather than an exact match.
       */
      const pendingIndex = entries.findIndex(
        (entry) =>
          entry.kind === "user" &&
          entry.pending === true &&
          (entry.text === text || text.startsWith(entry.text)),
      );
      if (pendingIndex !== -1) {
        const confirmed = entries.map((entry, index) =>
          index === pendingIndex && entry.kind === "user"
            ? { ...entry, pending: false, ...(reading === undefined ? {} : { visionReading: reading }) }
            : entry,
        );
        return { entries: confirmed, running: ctx.running };
      }

      return {
        entries: [
          ...entries,
          {
            kind: "user",
            id: `u-${now}-${entries.length}`,
            at: event["message"]?.timestamp ?? now,
            text,
            images: [],
            // Arriving while a run is active is exactly what steering means.
            steered: ctx.running,
            ...(reading === undefined ? {} : { visionReading: reading }),
          },
        ],
        running: ctx.running,
      };
    }

    case "message_update": {
      if (roleOf(event["message"]) !== "assistant") return { entries, running: ctx.running };
      const text = textOf(event["message"]);
      if (text === "") return { entries, running: ctx.running };

      const index = findStreamingIndex(entries);
      if (index !== -1) {
        return {
          entries: entries.map((entry, at) =>
            at === index && entry.kind === "gaia" ? { ...entry, text } : entry,
          ),
          running: ctx.running,
        };
      }
      return {
        entries: [
          ...entries,
          { kind: "gaia", id: `g-${now}-${entries.length}`, at: now, text, streaming: true },
        ],
        running: ctx.running,
      };
    }

    case "message_end": {
      if (roleOf(event["message"]) !== "assistant") return { entries, running: ctx.running };
      const text = textOf(event["message"]);

      const index = findStreamingIndex(entries);
      if (index !== -1) {
        return {
          entries: entries.map((entry, at) =>
            at === index && entry.kind === "gaia"
              ? { ...entry, text: text || entry.text, streaming: false }
              : entry,
          ),
          running: ctx.running,
        };
      }
      if (text === "") return { entries, running: ctx.running };
      return {
        entries: [
          ...entries,
          { kind: "gaia", id: `g-${now}-${entries.length}`, at: now, text, streaming: false },
        ],
        running: ctx.running,
      };
    }

    case "tool_execution_start":
      return {
        entries: [
          ...entries,
          {
            kind: "tool",
            id: String(event["toolCallId"] ?? `t-${now}`),
            at: now,
            name: String(event["toolName"] ?? "tool"),
            args: (event["args"] ?? {}) as Record<string, unknown>,
            status: "running",
          },
        ],
        running: ctx.running,
      };

    case "tool_execution_end": {
      const id = String(event["toolCallId"] ?? "");
      const isError = event["isError"] === true;
      const details = event["result"]?.details as { durationMs?: number; arm?: string } | undefined;
      return {
        entries: entries.map((entry) =>
          entry.kind === "tool" && entry.id === id
            ? {
                ...entry,
                status: isError ? "error" : "done",
                ...(details?.durationMs === undefined ? {} : { durationMs: details.durationMs }),
                ...(details?.arm === undefined ? {} : { summary: details.arm }),
              }
            : entry,
        ),
        running: ctx.running,
      };
    }

    default:
      return { entries, running: ctx.running };
  }
};
