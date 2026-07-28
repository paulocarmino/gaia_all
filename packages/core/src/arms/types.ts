/** Which arm ran, or should run. */
export type ArmId = "claude-code" | "glm";

export interface ArmTask {
  /** What to build, in Paulo's or GAIA's words. */
  instruction: string;
  /** Absolute path to the repo the arm operates on. */
  repoPath: string;
  /** Continue a previous delegation instead of starting fresh. */
  resumeFrom?: string;
}

export interface ArmResult {
  arm: ArmId;
  ok: boolean;
  /** What the arm reported back, for the brain to relay. */
  summary: string;
  /** Handle for continuing this piece of work, when the arm supports it. */
  sessionId?: string;
  durationMs: number;
  /** Present when ok is false. A failed arm must be legible, never silent. */
  error?: string;
}

export interface Arm {
  readonly id: ArmId;
  readonly label: string;
  /** Whether the arm can run at all right now (CLI installed, key present). */
  available: () => Promise<boolean>;
  run: (task: ArmTask, signal?: AbortSignal) => Promise<ArmResult>;
}
