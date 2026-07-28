import type { AssistantMessage } from "@earendil-works/pi-ai";
import { createOllamaAgent } from "../ollama.ts";
import type { Arm, ArmResult, ArmTask } from "./types.ts";
import { createWorkspaceTools } from "./workspace-tools.ts";

const ARM_SYSTEM_PROMPT = `You are a coding agent working directly on a real repository.

- Use the tools to inspect and change files and to run commands. Do not describe changes you have not made.
- Before editing, read enough of the repository to match what is already there.
- After editing, run whatever verifies the work (tests, typecheck, build) and react to the result rather than assuming success.
- Do not weaken or delete tests to make them pass.
- When you are finished, reply with a short plain-text summary of what you changed and how you verified it. No preamble.`;

export interface GlmArmOptions {
  modelId: string;
  baseUrl: string;
  timeoutMs: number;
}

const finalText = (messages: readonly unknown[]): string => {
  const assistants = messages.filter(
    (message): message is AssistantMessage =>
      typeof message === "object" &&
      message !== null &&
      (message as AssistantMessage).role === "assistant",
  );
  const last = assistants.at(-1);
  if (!last) return "";
  return last.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
};

/**
 * The cheap arm: a headless Pi session on an Ollama Cloud model with file and
 * shell tools, operating on a checkout of the target repo.
 *
 * ARCHITECTURE is explicit that inference alone is not an arm, so this is a
 * real agent loop, not "generate a diff and hope".
 */
export const createGlmArm = (options: GlmArmOptions): Arm => ({
  id: "glm",
  label: `Ollama Cloud (${options.modelId})`,

  available: async () => process.env["OLLAMA_API_KEY"] !== undefined,

  run: async (task: ArmTask, signal?: AbortSignal): Promise<ArmResult> => {
    const startedAt = Date.now();
    const agent = createOllamaAgent({
      modelId: options.modelId,
      baseUrl: options.baseUrl,
      systemPrompt: ARM_SYSTEM_PROMPT,
      tools: createWorkspaceTools(task.repoPath),
    });

    const timeout = setTimeout(() => agent.abort(), options.timeoutMs);
    const onAbort = () => agent.abort();
    signal?.addEventListener("abort", onAbort, { once: true });

    try {
      await agent.prompt({
        role: "user",
        content: `Repository root: ${task.repoPath}\n\nTask:\n${task.instruction}`,
        timestamp: Date.now(),
      });
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
    }

    const durationMs = Date.now() - startedAt;
    const failure = agent.state.errorMessage;
    const summary = finalText(agent.state.messages);

    if (failure !== undefined) {
      return { arm: "glm", ok: false, summary, durationMs, error: failure };
    }
    if (summary === "") {
      return {
        arm: "glm",
        ok: false,
        summary: "",
        durationMs,
        error: "Arm produced no final summary",
      };
    }
    return { arm: "glm", ok: true, summary, durationMs };
  },
});
