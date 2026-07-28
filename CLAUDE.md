# GAIA

Personal AI assistant for a single user (Paulo). Brain-with-arms architecture on Pi.

Before writing any code, read: @VISION.md, @ARCHITECTURE.md, @CONVENTIONS.md.
Everything marked [Decided] in those files is closed: do not reopen, re-ask, or "improve" it. If the documents do not cover a situation, stop and ask Paulo instead of inventing.

## Non-negotiables (details in CONVENTIONS.md)

- pnpm only; never hand-pin versions from memory, install via `pnpm add`.
- TypeScript strict; functional leaning; simple but never gambiarra; no pattern without a concrete problem forcing it.
- Data: Drizzle ORM; SQLite is the default store; Mnemosyne is SQLite always.
- Frontend: React + Vite, Tailwind v4 (never v3-style config), shadcn/ui, impeccable.style skill for all frontend work. No generic AI-looking UI; ask Paulo when design direction is missing.
- English in code, comments, commits, and docs.

## Maintenance

When a lasting technical decision is made in a session, append it to the Decision Log in CONVENTIONS.md (date + one-line why). Update this file only when a non-negotiable changes. Keep this file short: it loads on every session.

## Commands

Both services read the repo-root `.env`. Mnemosyne must be up before the core.

- `pnpm start:mnemosyne` / `pnpm dev:mnemosyne` (watch) — memory service, port 3001.
- `pnpm start:core` / `pnpm dev:core` (watch) — brain + HTTP channel, port 3000.
- `pnpm typecheck` — all packages.
- `pnpm --filter @gaia/mnemosyne db:generate` — regenerate migrations after a schema change.

No build step: Node runs the TypeScript sources directly. Tests and lint do not exist yet.
