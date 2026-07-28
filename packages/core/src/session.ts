import type { Agent, AgentEvent } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { formatRecalledMemories, type MemoryClient } from "./memory.ts";

const RECALL_LIMIT = 10;

export type SendMode = "started" | "steered";

export interface SendResult {
  mode: SendMode;
  reply: string;
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
export const createSession = (agent: Agent, memory: MemoryClient, basePrompt: string) => {
  const listeners = new Set<(event: AgentEvent) => void>();

  /**
   * Set synchronously on accept, with no await between the check and
   * `agent.prompt()`, so a second request can never observe an idle agent
   * while a run is being started and lose its message.
   */
  let busy = false;

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

    /** Loads prior memories into the system prompt. Call once, before listening. */
    primeMemory: async (): Promise<number> => {
      const memories = await memory.recall(undefined, RECALL_LIMIT);
      const block = formatRecalledMemories(memories);
      if (block !== "") agent.state.systemPrompt = `${basePrompt}\n\n${block}`;
      return memories.length;
    },

    send: async (text: string): Promise<SendResult> => {
      const message = { role: "user", content: text, timestamp: Date.now() } as const;
      const startIndex = agent.state.messages.length;

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
