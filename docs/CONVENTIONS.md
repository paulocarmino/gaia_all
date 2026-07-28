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
- 2026-07-28, VPN reopened and adopted (Paulo), Tailscale is in: it is the access path to ports and DNS names that must not be on the public internet, and it is expected to pair with the future deploy-control tool; this reverses the v0 deferral in ARCHITECTURE Access paths.
- 2026-07-28, Tailscale is explicitly NOT the SSH/admin path, if the tailscale daemon dies the box must still be reachable, so hardened public SSH on port 22 stays as the recovery door.
- 2026-07-28, the server firewall is plain iptables plus netfilter-persistent, not ufw, enabling ufw on an Oracle image resets the chains and can drop the `InstanceServices` rules the instance needs for metadata and iSCSI.
- 2026-07-28, no Docker on the k3s host, k3s brings its own containerd and a Docker daemon alongside it sets `FORWARD` policy to DROP (which breaks pod networking) and keeps a separate image store the cluster cannot read.
- 2026-07-28, k3s installed with `--disable traefik`, Traefik applies request timeouts to long-lived connections (documented 60s cuts on gRPC/websocket streaming) and LLM response streaming is on GAIA's critical path.
- 2026-07-28, Envoy Gateway is the ingress, driven by Gateway API, with cert-manager for Let's Encrypt, long-lived streams are Envoy's design rather than a tunable, and Gateway API is the forward path now that ingress-nginx and its successor InGate both reached end of life in March 2026.
- 2026-07-28, the image registry is self-hosted in-cluster, not ghcr.io (ARCHITECTURE said ghcr.io; Paulo corrected it), CI runs on an in-cluster GitHub Actions runner so build, push and pull all happen over a ClusterIP Service and image traffic never crosses the ingress.
- 2026-07-28, cluster add-ons are installed through k3s `HelmChart` CRDs rather than a helm binary on the host, it keeps the host free of tooling and the add-on set declarative and visible in the cluster like everything else.
- 2026-07-28, every `HTTPRoute` that streams (SSE, websockets, gRPC streaming) must ship with a `BackendTrafficPolicy` setting `timeout.http.requestTimeout: 0s`, Envoy's default route timeout is 15s and cuts streamed responses; measured, see ARCHITECTURE Hosting.
- 2026-07-28, the streaming-timeout argument that drove the Traefik-to-Envoy choice was only half right and is recorded so it is not repeated as folklore, Envoy has the same class of timeout and a stricter default; the real gain is that the fix is a namespaced resource in git rather than static proxy config.
- 2026-07-28, DNS is `*.paulocarmino.com` (Cloudflare) pointing at the server with the proxy OFF, a wildcard record has a single proxy state and Cloudflare's proxy adds its own idle timeout and a 100MB body cap, which would silently reintroduce the streaming problem on every subdomain GAIA publishes; turning the orange cloud on is an opt-in per specific record that overrides the wildcard, only for hosts known not to stream.
- 2026-07-28, certificates are a single wildcard issued by DNS-01 through the Cloudflare API, Let's Encrypt does not issue wildcards over HTTP-01 and a wildcard is what lets GAIA publish a project subdomain without anyone touching DNS.
- 2026-07-28, the apex `paulocarmino.com` is deliberately untouched and so is every pre-existing record in that zone, the domain hosts unrelated live services and only the wildcard was repointed.
- 2026-07-28, shadcn/ui components are added with the CLI (`pnpm dlx shadcn@latest add <name>`) and never written by hand (Paulo), a hand-written component drifts from the registry and cannot be updated; corollary, do not hand-edit files under `src/components/ui` and delete a component you are not using instead of patching it.
- 2026-07-28, v0 frontend bar: plain and functional over elaborate, but never ugly or careless, shadcn plus the terminal theme is what keeps that cheap; Paulo asked to be reminded of this whenever a screen starts growing decoration it does not need.
- 2026-07-28, the panel is mono-first and dark-only, terminal aesthetic chosen by Paulo; `--color-term-line` is a BORDER colour only and must never be used as text (it was, and it was unreadable), `--color-term-faint` is the secondary text tone.
- 2026-07-28, the panel builds its transcript from the agent's SSE event stream rather than keeping its own record, the steering marker and live tool lines fall out of that for free and cannot disagree with what the loop actually did.
- 2026-07-28, conversation state lives in the core and the panel reads it from `GET /messages`, a browser reload must not lose the thread and the panel is a window onto the conversation, not its owner.
- 2026-07-28, production serves the built panel from Fastify and never a dev server, an unbundled dev server ships hundreds of modules per page and leaks memory through its own watchers the longer it is up, which is the slowness the previous build suffered from.
- 2026-07-28, the brain is text-only so images go through a separate vision model (`GAIA_VISION_MODEL`) and only its reading enters the transcript, this is required rather than tidy: a text-only model rejects the whole request once an image is anywhere in the history, so one upload would break every later turn.
- 2026-07-28, images are fetched as blobs with the bearer token instead of set as an `<img src>`, an img tag cannot send an Authorization header and putting the token in the query string would leak it into history and logs.
- 2026-07-28, Vite must dedupe react/react-dom and pre-bundle them, pnpm's layout let base-ui resolve React's CJS build while the app used ESM, which React treats as two copies and rejects with "invalid hook call".
- 2026-07-28, panel type sizes come from five `--text-*` tokens in the theme, never from per-element pixel values, resizing the whole panel's reading size has to be one edit and not a sweep across components.
- 2026-07-28, the registry is Zot on a 50Gi local-path PVC, Harbor drags Postgres and Redis for features a single user does not need and Distribution's garbage collection requires stopping the registry, while Zot does online GC and layer dedupe with no database.
- 2026-07-28, images are always referenced as `zot.registry.svc.cluster.local:5000/...`, pods resolve it through CoreDNS and the node's containerd mirrors the same name to the NodePort in `registries.yaml`, so one reference works from both sides and no manifest needs a node-specific address.
- 2026-07-28, the registry speaks plain HTTP and clients pass an insecure flag, the only routes to it are the pod network and the WireGuard-encrypted tailnet, so an internal CA would add a certificate to maintain without protecting anything that is currently exposed.
- 2026-07-28, Zot's `readTimeout`/`writeTimeout` are set to 3600s, the chart ships 60s which is exactly the limit that breaks pushes of multi-gigabyte layers.
- 2026-07-28, Ollama Cloud does NOT serve embeddings (`/v1/embeddings` 404, `/api/embed` 401 with a key that works for chat and `/api/tags`), measured; this invalidates the ARCHITECTURE note about sourcing embeddings there, so semantic recall must come from an LLM relevance pass now and from local/CPU or another provider later.
- 2026-07-28, associative recall is an LLM relevance pass over stored memories rather than a vector store, measured: glm-5.2 correctly linked "Kakashi" to a stored Naruto memory and rejected the unrelated ones for 221 prompt tokens; it stops scaling once every memory no longer fits the prompt, so keep a pre-filter seam in front of it.
