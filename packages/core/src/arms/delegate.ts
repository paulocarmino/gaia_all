import { stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { routeTask } from "./routing.ts";
import type { Arm, ArmId, ArmResult } from "./types.ts";

export interface DelegateOptions {
  arms: readonly Arm[];
  /** Root holding the repositories the arms may touch. */
  workspaceDir: string;
  /** Concurrent arm invocations allowed. Default 1 (ARCHITECTURE). */
  concurrency: number;
}

/**
 * Bounds how many arms run at once. The Claude subscription sustains roughly
 * one to three concurrent agents and Paulo's work is mostly sequential, so the
 * sane default is 1.
 */
const createSemaphore = (limit: number) => {
  let active = 0;
  const waiting: (() => void)[] = [];

  const release = (): void => {
    active -= 1;
    const next = waiting.shift();
    if (next) next();
  };

  return {
    inUse: (): number => active,
    acquire: async (): Promise<() => void> => {
      if (active >= limit) await new Promise<void>((r) => waiting.push(r));
      active += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        release();
      };
    },
  };
};

/**
 * Resolves a repo name against the workspace.
 *
 * GAIA's own repository is deliberately not reachable: ARCHITECTURE requires a
 * tested rollback path before she is allowed to modify herself, and there is
 * none yet.
 */
const resolveRepo = async (workspaceDir: string, repo: string): Promise<string> => {
  const root = resolve(workspaceDir);
  const target = resolve(root, repo);
  const rel = relative(root, target);

  if (rel === "" || rel.startsWith("..") || rel.startsWith(`${sep}..`)) {
    throw new Error(
      `Repository must be a directory inside the workspace (${root}). Got: ${repo}`,
    );
  }

  const info = await stat(target).catch(() => undefined);
  if (info === undefined || !info.isDirectory()) {
    throw new Error(`No such repository in the workspace: ${repo}`);
  }
  return target;
};

const delegateParams = Type.Object({
  instruction: Type.String({
    description:
      "The coding task, written so someone with no memory of this conversation could act on it. " +
      "Include the goal, the relevant files if known, and how the work should be verified.",
  }),
  repo: Type.String({
    description: "Name of the repository directory inside the workspace to work in.",
  }),
  arm: Type.Optional(
    Type.Union([Type.Literal("claude-code"), Type.Literal("glm")], {
      description:
        "Which arm to use. Omit to use the default. Only set this when Paulo asked for a " +
        "specific arm, or when retrying a failure with the other one.",
    }),
  ),
  resume_from: Type.Optional(
    Type.String({
      description:
        "Session id returned by a previous delegation, to continue that work instead of starting over.",
    }),
  ),
});

const describe = (result: ArmResult): string => {
  const seconds = (result.durationMs / 1000).toFixed(1);
  const head = `[${result.arm}] ${result.ok ? "completed" : "FAILED"} in ${seconds}s`;
  const session =
    result.sessionId !== undefined
      ? `\nsession_id: ${result.sessionId} (pass as resume_from to continue)`
      : "";
  const body = result.ok ? result.summary : `${result.error ?? "Unknown failure"}\n${result.summary}`;
  return `${head}${session}\n\n${body}`.trim();
};

/**
 * The brain's hands. Coding is a tool she reaches for, never something she does
 * inline (VISION, the core idea).
 */
export const createDelegateCodeTool = (
  options: DelegateOptions,
): AgentTool<typeof delegateParams> => {
  const byId = new Map<ArmId, Arm>(options.arms.map((arm) => [arm.id, arm]));
  const semaphore = createSemaphore(Math.max(1, options.concurrency));

  return {
    name: "delegate_code",
    label: "Delegate code",
    description:
      "Delegate a coding task to an arm that can actually read, edit and run code in a repository. " +
      "Use this for anything that changes files: you do not write code yourself. " +
      "Returns what the arm did, plus a session id you can resume for follow-up work.",
    parameters: delegateParams,
    execute: async (_id, params, signal) => {
      const armId = routeTask(params.arm);
      const arm = byId.get(armId);
      if (!arm) {
        throw new Error(`No such arm: ${armId}`);
      }
      if (!(await arm.available())) {
        throw new Error(`Arm ${arm.label} is not available in this environment`);
      }

      const repoPath = await resolveRepo(options.workspaceDir, params.repo);
      const release = await semaphore.acquire();
      try {
        const result = await arm.run(
          {
            instruction: params.instruction,
            repoPath,
            ...(params.resume_from === undefined ? {} : { resumeFrom: params.resume_from }),
          },
          signal,
        );
        return {
          content: [{ type: "text", text: describe(result) }],
          details: result,
        };
      } finally {
        release();
      }
    },
  };
};
