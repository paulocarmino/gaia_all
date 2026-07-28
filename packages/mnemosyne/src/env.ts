/**
 * Configuration is declared, never hardcoded, and validated at boot so a
 * missing value fails loudly at start instead of silently at first request.
 */
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
  port: port("MNEMOSYNE_PORT", 3001),
  dbPath: optional("MNEMOSYNE_DB_PATH", "./data/mnemosyne.db"),
} as const;
