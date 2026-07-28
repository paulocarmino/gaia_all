# GAIA, Vision

## What GAIA is

GAIA is a personal AI assistant for a single user (Paulo), running in a self-hosted homelab. She is a persistent presence you talk to, who remembers what matters across conversations, and who grows her own capabilities and small projects over time through dialogue.

She is the successor to an earlier experiment: an agent (called MAIA/GAIA) built on the Hermes framework. That experiment worked but revealed friction. It used roughly 10% of a heavy horizontal framework; its message gateway was one-way (no queue, so nothing could be sent while it was thinking); its kanban had to be rewritten to fit the desired flow; and its web panel ended up slow because it was built without close supervision. GAIA is the deliberate, focused rebuild that keeps the lessons and drops the weight. **[Clarified in review]** Each of those failures maps to a concrete requirement in the architecture: the one-way gateway is why mid-run steering is a hard requirement, the 10% usage is why Pi (minimal) replaces Hermes (horizontal), and the unsupervised slow panel is why self-construction happens in reviewed dialogue, not in bulk.

## Why she exists

The goal is not to build "the next Claude Code" or "the next Hermes." There is zero intention of a public product. The goal is a tool that fits one person's actual, focused use. Paulo is a developer who enjoys building his own tools, and GAIA is that instinct applied to a personal assistant. A ready-made tool is great for learning the shape of a problem; at some point the friction of using 10% of someone else's thing outweighs the cost of building 100% of your own. GAIA is on the far side of that line.

## The core idea: a brain with arms

GAIA has one conversational brain and one or more code-executing arms. The brain converses, decides, orchestrates, and remembers. It does not write code directly. When a task needs code, the brain delegates to an arm. This separation is deliberate and fixes a concrete problem from the previous version, where the assistant would inconsistently "try to code on its own" and sometimes enter the intended flow, sometimes not. Coding is a tool the brain reaches for, not something the brain is.

**[Clarified in review]** This applies to GAIA's own code too. When she modifies herself, the brain delegates that work to an arm exactly like any other build task; there is no special self-editing path. The mechanics live in the architecture document (build and deploy loop).

## Self-construction

GAIA builds herself. The first thing she builds, in conversation with Paulo, is her own web panel. Paulo does not need a finished interface before starting: the interface is the first artifact she produces. In the early days he talks to her through a minimal channel (terminal or a simple endpoint), and her first real mission is to give herself a face. From there, new small projects are born the same way: Paulo describes an intent, the brain delegates the build to an arm, Paulo reviews and refines by talking to her. Publishing a project should feel trivial, not like an infra ceremony.

**[Added in review]** A concrete picture of the first milestone, so "done" is recognizable: Paulo opens a subdomain, authenticates, and talks to GAIA in a panel she built for herself, in a conversation she will remember tomorrow. Everything before that point is scaffolding; everything after it is growth.

## Learning

"Auto-learning" here means two concrete, mundane things, not emergent magic:

1. **Memory that accumulates.** GAIA writes down what is worth remembering (preferences, decisions, project state) and recalls it at the start of new conversations. This is what makes her feel like she knows Paulo over time.
2. **Periodic consolidation.** A scheduled job reads recent memory, summarizes it, and organizes it. This is the "loop that learns on its own" that never ran in the previous version, for a simple reason: nothing ever triggered it. Here the trigger is explicit.

## What GAIA is deliberately NOT (for now)

- **She is not autonomous in the world.** She does not act unprompted on external things. (What does she watch right now? Nothing.) She is turn-based: she acts when Paulo talks to her, plus a few scheduled internal jobs. Autonomous world-acting is a future possibility, not a current goal, and it is precisely the part that would demand the heavy security that has been pruned.
- **She is not wrapped in a heavy security architecture.** This is a conscious decision, explained next. Do not rebuild it.

## Security posture (read this before adding any security)

An earlier draft of this design explored a serious security architecture: multiple OS users separating "reading the outside world" from "acting with privilege," a structured-command gatekeeper with human approval, taint tracking, the works. That analysis was correct in theory and is worth keeping for the future, but it was deliberately pruned for this build.

The reasoning: single user, personal homelab, Paulo is always in the loop, and the blast radius is covered by regular backups. "The AI deleted something" is a scare, not a tragedy, when there are backups. The one security measure kept is that **GAIA runs as a non-root user, not root.** That single step gives most of the protection for almost no cost, and it bounds what she can reach when she (or an arm) makes a mistake.

Therefore, for this build: do not add a permission system, multi-user separation, an approval gateway, or sandboxing layers. If a real need for autonomous privileged action appears later, the chosen infrastructure (k3s) already has the hooks for it, noted in the architecture document. For now, keep it simple. Simplicity here is the correct engineering choice, not laziness.

**[Added in review]** Two things sit outside this pruning and are required by it, not despite it. First, the backups this posture leans on must actually exist, automated and off-VPS; the architecture document now specifies them, and until they run, the "scare, not tragedy" claim is not yet earned. Second, the public front door (the panel and any exposed endpoint) must require authentication. The pruning removed internal layers between components; it never meant leaving a code-executing, memory-holding system open on the public internet. Both are operational hygiene, defined in the architecture document, and neither licenses rebuilding the pruned machinery.

## Scope discipline

The failure mode of this kind of project is not technical difficulty, it is scope creep: the thing inflating until it becomes "rebuild Hermes." Build for the 10% Paulo actually uses. Every time a feature is tempting because "framework X has it," the question is "do I actually use this?" If the answer is no, do not build it. The same discipline applies to infrastructure: it is easy to spin things up, which also means it is easy to accumulate half-finished zombie projects. Resist that.

## Working style

Paulo directs and reviews; he delegates execution and reviews the result. The decisions captured here and in the architecture document were made deliberately, in conversation. Honor them rather than re-asking about them, but push back honestly on genuine technical disagreement. Paulo values direct, honest disagreement over validation, and prefers concrete numbers over vague descriptors.
