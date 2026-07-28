import { Agent } from "@earendil-works/pi-agent-core";
import type { AgentTool, StreamFn } from "@earendil-works/pi-agent-core";
import { createModels, createProvider, envApiKeyAuth } from "@earendil-works/pi-ai";
import type { Model } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";

const PROVIDER_ID = "ollama-cloud";

/**
 * Ollama Cloud is not in Pi's built-in catalog, but it speaks the OpenAI
 * completions API, so it plugs in as an ordinary custom provider. Pi stays a
 * dependency; nothing is forked.
 */
const buildModel = (modelId: string, baseUrl: string): Model<"openai-completions"> => ({
  id: modelId,
  name: modelId,
  api: "openai-completions",
  provider: PROVIDER_ID,
  baseUrl,
  reasoning: true,
  input: ["text"],
  // Ollama Cloud meters GPU time, not tokens, so per-token cost is not meaningful here.
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128_000,
  maxTokens: 8_192,
  // Pi auto-detects these from the base URL, and it guesses wrong for Ollama
  // Cloud: it picks the `developer` role, which Ollama silently drops, so the
  // whole system prompt disappears. Declared explicitly instead of inferred.
  compat: {
    supportsDeveloperRole: false,
    supportsStore: false,
    maxTokensField: "max_tokens",
  },
});

export interface BrainOptions {
  modelId: string;
  baseUrl: string;
  systemPrompt: string;
  tools: AgentTool<any>[];
}

export const createBrain = ({ modelId, baseUrl, systemPrompt, tools }: BrainOptions): Agent => {
  const models = createModels();

  models.setProvider(
    createProvider({
      id: PROVIDER_ID,
      name: "Ollama Cloud",
      baseUrl,
      auth: { apiKey: envApiKeyAuth("Ollama Cloud API key", ["OLLAMA_API_KEY"]) },
      models: [buildModel(modelId, baseUrl)],
      api: openAICompletionsApi(),
    }),
  );

  const model = models.getModel(PROVIDER_ID, modelId);
  if (!model) throw new Error(`Brain model not registered: ${modelId}`);

  const streamFn: StreamFn = (requestModel, context, options) =>
    models.streamSimple(requestModel, context, options);

  return new Agent({
    streamFn,
    initialState: { systemPrompt, model, tools },
    // Steering messages are injected as soon as the current turn ends, which is
    // what makes "send while she is thinking" reach the live run.
    steeringMode: "all",
  });
};
