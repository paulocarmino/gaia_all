# GAIA, Engineering Conventions

## How to read and maintain this document

This is a living document, third in the hierarchy: if it ever conflicts with VISION.md or ARCHITECTURE.md, those win. It captures how code gets written here, so the same preference never has to be stated twice.

Maintenance is part of the job: whenever a lasting technical decision is made during a session (a library choice, a structural convention, a rule that should survive the session), Claude Code appends it to the Decision Log at the bottom, with date and a one-line reason, and updates CLAUDE.md only if the decision changes one of the non-negotiables listed there. Session-specific details do not belong here; only things future sessions must know.

## Package management

- pnpm only, with workspaces. Never npm or yarn.
- Never hand-pin a version number suggested from the agent's own memory. Install with `pnpm add <pkg>` and let the registry resolve; the lockfile is the source of truth. Agent-remembered version numbers are stale by definition.
- Dependency upgrades are deliberate acts, never drive-by edits inside unrelated tasks.

## Code style

- Simple over clever, and simplicity is not gambiarra. Simple means fewer moving parts and obvious data flow; it never means skipped error handling, swallowed exceptions, or magic shortcuts. If the "simple" version hides a landmine, it is not simple, it is deferred pain.
- Functional leaning: pure functions by default, immutability by default, composition over inheritance. Classes only where a dependency's API genuinely demands them.
- Patterns must earn their place. Nothing gets added to look enterprise or to fill an architecture checklist. When a concrete problem genuinely calls for a pattern (yes, even the repository pattern, adopted under protest if it comes to that), use it and record one line in the Decision Log saying which problem forced it.
- KISS and SOLID from the start. When they conflict, KISS wins and the SOLID concern becomes a note in the code, not a speculative abstraction.
- TypeScript strict mode everywhere. `any` is not an escape hatch; if a type is genuinely unknowable, say `unknown` and narrow it.
- English for code, comments, commit messages, and documentation.

## Data layer

- ORM: Drizzle, for both SQLite and Postgres dialects.
- Default storage is SQLite (files, zero ops). The Postgres rule lives in ARCHITECTURE.md (Persistence): CloudNativePG enters when the first real relational consumer lands, new relational things are born there from that point, and Mnemosyne stays on SQLite permanently.

## Frontend

- React + Vite + TypeScript. Not Next.js.
- Tailwind v4, never v3. Watch for the classic agent failure mode of generating a v3-style `tailwind.config.js`; v4 is CSS-first configuration (`@theme` in CSS).
- shadcn/ui as the component base.
- Design rule, in force until a proper design document exists: nothing that reads as generic AI output. If a screen could be a template (default shadcn gray-on-white, gradient hero, emoji feature cards, uniform rounded-corner card soup with the same shadow on everything), it failed the bar. The impeccable.style skill is installed in Claude Code: use it for all frontend work. When design direction or personality is missing for a screen, ask Paulo the specific questions needed to give it one; never fill the gap with defaults.

## Decision Log

Append-only. Format: `YYYY-MM-DD, decision, one-line why.`

- 2026-07-27, initial conventions captured from Paulo, baseline for the build.
- 2026-07-27, SQLite default with Postgres-on-first-real-consumer rule, avoids Docker in local v0 and keeps Mnemosyne embedded; Drizzle keeps both dialects open.
- 2026-07-28, Pi comes from the `@earendil-works` scope, not `@mariozechner`, the latter is deprecated upstream in favour of it.
- 2026-07-28, Pi packages pinned to exact versions (no caret), ARCHITECTURE requires deliberate Pi upgrades and a range is not deliberate.
- 2026-07-28, Ollama Cloud is registered as a custom pi-ai provider over the OpenAI-completions API, pi ships no Ollama provider and Ollama Cloud is OpenAI-compatible.
- 2026-07-28, model `compat` flags are declared explicitly rather than left to pi's URL auto-detection, it guessed the `developer` role for Ollama, which Ollama drops silently and the entire system prompt vanished with no error.
- 2026-07-28, TypeScript runs directly on Node's native type stripping (no tsx, no build step), `erasableSyntaxOnly` keeps the code honest about it.
- 2026-07-28, memory retrieval is keyword overlap plus recency in plain Drizzle, ARCHITECTURE says start with the dumbest thing that works; upgrade to FTS5 or embeddings only when recall quality actually hurts.
- 2026-07-28, recall runs once at process boot rather than lazily on the first message, doing it lazily opened a window where a steered message could reach an agent that had not started yet and be dropped silently.
- 2026-07-28, backups reopened and deferred (Paulo), v0 has not settled enough to know what to back up or where, and backups are cheap to add late but expensive to add wrong; see ARCHITECTURE Backups.
- 2026-07-28, durable state must live in one known directory per service, this is what keeps deferred backups cheap to adopt and is now a standing constraint on every new service.
- 2026-07-28, default branch is `main`, plain preference over git's legacy `master`.
