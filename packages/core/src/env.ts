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

export const env = {
  port: port("GAIA_PORT", 3000),
  /** Static bearer token guarding every exposed endpoint. */
  authToken: required("GAIA_AUTH_TOKEN"),
  ollamaApiKey: required("OLLAMA_API_KEY"),
  ollamaBaseUrl: optional("OLLAMA_BASE_URL", "https://ollama.com/v1"),
  /** Swapping the brain is a one-line env change, never a refactor. */
  brainModel: optional("GAIA_BRAIN_MODEL", "glm-5.2"),
  /** Memory's address travels in configuration, never in code. */
  mnemosyneUrl: required("MNEMOSYNE_URL").replace(/\/+$/, ""),
} as const;
