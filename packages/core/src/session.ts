import type { Agent, AgentEvent } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { formatRecalledMemories, type MemoryClient } from "./memory.ts";
import type { StoredImage, Vision } from "./vision.ts";

const RECALL_LIMIT = 10;

/**
 * Separates what Paulo typed from what the eye reported, inside the single
 * message the brain receives. The brain needs them together; a client needs to
 * tell them apart, or the plumbing shows up as if Paulo had typed it.
 */
export const VISION_MARKER = "⟦vision⟧";

export type SendMode = "started" | "steered";

export interface SendResult {
  mode: SendMode;
  reply: string;
}

export interface TranscriptEntry {
  kind: "user" | "gaia";
  text: string;
  at: number;
  /** What the eye reported, when the message carried images. */
  visionReading?: string;
  /** Images that arrived with this message, so a reload can render them. */
  images?: StoredImage[];
}

const isAssistant = (message: unknown): message is AssistantMessage =>
  typeof message === "object" &&
  message !== null &&
  (message as AssistantMessage).role === "assistant";

const assistantTextFrom = (messages: readonly unknown[]): string =>
  messages
    .filter(isAssistant)
    .flatMap((message) =>
      message.content.filter((part) => part.type === "text").map((part) => part.text),
    )
    .join("\n")
    .trim();

/**
 * The single live conversation. One user, one brain, one transcript.
 *
 * Two things matter here. Recall runs once, before the server accepts traffic,
 * so the conversation opens with what GAIA already knows (ARCHITECTURE,
 * Memory). And a message arriving mid-run is steered into the running loop
 * rather than queued behind it (ARCHITECTURE, mid-run steering is a hard
 * requirement).
 */
/**
 * Turns attached images into something the brain can actually receive.
 *
 * The eye is asked Paulo's own question rather than "describe this", so the
 * reading is about what he wants to know instead of a generic caption.
 */
const readImages = async (
  vision: Vision,
  images: readonly StoredImage[],
  question: string,
): Promise<string> => {
  const plural = images.length > 1 ? `${images.length} images` : "an image";
  try {
    const reading = await vision.ask(images, question);
    const ids = images.map((image) => `${image.id} (${image.mediaType})`).join(", ");
    return [
      VISION_MARKER,
      `[Paulo attached ${plural}. You cannot see them directly; this is what your eye reports.`,
      `Image ids, for look_at_image if you need more detail: ${ids}]`,
      "",
      reading,
    ].join("\n");
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown failure";
    return [
      VISION_MARKER,
      `[Paulo attached ${plural}, but your eye failed to read them: ${detail}. Say so; do not guess what was in them.]`,
    ].join("\n");
  }
};

export const createSession = (
  agent: Agent,
  memory: MemoryClient,
  basePrompt: string,
  vision: Vision,
) => {
  const listeners = new Set<(event: AgentEvent) => void>();

  /**
   * Set synchronously on accept, with no await between the check and
   * `agent.prompt()`, so a second request can never observe an idle agent
   * while a run is being started and lose its message.
   */
  let busy = false;

  /**
   * Which images arrived with which message, keyed by position in the
   * transcript. Pi stores only the text the brain sees, so without this a
   * reloaded page shows the eye's reading but not the picture it read.
   */
  const attachments = new Map<number, StoredImage[]>();

  agent.subscribe((event) => {
    for (const listener of listeners) listener(event);
  });

  return {
    subscribe: (listener: (event: AgentEvent) => void): (() => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    isBusy: (): boolean => busy,

    /**
     * The conversation so far, flattened for a client.
     *
     * The panel is a window onto a conversation that lives in this process, not
     * the owner of it. Reloading the page must not lose the thread, so it reads
     * the transcript rather than keeping its own copy.
     */
    transcript: (): TranscriptEntry[] =>
      agent.state.messages.flatMap((message, index): TranscriptEntry[] => {
        if (typeof message !== "object" || message === null) return [];
        const role = (message as { role?: string }).role;
        const at = (message as { timestamp?: number }).timestamp ?? 0;

        if (role === "user") {
          const raw = (message as { content: unknown }).content;
          const full =
            typeof raw === "string"
              ? raw
              : (raw as { type: string; text?: string }[])
                  .filter((part) => part.type === "text")
                  .map((part) => part.text ?? "")
                  .join("\n");
          const [text = "", reading] = full.split(VISION_MARKER);
          const images = attachments.get(index);
          return [
            {
              kind: "user",
              text: text.trim(),
              at,
              ...(reading === undefined ? {} : { visionReading: reading.trim() }),
              ...(images === undefined ? {} : { images }),
            },
          ];
        }

        if (role === "assistant") {
          const text = assistantTextFrom([message]);
          return text === "" ? [] : [{ kind: "gaia", text, at }];
        }

        return [];
      }),

    /** Loads prior memories into the system prompt. Call once, before listening. */
    primeMemory: async (): Promise<number> => {
      const memories = await memory.recall(undefined, RECALL_LIMIT);
      const block = formatRecalledMemories(memories);
      if (block !== "") agent.state.systemPrompt = `${basePrompt}\n\n${block}`;
      return memories.length;
    },

    send: async (text: string, images: readonly StoredImage[] = []): Promise<SendResult> => {
      // The eye runs before the agent is marked busy, so a message arriving
      // during the reading is never steered into a run that has not started.
      const content =
        images.length === 0 ? text : `${text}\n\n${await readImages(vision, images, text)}`;

      const message = { role: "user", content, timestamp: Date.now() } as const;
      const startIndex = agent.state.messages.length;
      if (images.length > 0) attachments.set(startIndex, [...images]);

      if (busy) {
        agent.steer(message);
        await agent.waitForIdle();
        return {
          mode: "steered",
          reply: assistantTextFrom(agent.state.messages.slice(startIndex)),
        };
      }

      busy = true;
      try {
        await agent.prompt(message);
      } finally {
        busy = false;
      }

      const reply = assistantTextFrom(agent.state.messages.slice(startIndex));
      const failure = agent.state.errorMessage;
      if (reply === "" && failure !== undefined) throw new Error(failure);

      return { mode: "started", reply };
    },
  };
};

export type Session = ReturnType<typeof createSession>;
