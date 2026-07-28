# NEXT

State of GAIA at the end of the session of 2026-07-28. Read this before starting the next one.

---

## (a) What was built

Steps 1, 2 and 4 of the build order in ARCHITECTURE.md, running locally on WSL:
no k3s, no Docker, no manifests. Step 3 (backups) was deliberately deferred, see
below.

### Layout

```
gaiav2/
  .env                      gitignored, the only place secrets live
  .env.example              documented template
  packages/
    core/                   the brain and her front door (port 3000)
      src/env.ts            config parsed and validated at boot
      src/auth.ts           static bearer token, constant-time compare
      src/ollama.ts         Ollama Cloud as a custom pi provider, shared by brain and arm
      src/brain.ts          the conversational agent
      src/persona.ts        system prompt
      src/memory.ts         Mnemosyne client + the remember tool
      src/session.ts        the single live conversation, steering, recall
      src/server.ts         routes
      src/arms/
        types.ts            the Arm interface
        claude-code.ts      primary arm: the CLI as a subprocess
        glm.ts              secondary arm: headless Pi with file and shell tools
        workspace-tools.ts  read, write, list, run, scoped to the target repo
        routing.ts          the v0 routing rule, one line
        delegate.ts         the delegate_code tool + concurrency cap
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

- `GET  /health` — liveness, current model, busy flag.
- `POST /chat {message}` — starts a run, or steers into the live one. Returns
  `{mode: "started"|"steered", reply}`.
- `GET  /stream` — SSE of every agent event. The transport shape the panel should reuse.

Mnemosyne, no auth (loopback only, mirrors "Service with no Ingress"):
`GET /health`, `POST /remember`, `POST /recall`.

### Verified, not assumed

Everything below was exercised by hand against the running services.

- **Front door**: no token, wrong token, and `/stream` without a token all 401.
- **Brain**: GLM-5.2 answers in ~1s, matching the language of the message.
- **Memory**: `remember` called unprompted; recall survives a process restart.
- **Steering**: with a run in flight, a second `POST /chat` returns `mode: "steered"`
  and the SSE log shows the message injected *inside* the run — one `agent_start`,
  one `agent_end`.
- **Delegation, default route**: the tool args captured from `tool_execution_start`
  show `arm` omitted, so the default (Claude Code) was selected. The arm edited
  `src/slugify.ts`, ran the tests itself, and 4/4 passed on an independent re-run.
  The test file was byte-identical afterwards: it fixed the code, not the tests.
- **Delegation, explicit route**: asking for the cheap arm by name routed to glm,
  which reached the same correct fix in ~20s against ~74s.
- **Steering during a delegation**: a correction sent 25s into a multi-step build
  reached the live run, and GAIA resumed the *same arm session*
  (`resume_from: 65555e95-...`) to apply it rather than starting over.
- **Honest reporting**: on the first attempt the arm could not run commands
  (wrong permission mode). GAIA said so plainly instead of claiming success. Worth
  keeping: that behaviour is a persona rule, and it is the thing that makes her
  reports trustworthy.

### Decisions revised this session

Both were Paulo's calls, recorded as dated revisions in ARCHITECTURE.md rather
than silent edits. The document now explains the `[Revised YYYY-MM-DD]` marker.

1. **Backups are no longer a prerequisite.** v0 has not settled enough to know
   what is worth backing up or where it goes, and Oracle Object Storage was never
   more than a candidate. In exchange, a standing constraint: durable state lives
   in one known directory per service, so adopting backups later stays a small job.
   The risk statement in VISION is untouched and still true.
2. **Routing v0 is inverted.** Claude Code is the primary arm; the cheap arm runs
   on explicit request. While GAIA is being built, landing the change matters more
   than what it costs.

Also forced by reality rather than chosen: **qwen3-coder:480b no longer exists**
in the Ollama Cloud catalog. The replacement is glm-5.2, picked on a measured
bench (read unfamiliar code, find a real bug, edit, run tests, react): glm-5.2 and
qwen3.5:397b both fixed it 3/3 with zero malformed tool calls and no test
tampering, but glm-5.2 took 5.0 turns / 5.9s against 7.3 turns / 20.5s. That pool
is metered by GPU time, so fewer turns is directly cheaper.

### Deviations from the documents

1. **Conversation transcript is not persisted.** ARCHITECTURE puts session state in
   SQLite; only Mnemosyne is persisted. A restart begins a fresh conversation that
   *remembers*. Closing this is small: a second SQLite store, or Pi's own session
   storage.
2. **Recall runs at boot, not on the first message.** Process start is conversation
   start. The lazy version was written and removed: it opened a window where a
   steered message could reach an agent that had not started and be dropped
   silently. Cost: recall is recency-based, not ranked against the first message.
3. **Retrieval is keyword overlap plus recency**, explicitly permitted by
   ARCHITECTURE. No FTS5, no embeddings.
4. **`@earendil-works/pi-*`, not `@mariozechner/pi-*`** — the scope named in
   ARCHITECTURE is deprecated upstream, pointing at this one. Pinned exact.

### Two traps worth remembering

**Pi auto-detects OpenAI-compat quirks from the base URL.** For Ollama Cloud it
guessed the `developer` role, and Ollama **drops that role silently** — no error.
GAIA ran with no system prompt at all: no persona, no memories. It reads as a dumb
model, not a bug. `ollama.ts` now declares its `compat` flags explicitly. Suspect
this first if a new model starts ignoring its instructions.

**An unattended arm cannot answer a permission prompt.** With `acceptEdits` the
Claude Code arm edited files but silently could not run the tests, so it reported
an unverified fix. The default is now `bypassPermissions`.

---

## (b) Known loose ends

- **`bypassPermissions` is a real choice, not a detail.** The arm runs shell
  commands with no approval step. It is scoped to the workspace **by convention**
  (the subprocess cwd and the tool's path checks), not by enforcement: nothing
  stops a determined agent from `cd`-ing elsewhere. This is consistent with the
  pruned security posture in VISION, which forbids building sandboxing, but it is
  worth knowing plainly rather than discovering later.
- **No backups, deliberately.** Until they exist, arms stay pointed at targets whose
  loss would be an annoyance. Every new service keeps state in one known directory.
- **No tested rollback path**, so **GAIA's own repo is out of bounds** as an arm
  target. `GAIA_WORKSPACE_DIR` enforces this: her repo is not inside it. This is
  the blocker for the self-construction mission, see below.
- **No transcript persistence.** Restart = new conversation.
- **No tests, no linter** in the GAIA repo itself. Everything was verified by hand.
- **Steering is turn-granular, not token-granular.** A steered message lands at the
  next turn boundary; work already in flight is not interrupted. Real interruption
  is `agent.abort()`, which is not wired to any endpoint.
- **Memory has no forget or update operation.** Only remember and recall. The store
  currently holds contradictory rows about football from a steering test, which
  GAIA correctly pointed out she cannot remove. Rows 1-2 are seed data from testing
  Mnemosyne standalone. Nothing was deleted without asking.
- **Context window is hardcoded at 128k** in `ollama.ts`, a guess, not a measured
  value. No compaction is wired, so a long conversation will eventually overflow.
  Pi ships compaction helpers.
- **The arm bench was one bug in one small repo.** It measures tool-loop competence,
  not large multi-file work. Do not over-read the glm-vs-qwen numbers.
- **`GAIA_AUTH_TOKEN` was generated by me** with `openssl rand -hex 32`. Rotate it
  if you want one you chose.
- **Ollama Cloud requires a paid plan** for the good models, and `kimi-k3` is billed
  *separately* from the subscription ("extra usage only"). If a 403 appears, check
  billing before debugging code.

---

## (c) Prompt for the next session

> Read docs/VISION.md, docs/ARCHITECTURE.md and docs/CONVENTIONS.md in full, then
> NEXT.md at the repo root, before writing any code. Everything marked [Decided] is
> closed, and everything marked [Revised] wins over the text around it: do not
> reopen, re-ask, or "improve" either. If you hit a situation the documents do not
> cover, stop and ask me instead of inventing.
>
> Session context: still local (WSL), no k3s. Secrets in the repo-root `.env`,
> services run as Node processes via pnpm, no Kubernetes, no Docker. Start
> Mnemosyne before the core.
>
> Scope of this session: **the first self-construction mission, the panel**
> (ARCHITECTURE build order step 5, VISION "Self-construction"). This is the
> milestone VISION describes as recognizable: I open the panel, authenticate, and
> talk to GAIA in an interface she built for herself, in a conversation she will
> remember tomorrow.
>
> 1. React + Vite + TypeScript, Tailwind v4 (CSS-first `@theme`, never a v3-style
>    `tailwind.config.js`), shadcn/ui as the component base. It joins the monorepo
>    as a third package.
> 2. **The transport must preserve mid-run steering.** ARCHITECTURE calls this a
>    hard requirement for every transport, and the panel is where it matters most.
>    `GET /stream` (SSE) plus `POST /chat` already exist and already do this;
>    consume them rather than inventing a new channel. I must be able to type a
>    second message while she is working and see it land in the running turn.
> 3. Bearer token on every call, since the front door applies to the panel's API too.
> 4. Design: CONVENTIONS is explicit that nothing may read as generic AI output.
>    Default shadcn gray-on-white, gradient hero, emoji feature cards, uniform
>    rounded-card soup all fail the bar. Use the impeccable.style skill. **Ask me
>    the specific questions you need about direction and personality before
>    building screens; do not fill the gap with defaults.**
>
> How much of this GAIA builds herself is the interesting question, and it is mine
> to answer: ask me before you start whether you are building the panel directly,
> or driving it through her delegate_code tool as a real self-construction run.
> Note that her own repo is deliberately outside `GAIA_WORKSPACE_DIR` because there
> is no tested rollback path yet, so the second option needs that resolved first.
> Raise it, do not route around it.
>
> Out of scope: k8s manifests, backups, Docker, Postgres, memory consolidation.
>
> Session done criterion: I open the panel in a browser, authenticate, hold a
> conversation with GAIA, send a message while she is still working and see it
> reach her, then reload the page and she still knows what I told her.
>
> When the done criterion passes, do not start the next phase. Rewrite NEXT.md with
> the same three sections, where the prompt in (c) covers the consolidation CronJob
> (build order step 6), translated to whatever the local equivalent of a scheduled
> trigger is. Then stop.
