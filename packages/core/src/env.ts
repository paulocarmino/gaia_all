/**
 * Configuration is declared, never hardcoded, and validated at boot so a
 * missing value fails loudly at start instead of silently at first request.
 */
const required = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
};

const optional = (name: string, fallback: string): string => {
  const value = process.env[name];
  return value === undefined || value.trim() === "" ? fallback : value.trim();
};

const port = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`Invalid port in ${name}: ${raw}`);
  }
  return parsed;
};

const positive = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer, got: ${raw}`);
  }
  return parsed;
};

export const env = {
  port: port("GAIA_PORT", 3000),
  /** Static bearer token guarding every exposed endpoint. */
  authToken: required("GAIA_AUTH_TOKEN"),
  ollamaApiKey: required("OLLAMA_API_KEY"),
  ollamaBaseUrl: optional("OLLAMA_BASE_URL", "https://ollama.com/v1"),
  /** Swapping the brain is a one-line env change, never a refactor. */
  brainModel: optional("GAIA_BRAIN_MODEL", "glm-5.2"),
  /**
   * Her eye. The brain is text-only, so images are read by a separate model and
   * only the reading enters the transcript. Declared, like every other model.
   */
  visionModel: optional("GAIA_VISION_MODEL", "qwen3.5:397b"),
  /** Single known directory for this service's durable state. */
  dataDir: optional("GAIA_DATA_DIR", "./data"),
  /** Memory's address travels in configuration, never in code. */
  mnemosyneUrl: required("MNEMOSYNE_URL").replace(/\/+$/, ""),

  /** Root holding every repository the arms are allowed to touch. */
  workspaceDir: required("GAIA_WORKSPACE_DIR"),
  /** Secondary arm model. Swapping arms stays a one-line change, like the brain. */
  armModel: optional("GAIA_ARM_MODEL", "glm-5.2"),
  claudeBinary: optional("GAIA_CLAUDE_BINARY", "claude"),
  /**
   * Unattended runs cannot answer a permission prompt, so the arm must be told
   * how to behave when it hits one. A blocked prompt would look like a hang.
   */
  claudePermissionMode: optional("GAIA_CLAUDE_PERMISSION_MODE", "bypassPermissions"),
  armTimeoutMs: positive("GAIA_ARM_TIMEOUT_MS", 900_000),
  armConcurrency: positive("GAIA_ARM_CONCURRENCY", 1),
} as const;
