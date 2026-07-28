import type { ArmId } from "./types.ts";

/**
 * Routing v0, revised 2026-07-28 (ARCHITECTURE, Inference).
 *
 * Claude Code is the primary arm: while GAIA is being built, landing the change
 * matters more than what it costs. The cheap arm runs only when asked for by
 * name. Changing the default is meant to be exactly this one line.
 */
export const DEFAULT_ARM: ArmId = "claude-code";

export const routeTask = (requested: ArmId | undefined): ArmId => requested ?? DEFAULT_ARM;
