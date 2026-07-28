import { execFile } from "node:child_process";
import { access, constants } from "node:fs/promises";
import type { Arm, ArmResult, ArmTask } from "./types.ts";

/** Shape of `claude -p --output-format json`. Only the fields we rely on. */
interface ClaudeCodeEnvelope {
  is_error?: boolean;
  subtype?: string;
  result?: string;
  session_id?: string;
  total_cost_usd?: number;
  num_turns?: number;
}

const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

export interface ClaudeCodeArmOptions {
  /** Path to the CLI. */
  binary: string;
  timeoutMs: number;
  /** Permission mode passed through to the CLI for unattended runs. */
  permissionMode: string;
}

const runCli = (
  options: ClaudeCodeArmOptions,
  args: readonly string[],
  cwd: string,
  signal: AbortSignal | undefined,
): Promise<{ stdout: string; stderr: string; code: number | null; timedOut: boolean }> =>
  new Promise((resolve) => {
    const child = execFile(
      options.binary,
      args,
      { cwd, timeout: options.timeoutMs, maxBuffer: MAX_OUTPUT_BYTES, signal },
      (error, stdout, stderr) => {
        const killed =
          error !== null &&
          typeof error === "object" &&
          "killed" in error &&
          (error as { killed?: boolean }).killed === true;
        resolve({
          stdout,
          stderr,
          code: child.exitCode,
          // A hung subprocess must surface as a failed task, never as a frozen brain.
          timedOut: killed,
        });
      },
    );
  });

/**
 * The strong arm: Claude Code driven headlessly as a subprocess.
 *
 * Every invocation is bounded by a timeout, and a garbled or non-JSON response
 * is reported as a failed task rather than being parsed optimistically.
 */
export const createClaudeCodeArm = (options: ClaudeCodeArmOptions): Arm => ({
  id: "claude-code",
  label: "Claude Code",

  available: async () => {
    // A bare name has to be looked up on PATH; a path can be checked directly.
    if (!options.binary.includes("/")) {
      return new Promise<boolean>((resolvePromise) => {
        execFile("bash", ["-lc", `command -v ${options.binary}`], (error) => {
          resolvePromise(error === null);
        });
      });
    }
    try {
      await access(options.binary, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  },

  run: async (task: ArmTask, signal?: AbortSignal): Promise<ArmResult> => {
    const startedAt = Date.now();
    const args = [
      "-p",
      task.instruction,
      "--output-format",
      "json",
      "--permission-mode",
      options.permissionMode,
    ];
    if (task.resumeFrom !== undefined) args.push("--resume", task.resumeFrom);

    const { stdout, stderr, code, timedOut } = await runCli(options, args, task.repoPath, signal);
    const durationMs = Date.now() - startedAt;

    if (timedOut) {
      return {
        arm: "claude-code",
        ok: false,
        summary: "",
        durationMs,
        error: `Timed out after ${options.timeoutMs}ms`,
      };
    }

    let envelope: ClaudeCodeEnvelope;
    try {
      envelope = JSON.parse(stdout) as ClaudeCodeEnvelope;
    } catch {
      const detail = (stderr.trim() || stdout.trim()).slice(0, 500);
      return {
        arm: "claude-code",
        ok: false,
        summary: "",
        durationMs,
        error: `Could not parse CLI output as JSON (exit ${code ?? "unknown"}): ${detail}`,
      };
    }

    const failed = envelope.is_error === true || (code !== 0 && code !== null);
    const result: ArmResult = {
      arm: "claude-code",
      ok: !failed,
      summary: envelope.result ?? "",
      durationMs,
    };
    if (envelope.session_id !== undefined) result.sessionId = envelope.session_id;
    if (failed) {
      result.error = envelope.result ?? envelope.subtype ?? `Exited with code ${code ?? "unknown"}`;
    }
    return result;
  },
});
