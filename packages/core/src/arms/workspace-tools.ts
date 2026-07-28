import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";

const MAX_READ_CHARS = 30_000;
const MAX_SHELL_OUTPUT = 8_000;
const SHELL_TIMEOUT_MS = 120_000;

/**
 * Keeps an arm inside the repo it was given. Not a security sandbox (the
 * security posture is deliberately pruned, see VISION), just the difference
 * between "edited the wrong file" and "edited the wrong file somewhere else
 * entirely".
 */
const resolveInside = (repoPath: string, candidate: string): string => {
  const root = resolve(repoPath);
  const target = resolve(root, candidate);
  const rel = relative(root, target);
  if (rel.startsWith("..") || rel.startsWith(`${sep}..`)) {
    throw new Error(`Path escapes the repository: ${candidate}`);
  }
  return target;
};

const text = (value: string) => ({
  content: [{ type: "text" as const, text: value }],
  details: {},
});

const readParams = Type.Object({
  path: Type.String({ description: "Path relative to the repository root." }),
});

const writeParams = Type.Object({
  path: Type.String({ description: "Path relative to the repository root." }),
  content: Type.String({ description: "Full new contents of the file." }),
});

const listParams = Type.Object({
  path: Type.Optional(Type.String({ description: "Directory relative to the root. Defaults to the root." })),
});

const runParams = Type.Object({
  command: Type.String({ description: "Shell command, run from the repository root." }),
});

/** The minimum toolset that turns inference into an arm: read, edit, list, run. */
export const createWorkspaceTools = (repoPath: string): AgentTool<any>[] => {
  const readFileTool: AgentTool<typeof readParams> = {
    name: "read_file",
    label: "Read file",
    description: "Read a file from the repository.",
    parameters: readParams,
    execute: async (_id, params) => {
      const body = await readFile(resolveInside(repoPath, params.path), "utf8");
      return text(
        body.length > MAX_READ_CHARS
          ? `${body.slice(0, MAX_READ_CHARS)}\n... [truncated at ${MAX_READ_CHARS} chars]`
          : body,
      );
    },
  };

  const writeFileTool: AgentTool<typeof writeParams> = {
    name: "write_file",
    label: "Write file",
    description: "Write the full contents of a file, creating it if needed. Overwrites.",
    parameters: writeParams,
    execute: async (_id, params) => {
      const target = resolveInside(repoPath, params.path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, params.content, "utf8");
      return text(`Wrote ${params.path} (${params.content.length} chars)`);
    },
  };

  const listFilesTool: AgentTool<typeof listParams> = {
    name: "list_files",
    label: "List files",
    description: "List the entries of a directory in the repository.",
    parameters: listParams,
    execute: async (_id, params) => {
      const dir = resolveInside(repoPath, params.path ?? ".");
      const entries = await readdir(dir, { withFileTypes: true });
      const lines = entries
        .filter((entry) => entry.name !== "node_modules" && entry.name !== ".git")
        .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name));
      return text(lines.join("\n") || "(empty)");
    },
  };

  const runTool: AgentTool<typeof runParams> = {
    name: "run",
    label: "Run command",
    description:
      "Run a shell command from the repository root, for example a test suite or a build. " +
      "Returns the exit code with stdout and stderr.",
    parameters: runParams,
    execute: async (_id, params) =>
      new Promise((resolvePromise) => {
        execFile(
          "bash",
          ["-lc", params.command],
          { cwd: repoPath, timeout: SHELL_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 },
          (error, stdout, stderr) => {
            const code =
              error !== null && typeof error === "object" && "code" in error
                ? (error as { code?: number }).code
                : 0;
            const clip = (value: string) =>
              value.length > MAX_SHELL_OUTPUT
                ? `${value.slice(0, MAX_SHELL_OUTPUT)}\n... [truncated]`
                : value;
            resolvePromise(
              text(
                `exit=${code ?? 0}\n--- stdout ---\n${clip(stdout)}\n--- stderr ---\n${clip(stderr)}`,
              ),
            );
          },
        );
      }),
  };

  return [readFileTool, writeFileTool, listFilesTool, runTool];
};
