# GAIA, Architecture Decisions

## How to read this document

This records the decisions that were made and the reasoning behind each one. It stops at the level of architecture and technology choice. It deliberately does NOT specify file structure, component names, function signatures, routes, or code snippets. Those are yours to decide while building. Where something is intentionally left open, it says so. The decisions the first review pass had left open were closed with Paulo in a follow-up session; they are marked **[Decided]** where they land, and summarized in "Decisions closed after review" near the end. None of them are open questions anymore.

Anything marked **[Added in review]** was introduced during an external review pass and was not part of the original decision record. Treat those parts as strong recommendations that close real gaps, not as settled history. Everything else is settled: honor it, do not re-ask about it.

Anything marked **[Revised YYYY-MM-DD]** is a decision Paulo deliberately reopened and changed after the fact. The revision wins over whatever the surrounding text used to say; the original reasoning is kept so the change is legible, not erased.

## Foundation: Pi as a dependency, not a fork

GAIA is built on top of Pi (the `pi-agent-core` / `pi-ai` TypeScript agent toolkit), consumed as a dependency, never forked.

Rationale: Pi is a minimal, unopinionated, model-agnostic agent loop. It provides the boring, well-solved parts for free (the loop, tool calling, multi-provider inference, event streaming, and message steering/queueing so input can be sent while the agent works), and stays out of the way for everything else. Consuming it as a dependency is what lets Pi be upgraded later instead of freezing GAIA on one version. This is the fork trap avoided on purpose. All of GAIA's personality and custom behavior lives in our own layer around Pi, never inside it.

Pi being model-agnostic is exactly what enables the brain/arm split below. Pi is turn-based by nature.

**[Added in review]** Two practical consequences of this choice:

- Pin the Pi version explicitly and upgrade deliberately. "Dependency, not fork" only pays off if upgrades are boring, and they are only boring when they are intentional.
- Pi's mid-run steering is a hard requirement, not a nice-to-have. The previous build's gateway was one-way, and that was one of its named failures. Every transport built on top of the core (the minimal early channel, the panel's chat later) must preserve the ability to send a message while GAIA is working and have it reach the loop. Design the chat transport (WebSocket or SSE plus a send endpoint) with this constraint from day one.

## Language and structure

TypeScript, single monorepo. The monorepo holds the frontend, the backend, the memory integration, the skills, and all configuration; Pi enters as a dependency. Backend is Fastify, frontend is React (Paulo's current preference). **[Decided]** Monorepo tooling is plain pnpm workspaces; add Turborepo only if build times ever hurt at this scale, which is unlikely.

Because GAIA's body and her own code live in the same repo, she can modify herself. **[Clarified in review]** Self-modification is not a special mechanism: it is the ordinary delegation flow (brain delegates to an arm) where the target repository happens to be her own. Nothing ever writes to the running filesystem directly; changes land in git and reach production through the build-and-deploy loop defined below. That loop, plus a tested rollback path, is the "safe restart strategy" the original draft deferred.

## Inference: one brain, two kinds of arm

**Brain (conversational):** Ollama Cloud, called over its API with a key, inside Pi's loop. This is who GAIA is day to day: she converses, decides, orchestrates. **[Decided]** The brain is GLM-5.2 on Ollama Cloud, configured via environment variable so swapping models is a one-line change, never a refactor. If GLM-5.2 disappoints on tool-calling reliability in practice, Qwen3.5 397B is the tested runner-up.

**Arms (code execution),** selected per task:

- **Claude Code, headless,** invoked as a subprocess (`claude -p "task" --output-format json`, using `--resume <session_id>` for multi-step tasks). It runs under Paulo's Claude subscription via the same authentication as interactive use; `claude setup-token` provides a long-lived token for unattended use on the VPS. Use this arm for tasks that need higher quality or genuine multi-file agentic work.
- **Chinese models on Ollama Cloud** (Qwen, GLM, DeepSeek, and similar) for the majority of common code tasks. ~~**[Decided]** The default arm model is qwen3-coder:480b; Ollama tests its cloud models on tool calling and real agent workflows before release, and this is the strongest coding model in the catalog.~~ **[Revised 2026-07-28]** qwen3-coder:480b no longer exists in the Ollama Cloud catalog, so this decision was overtaken by reality rather than reopened by choice. The replacement is **glm-5.2**, the same model as the brain, chosen on measurement rather than reputation: on a multi-turn bench (read unfamiliar code, find a real bug, edit, run tests, react) glm-5.2 and qwen3.5:397b both fixed it correctly 3/3 with zero malformed tool calls and no test tampering, but glm-5.2 did it in 5.0 turns and 5.9s against 7.3 turns and 20.5s. Since this pool is metered by GPU time, fewer turns is directly cheaper. Note the bench is one bug in one small repo: it measures tool-loop competence, not large multi-file work. One correction to the original record: this pool is not free of limits, it is just a different budget. Ollama Cloud meters usage by GPU time, with session limits resetting every 5 hours and weekly limits every 7 days. So the accurate framing is "does not consume the Claude subscription limit", not "unlimited".

A "delegate code" tool routes each task to one arm or the other. ~~**[Decided]** The v0 routing rule: the Chinese arm is the default; the Claude Code arm is used when (a) Paulo explicitly asks, (b) the task modifies GAIA's own core repository, or (c) the task is a retry after a Chinese-arm failure.~~ **[Revised 2026-07-28]** The default is inverted: **Claude Code is the primary arm**, and glm-5.2 on Ollama Cloud is the secondary, used when Paulo explicitly asks for the cheap arm. Paulo's reasoning: while GAIA is being built, the quality of the arm matters more than its cost, and the Claude Code arm is the one he actually trusts to land a change. The original rule assumed a proven cheap arm as the workhorse; that assumption is not yet earned. Revisit once there is evidence the cheap arm succeeds unattended on real tasks. The mechanism must keep this rule trivial to adjust: swapping the default is a one-line change, never a refactor.

**[Added in review] The Chinese arm needs a harness.** An API call to Qwen or GLM returns text; it does not edit files, run tests, or execute commands. Inference alone is not an arm. To make these models a real code-executing arm, they need an agentic harness with file and shell tools, and the obvious harness is Pi itself: a headless Pi session configured with a Chinese model and a small toolset (read, edit, run), operating on a checkout of the target repo. This keeps the architecture honest (both arms are agents, they just differ in model and cost) and reuses the dependency already in the stack. Do not silently degrade this arm into "generate a diff and hope"; if the harness feels like too much for v0, say so and route everything to Claude Code until it exists.

**[Added in review] Operational notes for the Claude Code arm:**

- The subprocess runs inside the GAIA core's pod, so the core's image (or checkout environment) must include the Claude Code CLI, and the target repo must be reachable on its filesystem.
- The `setup-token` credential is a secret. It goes into a Kubernetes Secret, injected as an environment variable, never into git and never into memory (see Secrets).
- Every invocation gets a timeout and structured handling of JSON parse failures. A hung or garbled subprocess must surface as a failed task, not a frozen brain.
- Enforce a concurrency cap on this arm (default 1, configurable). The subscription comfortably sustains roughly 1 to 3 concurrent agents; Paulo's volume is mostly sequential, so 1 is the sane default.
- Escalation should be cheap and explicit: when the Chinese arm fails or produces junk, "retry with the strong arm" is a one-step action Paulo (or the brain, per the routing rule) can take. Do not build automatic escalation in v0; make manual escalation frictionless instead.

**Subscription notes (capacity planning):** since 2026-06-15, programmatic use (`claude -p`, the Agent SDK) draws from the same weekly subscription limit as interactive chat, not a separate pool. Every delegated Claude Code task consumes from that shared weekly limit. Treat the Chinese-model arm as the default and the Claude Code arm as the "when it is worth it" option.

## Memory: Mnemosyne as a network service

Memory is Mnemosyne, run as a service on the VPS. GAIA interacts with it through two operations: remember and recall. The minimum viable version is a text store plus similarity search; starting with the dumbest thing that works is fine (it can even be backed by the existing Obsidian vault), and it should only be upgraded when retrieval quality actually becomes a problem in practice.

**[Added in review] Non-binding implementation defaults,** so the implementer does not have to invent them: transport is plain HTTP inside the cluster (no need for anything fancier between two services on one node); a reasonable MVP backend is SQLite with a vector extension, or even plain full-text search to start; if embeddings are used, source them from Ollama Cloud's embeddings endpoint so nothing needs a local GPU. The datastore lives on a PersistentVolumeClaim and is part of the backup set (see Backups).

**[Added in review] Memory is not a secrets store.** Credentials that appear in conversation must never be "remembered". Memory is long-lived and gets recalled into future prompts; a leaked token in memory is a leaked token forever.

**Critical portability rule:** the memory skill declares its dependencies (for example, the service address via an environment variable) and never hardcodes them. This is what lets memory be reached identically from the web chat and from a CLI agent on another machine: the logic travels, the service stays put, and configuration connects the two. The same rule applies to every skill (logic is portable and lives in git; environment dependencies are declared, not baked in; a heavy system dependency goes into a container). A well-made skill announces what it needs when it lands somewhere new, instead of failing silently.

## Learning and autonomy: triggers, not magic

Memory that accumulates is the remember/recall loop above. Periodic consolidation is a scheduled job that fires the brain with a specific prompt (for example, "consolidate what you learned this week"). Any future autonomous behavior is the same pattern: a trigger (a cron, a file change, an incoming event) that wakes the brain with an instruction. This is an architecture of triggers, not learning in any deep sense. For this build, only memory consolidation is in scope; broader autonomy is deferred (see the vision document).

**[Added in review]** The natural k3s mapping for a trigger is a CronJob that calls a private endpoint on the core. **[Decided]** The CronJob: it is declarative and visible in the same place as everything else, which fits the self-construction story.

## Hosting: k3s single node

k3s, single node, on Oracle Cloud ARM.

Rationale: declarative deploy is the natural fit for a self-constructing system, because it is far easier and safer for GAIA to generate a correct manifest than to run an imperative sequence of commands without slipping. Paulo has a decade of deploy experience, so the operational cost of Kubernetes is not a barrier for him; the excellent steady-state deploy experience is the whole point.

Mapping the conceptual design onto k3s:

- The "reverse proxy" role is **Envoy Gateway**, driven by Gateway API resources, with cert-manager for automatic Let's Encrypt certificates. **[Decided 2026-07-28]** k3s ships Traefik by default and it was installed with `--disable traefik`. Rationale: GAIA serves LLM responses over SSE, which is a long-lived connection that sits idle between tokens; Traefik applies request-style timeouts to those (documented 60s cuts on gRPC and websocket streaming) and has regressed on it across patch releases, while long-lived streams are Envoy's core design rather than a setting. `ingress-nginx` was not considered: it reached end of life in March 2026, as did its intended successor InGate, which also makes Gateway API the forward-compatible choice.
  Cost accepted knowingly: one more component to operate, and no route-browsing GUI. Envoy Gateway exposes an admin console (config dump, stats, profiling) on localhost:19000; anything prettier means adding Grafana.

  **Streaming requires an explicit policy. Measured 2026-07-28, not theory.** Envoy's default route timeout is 15s and it applies to streamed responses exactly like Traefik's does — an SSE stream through the Gateway was cut at 15s (`response_flags: UT`, `response_code_details: response_timeout`) while the same stream direct to the pod ran 100s clean. So the choice of Envoy did NOT make the problem disappear; it is stricter out of the box than Traefik's 60s. What it changed is the fix: a `BackendTrafficPolicy` with `timeout.http.requestTimeout: 0s` targeting the route, which is a namespaced Kubernetes resource that lives in git next to the route it applies to, rather than static proxy config. With the policy applied the same stream ran 199s uninterrupted (ended by the client, not the proxy).

  **Consequence for every future route that streams:** an `HTTPRoute` serving SSE, websockets or gRPC streaming is broken by default and must ship with a matching `BackendTrafficPolicy`. This includes GAIA's own chat endpoint. Treat the policy as part of the route definition, not an optimisation.
- Each project GAIA spins up is a **Deployment plus Service plus Ingress**, which gives it a subdomain (`project.yourdomain`) with HTTPS automatically. This is what makes "publish a new project" trivial in the self-construction flow: she writes the manifests, applies them, and returns the link.
- Memory (Mnemosyne) is a **Service with NO Ingress.** It is therefore private by default: reachable only from inside the cluster or over the VPN, never from the public internet.
- The GAIA core is the central **Deployment.**

**[Added in review]** Two consequences of single-node worth stating plainly: node loss is total loss of runtime state, which is acceptable only because everything that matters is either in git or in the backup set (see Backups); and persistent storage is the k3s local-path provisioner, which is fine for this scale.

**[Added in review]** For GAIA to apply manifests, her core needs cluster access. Consistent with the pruned security posture, do not design an RBAC scheme: give the core's ServiceAccount enough access to apply manifests (on a single-user personal cluster, broad access is acceptable) and move on. The k3s hooks for finer separation exist if autonomous privileged action ever becomes real, as noted below.

Bonus for the future (noted, not built): the security separation that was pruned (separate identities for "reads the world" versus "acts with privilege") is available cheaply in k3s later, via ServiceAccounts, namespaces, and NetworkPolicies, if it is ever needed.

## Build and deploy loop **[Added in review, decided]**

The original record says GAIA writes manifests and applies them, but never says how source code becomes a running container. For a self-constructing system this is the critical loop, and it must be settled before building. Two workable options, simplest first:

1. **Run from source.** The core Deployment runs from a git checkout (cloned at boot or mounted), executed with node/tsx. "Deploy" is: push to git, restart the Deployment. No registry, no image builds, fastest possible inner loop. Weakness: a bad push can crashloop; mitigate with a startup health check and by keeping the previous checkout available for rollback.
2. **Images via CI.** Code changes trigger an image build pushed to a registry, and the Deployment is updated by tag. More moving parts, but rollback is native (`kubectl rollout undo`) and the artifact is reproducible.

   **[Revised 2026-07-28]** The registry is **self-hosted inside the cluster**, not ghcr.io (the original text named ghcr.io; Paulo corrected it). The intended shape: a GitHub Actions runner operator (ARC) runs *in* the cluster, so CI builds and pushes over a ClusterIP Service and the kubelet pulls from that same Service. Image traffic never touches the ingress, which is what keeps large layers out of any proxy timeout, and it is also how CI reaches the cluster at all. Pushing from outside (a laptop) goes over Tailscale, still not through the public ingress. Which registry implementation is not chosen yet.

**[Decided]** Option 1 for GAIA herself (the inner loop speed matters most while she is being built); option 2 adopted per project when a project deserves it. Whichever is chosen, a rollback path must exist and be exercised at least once before GAIA is allowed to modify herself. A self-modifying system without a tested rollback is a system that will eventually brick itself at the worst moment.

## Persistence **[Added in review]**

Conversation history and Pi session state need a home; the original record does not give them one. **[Decided]** SQLite on a PersistentVolumeClaim attached to the core, included in the backup set, accessed via Drizzle (see CONVENTIONS.md). **[Decided]** The Postgres rule: CloudNativePG enters the cluster when the first consumer with a real relational need lands; from that point, new relational things are born on it, and existing SQLite stores migrate only if they actually hurt in practice. Mnemosyne stays on SQLite regardless: an embedded file store is the right shape for a private memory service, and it backs up as a single file.

## Secrets **[Added in review]**

All credentials (Ollama Cloud API key, Claude Code token, anything a project needs) live in Kubernetes Secrets and are injected as environment variables. Never in the repo, never in manifests committed to git in plaintext, and never in Mnemosyne (see the memory section). This is hygiene, not security architecture; it costs nothing and prevents the dumbest class of leak in a system whose code and conversations are both long-lived.

## Backups **[Added in review; revised 2026-07-28]**

The vision's security posture explicitly leans on "regular backups" as the thing that turns deletion from tragedy into scare. No backup mechanism is specified anywhere in the original record.

The review pass called this the single load-bearing operational requirement and made it a prerequisite that had to land early in the build order.

**[Revised 2026-07-28]** It is no longer a prerequisite. Paulo's reasoning: this is v0 and the shape of the thing is still being discovered, including whether Oracle Object Storage is even the right destination. Committing to a backup pipeline now means committing to guesses about what is worth backing up and where it goes, and building infrastructure around an architecture that has not settled. Backups are cheap to add late and expensive to add wrong.

What this revision does and does not change:

- **Still true:** until backups run, the pruned security posture's core justification is not yet earned. That is a statement about risk, and it does not expire. The vision document is unchanged on this point.
- **Changed:** backups do not gate the next build steps. GAIA can gain arms and modify code before they exist, as long as she is pointed at targets whose loss would be an annoyance rather than a real loss.
- **Reopened:** the destination. Oracle Object Storage (S3-compatible, same cloud account, near-zero cost at this volume) is the leading candidate, not a decision. restic remains the leading tool. Neither is settled.
- **Unchanged:** the backup set, which is worth knowing now even though nothing writes it yet. The Mnemosyne datastore, conversation and session state, any project volumes, plus a check that every repo has a git remote (git is its own backup for code).

**Prepare the path, do not build the pipeline.** The cost of deferring backups is only acceptable if adopting them later stays a small job. So, as a standing constraint on everything built from here: durable state lives in a small number of known, file-shaped locations under a single data directory per service, never scattered across a filesystem and never held only in a running process. If every service's state is one directory, then whatever tool and destination eventually win, backup is a matter of pointing them at those directories. Any design that makes state hard to enumerate is the thing this section is actually forbidding.

The open question to close later, deliberately: tool, destination, schedule, and one restore test. Until then, treat "what would I lose if this machine died right now" as a question with a real answer, and keep that answer small.

## Access from multiple machines

Paulo moves between a work Mac, a personal Windows/WSL machine, and a phone, always one at a time. GAIA's body always lives on the VPS; clients are thin. What travels over the network is memory (data) and messages, never the body (the running process). This makes the multi-machine situation an argument FOR this architecture rather than a problem: one instance, one memory thread, continuous across devices. If the body lived on each machine, there would be an amnesiac GAIA per device.

Two access paths:

- **Public HTTPS via subdomains,** through the Ingress (the panel and the projects). Works from anywhere, including behind the work VPN, because it is just a website.
- **Private network (VPN).** **[Reopened and decided 2026-07-28]** The earlier decision deferred the VPN out of v0 entirely; Paulo reversed it. Tailscale is in, and its job is broader than the original framing: it is the access path to any port or DNS name that should not be on the public internet, the CLI agent talking directly to memory being one case among several. It is also expected to pair with the deploy-control tool planned for much later. It is a split-tunnel style VPN and should coexist with the work OpenVPN (which is not oppressive); this coexistence is still unverified in practice.

  **Explicitly not the SSH path.** Tailscale must never become the only way into the box: if the daemon dies, the machine has to stay reachable. Hardened public SSH on port 22 (key-only, root login off, fail2ban) stays as the recovery door, and the VPN carries services only.

  The HTTPS-intermediated fallback below remains valid for the async case, but it is now a convenience rather than plan B for a missing VPN.

**Key security consequence:** memory has exactly two access paths, both controlled (in-cluster via the core, or VPN from outside), and never the public door. So the entire "secure the memory" concern reduces to "control who is on the VPN." Everything public (subdomains, panel, projects) can be public without risking memory, because memory lives in a different layer with no public route.

**Alternative worth keeping in mind:** for async work while logged into the work VPN (a common case: Paulo gives GAIA a command and lets her work while he keeps working), the CLI agent can talk to GAIA over HTTPS and let GAIA intermediate to memory. That removes the need for any VPN in that flow and sidesteps stacked-VPN conflicts entirely. Paulo leans toward VPN plus subdomains, but this HTTPS-intermediated path is the clean fallback. Note that this fallback requires the core to expose an authenticated API, which the next section requires anyway.

## Front door authentication **[Added in review]**

The panel and every GAIA endpoint exposed through the Ingress must require authentication. To be explicit about why this is not a violation of the pruned security posture: the pruning removed internal layers (permission systems, approval gateways, sandboxing between components). This is the lock on the public front door of a system that executes code, applies manifests to a cluster, and holds personal memory. An unauthenticated public panel is not "simple", it is an open shell on the internet.

Keep it single-user simple. **[Decided]** A static bearer token checked in Fastify middleware, applied to every exposed endpoint including the panel's API. Zitadel is in Paulo's toolkit if a real login flow is ever wanted, but do not build OIDC ceremony now. Projects GAIA publishes can be public or protected case by case; default new projects to protected until Paulo says otherwise.

## Decisions closed after review **[Decided with Paulo]**

Everything the first review pass left open was settled in conversation. For the implementing agent, the complete list, so nothing here reads as an invitation to re-decide:

- Brain: GLM-5.2 on Ollama Cloud, via environment variable. Runner-up if it disappoints: Qwen3.5 397B.
- Default arm model: **[Revised 2026-07-28]** qwen3-coder:480b is gone from the Ollama catalog; the secondary arm is glm-5.2, harnessed by headless Pi with file and shell tools. Chosen on a measured multi-turn bench, see the arms section.
- Routing v0: **[Revised 2026-07-28]** inverted. Claude Code is the primary arm; the cheap glm-5.2 arm runs only on explicit request. See the arms section.
- Deploy loop: run-from-source (option 1) for GAIA; images per project later when deserved.
- Monorepo tooling: plain pnpm workspaces.
- Persistence: SQLite on a PVC.
- Backups: **[Reopened 2026-07-28]** no longer a prerequisite and no longer settled. restic to Oracle Object Storage is a candidate, not a decision. The standing requirement is that durable state stays enumerable in one directory per service so backups are cheap to adopt later. See the Backups section.
- Front door: static bearer token in Fastify middleware.
- Consolidation trigger: Kubernetes CronJob.
- Brain unavailability: GAIA is down when her brain's API is down. No failover in v0.
- VPN: **[Reopened 2026-07-28]** no longer deferred. Tailscale is adopted as the access path to everything that must not be public, and is explicitly not the SSH/admin path. See the Access paths section.

## Suggested build order **[Added in review, non-binding]**

1. Repo, core Deployment skeleton, Secrets, front-door auth, and a minimal channel to the brain through Pi (a bare HTTP endpoint is enough). Steering must already work here.
2. Mnemosyne MVP (remember, recall) wired so recall happens at conversation start.
3. ~~Backups of what exists so far, restore-tested.~~ **[Revised 2026-07-28]** Deferred, no longer a gate. Until it lands, GAIA's arms stay pointed at targets whose loss would be an annoyance, not a real loss.
4. The delegate-code tool with both arms and the v0 routing rule.
5. First self-construction mission: the panel, preserving mid-run steering in its transport.
6. The consolidation CronJob.

## Explicitly out of scope for this build

Permission systems, multi-user OS separation, approval gateways, and sandboxing (see the vision document, security posture). Also a separate deploy tool ("Paulo's own Dokploy"): this is a future idea, and it may end up being just a GAIA capability (say "deploy this," and she writes the manifests) rather than a standalone product. Do not build it now. Note it, then leave it.
