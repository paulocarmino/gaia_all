# NEXT

State of GAIA at the end of the session of 2026-07-28. Read this before starting
the next one. There was a parallel session provisioning the VPS; its decisions
are in ARCHITECTURE and CONVENTIONS, and everything below is still local (WSL).

---

## (a) What was built

Build order steps 1, 2, 4 and 5 (VISION's first self-construction milestone),
running locally: no k3s, no Docker, no manifests. Step 3 (backups) is
deliberately deferred, see the revision in ARCHITECTURE.

### Layout

```
gaiav2/
  packages/
    core/                   brain + front door (port 3000, also serves the panel)
      src/env.ts            config parsed and validated at boot
      src/auth.ts           static bearer token, constant-time compare
      src/ollama.ts         Ollama Cloud as a custom pi provider
      src/brain.ts          the conversational agent
      src/persona.ts        system prompt
      src/memory.ts         Mnemosyne client + remember tool
      src/vision.ts         her eye: reads images, look_at_image tool
      src/session.ts        the single live conversation, steering, recall
      src/server.ts         routes + static panel
      src/arms/             claude-code (primary), glm (secondary), routing, delegate
    mnemosyne/              memory service (port 3001), SQLite via Drizzle
    panel/                  React + Vite + Tailwind v4 + shadcn, mono/dark
```

### Running it

```bash
pnpm start:mnemosyne     # first: the core recalls from it at boot
pnpm start:core          # serves the built panel at :3000
pnpm dev:panel           # optional, HMR at :5173, proxies /api to the core
pnpm build:panel         # what :3000 serves
```

### Verified by hand this session

- **Panel**: token gate rejects empty/wrong tokens; conversation, markdown,
  tables and code render; tool calls appear live; reload restores the thread,
  the attached image and the eye's reading.
- **Steering through the panel**: a message typed mid-run is marked
  `↩ no meio do trabalho` and lands in the running turn.
- **Vision**: attach/paste/drag an image, and she read a real error screenshot
  5/5 correct (file, line, import, count, command). She used `look_at_image` to
  double-check before answering.
- **Delegation**: default route goes to Claude Code (proven from the tool args in
  the event stream, not inferred); explicit request routes to glm; a correction
  sent mid-build resumed the same arm session rather than starting over.
- **Production**: Fastify serves the built bundle; she answered from memory with
  no dev server involved.

### Bugs worth remembering (all found by looking at the rendered page)

- **React counted twice.** base-ui resolved React's CJS build while the app used
  ESM. Fix: `resolve.dedupe` + `optimizeDeps.include` in the Vite config.
- **`<img>` cannot send an Authorization header.** Attachments are fetched as
  blobs with the token. Token in the query string would have worked and leaked
  into history and logs.
- **Duplicated messages and replies.** The optimistic message was not reconciled
  with the stream's echo, and the in-flight reply was looked up only at the tail
  of the list, so a steered message landing mid-list created a second entry.
- **A border colour used as text colour.** Unreadable. `--color-term-line` is
  borders only now; `--color-term-faint` is secondary text.
- **An unattended arm cannot answer a permission prompt.** With `acceptEdits` the
  Claude Code arm edited files but silently could not run tests, so it reported
  an unverified fix. Default is now `bypassPermissions`.

---

## (b) Known loose ends

**The big one, and the subject of the next session:** memory has no notion of a
conversation, and recall is not associative. Details in (c).

- **`bypassPermissions` is a real choice.** The arm runs shell commands with no
  approval, scoped to the workspace **by convention** (subprocess cwd plus path
  checks), not by enforcement. Consistent with VISION's pruned posture, which
  forbids building sandboxing, but worth knowing rather than discovering.
- **No backups, deliberately.** Until they exist, arms stay pointed at targets
  whose loss would be an annoyance, and every service keeps durable state in one
  known directory.
- **No tested rollback path**, so **GAIA's own repo is out of bounds** as an arm
  target (`GAIA_WORKSPACE_DIR` does not contain it).
- **Nothing survives a core restart except Mnemosyne.** The transcript and the
  image-to-message map are both in process memory. A page reload is fine; a
  process restart is a blank conversation.
- **No tests, no linter** in this repo. Everything was verified by hand.
- **Steering is turn-granular.** A steered message lands at the next turn
  boundary; work already in flight is not interrupted. `agent.abort()` exists and
  is not wired to any endpoint.
- **Memory has no forget or update.** The store currently holds junk from my
  testing, including contradictory rows about football, and she correctly says she
  cannot remove them. This is *why* she offered to resume one of my test threads.
- **The eye is good at text, weak at shapes.** 5/5 on an error screenshot; it
  miscounted bars in a synthetic chart. Fine for screenshots, do not trust it for
  diagram geometry.
- **Context window is a hardcoded 128k guess** with no compaction wired, so a
  long conversation will eventually overflow. Pi ships compaction helpers.
- **The panel bundle is 400kB** (124kB gzip) mostly because the full Geist and
  Geist Mono families are embedded. Subsetting would cut most of it.
- **Only tested in headless Chrome.** Paulo has not yet confirmed it in his own
  browser.

---

## (c) Prompt for the next session

> Read docs/VISION.md, docs/ARCHITECTURE.md and docs/CONVENTIONS.md in full, then
> NEXT.md at the repo root, before writing any code. `[Decided]` is closed and
> `[Revised]` wins over the text around it: do not reopen either. If the documents
> do not cover something, stop and ask me.
>
> Session context: still local (WSL). Secrets in the repo-root `.env`, services as
> Node processes via pnpm. Start Mnemosyne before the core. Another session is
> provisioning the VPS; do not touch infrastructure.
>
> Scope of this session: **conversations as a real concept, and memory that
> actually associates across them.** Two halves of one problem.
>
> **1. Conversations.** Today there is exactly one conversation, it lives in
> process memory, and it dies on restart. I want a list of conversations in the
> panel, the ability to start a new one, and to switch between them. That means
> conversations and their transcripts get persisted (SQLite via Drizzle in the
> core, per ARCHITECTURE Persistence, in one known directory per the standing
> constraint). Pi has session storage (`jsonl-repo`, `memory-repo`, and a sqlite
> storage package) — evaluate whether to use it or to store transcripts ourselves
> with Drizzle like everything else, and say which you picked and why. Keep
> steering working per conversation.
>
> **2. Associative recall — the thing I actually miss from Hermes.** If I talked
> about Naruto in conversation A and mention Kakashi in conversation B, she must
> connect them and recall A. Today she cannot: Mnemosyne ranks by word overlap, and
> "Kakashi" shares no word with "Naruto", so it scores zero.
>
> I already probed this, so do not re-derive it:
>
> - **Ollama Cloud does not serve embeddings.** `/v1/embeddings` is 404 and
>   `/api/embed` returns 401 with the same key that works for chat (`/api/tags`
>   returns 200, so it is not the token). This **invalidates** the line in
>   ARCHITECTURE saying to source embeddings from Ollama Cloud "so nothing needs a
>   local GPU". Record that as a dated revision.
> - **The LLM itself works as the relevance filter, and it is enough for now.**
>   Given a list of stored memories plus a new message, glm-5.2 returned
>   `{"ids": [4], "porque": "...Kakashi... ligando-se diretamente à memória de que
>   Paulo está revendo Naruto Shippuden"}` — it picked the Naruto memory and
>   rejected pnpm, coffee and Neovim. 221 prompt tokens for 8 memories.
>
> So: build associative recall as an LLM relevance pass, not as a vector database.
> It resolves the actual requirement with zero new infrastructure. Be honest about
> where it stops working: every memory goes into the prompt, so a few hundred is
> fine and a few thousand is not. Design it so a cheap pre-filter can slot in front
> later (embeddings would then have to be local/CPU or another provider — do not
> pick one now).
>
> **3. Two things that fall out of the above and are in scope.**
>
> - **Recall must use the conversation as its query, not just recency.** Boot-time
>   recall pulls the 10 newest memories with no filter, which is why she greeted me
>   by offering to resume a test thread that was not mine. That is the bug behind
>   the symptom.
> - **Memory needs forget/update.** She currently cannot remove a wrong or stale
>   memory and correctly says so. The store also holds junk from my testing that
>   needs clearing; ask me before deleting anything you did not create.
>
> Out of scope: k8s, backups, Docker, Postgres, memory consolidation (that is the
> session after this one), and any change to the arms.
>
> Design note: the panel is mono-first, dark, terminal. v0 bar is plain and
> functional but never careless. shadcn components come from the CLI, never written
> by hand, and sizes come from the `--text-*` tokens. Ask me before inventing UI
> for the conversation list; do not fill the gap with defaults.
>
> Session done criterion: I open the panel, see my conversations, start a new one,
> talk about something in it, and in a *different* conversation mention something
> related-but-not-identical and she connects it. Then I restart the core and my
> conversations are still there.
>
> When it passes, do not start the next phase. Rewrite NEXT.md with the same three
> sections, where (c) covers memory consolidation (build order step 6) as a
> scheduled trigger, in whatever the local equivalent of a cron is. Then stop.
