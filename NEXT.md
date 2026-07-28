# NEXT

State of GAIA at the end of the session of 2026-07-28. Read this before starting the next one.

---

## (a) What was built

Steps 1 and 2 of the suggested build order in ARCHITECTURE.md, translated to a local WSL environment: no k3s, no Docker, no manifests.

### Layout

```
gaiav2/
  .env                      gitignored, the only place secrets live
  .env.example              documented template
  pnpm-workspace.yaml       plain pnpm workspaces, no Turborepo
  tsconfig.base.json        strict + erasableSyntaxOnly
  packages/
    core/                   the brain and her front door (port 3000)
      src/env.ts            config parsed and validated at boot
      src/auth.ts           static bearer token, constant-time compare
      src/brain.ts          Ollama Cloud as a custom pi provider + Agent
      src/persona.ts        system prompt
      src/memory.ts         Mnemosyne client + the remember tool
      src/session.ts        the single live conversation, steering, recall
      src/server.ts         routes
    mnemosyne/              memory as a separate service (port 3001)
      src/schema.ts         Drizzle: memories(id, content, tags, created_at)
      src/db.ts             better-sqlite3 + migrate-on-boot
      src/memories.ts       remember / recall
      src/server.ts         routes
      drizzle/              generated migration
```

### Running it

```bash
pnpm start:mnemosyne     # first: the core recalls from it at boot
pnpm start:core
```

### HTTP surface

Core, all bearer-protected except `/health`:

- `GET  /health` — liveness, current model, busy flag. No token, no secrets.
- `POST /chat {message}` — starts a run, or steers into the live one. Returns
  `{mode: "started"|"steered", reply}`. Blocks until the run settles so plain
  curl works as a chat client.
- `GET  /stream` — SSE of every agent event. This is the transport shape the
  panel should reuse.

Mnemosyne, no auth (loopback only, mirrors "Service with no Ingress"):

- `GET  /health`
- `POST /remember {content, tags?}`
- `POST /recall {query?, limit?}` → `{memories: [...]}`

### Verified, not assumed

- **Bearer token**: no token, wrong token, and `/stream` without a token all return 401.
- **Brain**: GLM-5.2 on Ollama Cloud answers in ~1s, matching the language of the message.
- **remember tool**: called unprompted, tagged sensibly, row lands in SQLite.
- **Steering** (the hard requirement): with a run in flight (`busy: true`), a second
  `POST /chat` returned `mode: "steered"`, and the SSE log shows the interrupting
  user message injected as `message_start` *inside* the run — one `agent_start`,
  one `agent_end`, the new message between two turn boundaries. GAIA acknowledged
  it mid-work and changed what she recorded.
- **Done criterion**: chatted, killed the process (confirmed connection refused),
  restarted, and she answered editor / distro / focus hours / how I take my coffee
  from what she had noted in the previous conversation.

### Deviations from the documents, and why

1. **Conversation transcript is not persisted.** ARCHITECTURE (Persistence) puts
   session state in SQLite. Only Mnemosyne is persisted here. The session's scope
   listed memory but not transcript persistence, and the done criterion is about
   recall surviving a restart, which it does. A restart therefore begins a fresh
   conversation that *remembers*. Closing this is a small piece of work: a second
   SQLite store in the core, or Pi's own `jsonl-repo` / `sqlite` session storage.

2. **Recall runs at boot, not on the first message.** ARCHITECTURE says recall
   happens at conversation start; here the process start *is* the conversation
   start. Doing it lazily on the first message was written first and then removed:
   it opened a window where a second message arriving during the recall HTTP call
   would be steered into an agent that had not started yet, and silently dropped.
   The cost is that recall is recency-based rather than ranked against the first
   message. The query-ranked path exists in Mnemosyne and is unused by the core.

3. **Retrieval is keyword overlap plus recency, not similarity search.**
   Explicitly permitted by ARCHITECTURE ("even plain full-text search to start").
   No FTS5, no embeddings, no vector extension. Upgrade when quality hurts.

4. **`@earendil-works/pi-*`, not `@mariozechner/pi-*`.** The scope named in
   ARCHITECTURE is deprecated on npm, pointing at this one. Same maintainers.
   Pinned to exact `0.82.1`, per the "pin explicitly, upgrade deliberately" rule.

5. **Infra translated to local**, as instructed: Secrets → `.env`; Deployment →
   `pnpm start`; CronJobs → out of scope; Ingress → out of scope, but the bearer
   middleware is in from day one.

### One trap worth remembering

Pi auto-detects OpenAI-compat quirks from the base URL. For Ollama Cloud it
guessed the `developer` role for the system prompt, and Ollama **drops that role
silently** — no error, no warning. GAIA ran with no system prompt at all: no
persona, no recalled memories. It looked like a dumb model, not a bug. The model
in `brain.ts` now declares its `compat` flags explicitly. Suspect this first if
any new model starts ignoring its instructions.

---

## (b) Known loose ends

- **No transcript persistence.** See deviation 1. Restart = new conversation.
- **No tests, no linter.** Nothing was set up. Everything above was verified by
  hand with curl.
- **Steering is turn-granular, not token-granular.** A steered message lands at
  the next turn boundary. In the validation run GLM-5.2 had batched all five tool
  calls into one turn, so the interruption arrived after they had all executed.
  She reported this honestly. Real interruption of in-flight work is `agent.abort()`,
  which is not wired to any endpoint.
- **Memory has no forget/update operation.** Only remember and recall. The
  validation run left two contradictory rows about football in the store
  (`Palmeiras` vs `does not care about football`) and GAIA correctly pointed out
  she had no way to remove either. Real test data in a real store: purge it by
  hand if it bothers you.
- **Test rows in the memory store.** Ids 1-2 were seeded by me while testing
  Mnemosyne standalone; the rest came from real conversation. Nothing was deleted
  without asking.
- **`GAIA_AUTH_TOKEN` was generated by me** with `openssl rand -hex 32` and is in
  `.env`. Rotate it if you want one you chose.
- **No backups.** ARCHITECTURE calls this the single load-bearing operational
  requirement, and it is step 3 of the build order, before GAIA is allowed to
  touch anything that matters. The next session builds delegate-code, which is
  exactly "things that matter". Consider doing backups first, or accept that the
  arms initially run against throwaway targets.
- **No rollback path exists or has been exercised.** ARCHITECTURE requires one to
  be tested before GAIA is allowed to modify herself.
- **Mnemosyne is unauthenticated**, correct for loopback and mirroring "no
  Ingress", but it must not be bound to a public interface as-is. Both services
  bind `127.0.0.1` explicitly.
- **Context window is hardcoded at 128k** in `brain.ts`, a guess, not a measured
  value for GLM-5.2. No compaction is wired up, so a long conversation will
  eventually overflow. Pi ships compaction helpers.
- **Ollama Cloud requires a paid plan** for the good models. The free key returns
  403 `this model requires a subscription` for glm-5.2, glm-5.1, qwen3.5:397b,
  deepseek-v4-*, kimi-*. Only gpt-oss:20b/120b are open. Paulo's subscription is
  now active. If a 403 appears again, check billing before debugging code.

---

## (c) Prompt for the next session

> Read docs/VISION.md, docs/ARCHITECTURE.md and docs/CONVENTIONS.md in full, then
> NEXT.md at the repo root, before writing any code. Everything marked [Decided]
> is closed: do not reopen, re-ask, or "improve" it. If you hit a situation the
> documents do not cover, stop and ask me instead of inventing.
>
> Session context: still local (WSL), no k3s. Same translations as last session:
> secrets in the repo-root `.env`, services run as Node processes via pnpm, no
> Kubernetes, no Docker, no CronJobs. Start Mnemosyne before the core.
>
> Scope of this session, and nothing beyond it: **the delegate-code tool with both
> arms and the v0 routing rule** (ARCHITECTURE, "Inference: one brain, two kinds
> of arm").
>
> 1. A `delegate_code` tool on the brain, so coding is something she reaches for
>    and never something she does inline. Her persona already tells her the tool
>    does not exist yet; update it.
> 2. **The Chinese arm**, which ARCHITECTURE is emphatic about: it is a headless
>    Pi session running `qwen3-coder:480b` with a real file and shell toolset
>    (read, edit, run) against a checkout of the target repo. It is not "ask a
>    model for a diff and hope". If the harness turns out to be too much for this
>    session, say so out loud and route everything to the Claude Code arm until it
>    exists, rather than shipping a degraded version quietly. Note that
>    `qwen3-coder:480b` was NOT in the Ollama Cloud catalog on 2026-07-28: list
>    `GET https://ollama.com/v1/models` with the key first and, if it is gone,
>    stop and ask me which coding model to use instead of silently substituting.
> 3. **The Claude Code arm**: `claude -p "task" --output-format json`, subprocess,
>    `--resume <session_id>` for multi-step work. Per-invocation timeout, structured
>    handling of JSON parse failures, and a configurable concurrency cap defaulting
>    to 1. A hung or garbled subprocess must surface as a failed task, never as a
>    frozen brain.
> 4. **Routing v0, kept trivial to adjust**: Chinese arm by default; Claude Code
>    when (a) I explicitly ask, (b) the task modifies GAIA's own core repo, or
>    (c) it is a retry after a Chinese-arm failure. No automatic escalation:
>    manual escalation must be one frictionless step.
> 5. Steering must keep working while an arm is running. A delegated build can take
>    minutes, which is exactly when I will want to send a correction. Validate this
>    against a real delegation, do not assume it.
>
> Out of scope: web panel, k8s manifests, backups, Docker, Postgres, memory
> consolidation.
>
> Read the loose ends in NEXT.md before you start. Two matter for this session:
> there is still no backup and no tested rollback path, and ARCHITECTURE wants both
> before GAIA touches anything I care about. Tell me your read on that risk before
> building, and let me decide. Also worth knowing: steering is turn-granular, and
> `agent.abort()` is not wired to any endpoint.
>
> Session done criterion: from curl, I ask GAIA to make a concrete code change in a
> scratch repo. She routes it to the Chinese arm, the arm actually edits files on
> disk, and she reports back what changed. Then I ask her to redo it with the strong
> arm, and it routes to Claude Code. I can send a message mid-build and she takes it
> into account.
>
> When the done criterion passes, do not start the next phase. Rewrite NEXT.md with
> the same three sections, where the prompt in (c) covers the first self-construction
> mission: the panel, preserving mid-run steering in its transport
> (ARCHITECTURE, build order step 5). Then stop.
