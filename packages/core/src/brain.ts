import type { Agent, AgentTool } from "@earendil-works/pi-agent-core";
import { createOllamaAgent } from "./ollama.ts";

export interface BrainOptions {
  modelId: string;
  baseUrl: string;
  systemPrompt: string;
  tools: AgentTool<any>[];
}

/**
 * The conversational brain. She converses, decides and orchestrates; she never
 * writes code herself, she delegates it to an arm.
 *
 * Steering messages are injected as soon as the current turn ends, which is
 * what makes "send while she is thinking" reach the live run.
 */
export const createBrain = (options: BrainOptions): Agent =>
  createOllamaAgent({ ...options, steeringMode: "all" });
