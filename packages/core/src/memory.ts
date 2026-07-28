import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";

export interface RecalledMemory {
  id: number;
  content: string;
  tags: string[];
  createdAt: string;
}

const REQUEST_TIMEOUT_MS = 10_000;

const post = async <T>(baseUrl: string, path: string, body: unknown): Promise<T> => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Mnemosyne ${path} failed: ${response.status} ${detail}`.trim());
  }

  return (await response.json()) as T;
};

/**
 * Client for the memory service. The address arrives as configuration, so the
 * same logic works from the core, a CLI agent, or anywhere else it lands
 * (ARCHITECTURE, Critical portability rule).
 */
export const createMemoryClient = (baseUrl: string) => ({
  remember: async (content: string, tags: readonly string[]): Promise<void> => {
    await post(baseUrl, "/remember", { content, tags });
  },

  recall: async (query: string | undefined, limit: number): Promise<RecalledMemory[]> => {
    const body = query === undefined ? { limit } : { query, limit };
    const { memories } = await post<{ memories: RecalledMemory[] }>(baseUrl, "/recall", body);
    return memories;
  },
});

export type MemoryClient = ReturnType<typeof createMemoryClient>;

const rememberParameters = Type.Object({
  content: Type.String({
    description: "The fact to remember, written as a self-contained sentence.",
  }),
  tags: Type.Optional(
    Type.Array(Type.String(), {
      description: "Short labels for later retrieval, e.g. preference, project, decision.",
    }),
  ),
});

/** Lets GAIA decide, mid-conversation, that something is worth keeping. */
export const createRememberTool = (memory: MemoryClient): AgentTool<typeof rememberParameters> => ({
  name: "remember",
  label: "Remember",
  description:
    "Store a durable fact about Paulo, a decision, or project state so it survives into future conversations. " +
    "Use it for things worth knowing next week, not for chit-chat. Never store credentials, tokens, or passwords.",
  parameters: rememberParameters,
  execute: async (_toolCallId, params) => {
    await memory.remember(params.content, params.tags ?? []);
    return {
      content: [{ type: "text", text: `Remembered: ${params.content}` }],
      details: { content: params.content, tags: params.tags ?? [] },
    };
  },
});

export const formatRecalledMemories = (memories: readonly RecalledMemory[]): string => {
  if (memories.length === 0) return "";

  const lines = memories.map((memory) => {
    const date = memory.createdAt.slice(0, 10);
    const tags = memory.tags.length > 0 ? ` [${memory.tags.join(", ")}]` : "";
    return `- (${date})${tags} ${memory.content}`;
  });

  return `What you already know from previous conversations:\n${lines.join("\n")}`;
};
