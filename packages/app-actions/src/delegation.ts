import {
  INSTRUCTION_AUTO_ELIGIBLE_ACTIONS,
  type InstructionGrant,
} from "@capital-q/contracts";

import type { AnyAppAction } from "./define.js";

/**
 * Whether Q may ever take this declared action on its own under a standing
 * instruction (ADR 0043, founder decision 2026-10-03): only the founder's
 * short list (expressing interest, chat messages, booking times), and
 * never an action that carries terms, money or a commitment -- whatever a
 * grant says. Anything else is at most ASK: a card the person approves.
 */
export function delegableOnItsOwn(action: AnyAppAction): boolean {
  return (
    action.classification === "CONSEQUENTIAL" &&
    action.consequence === undefined &&
    (INSTRUCTION_AUTO_ELIGIBLE_ACTIONS as readonly string[]).includes(
      action.name,
    )
  );
}

/**
 * A grant as code allows it: actions that are not declared are dropped, and
 * AUTO on anything Q may not do alone becomes ASK. The proposer settles a
 * grant before the card is drawn, so the person approves what will really
 * happen; authorization refuses a grant that is not already settled.
 */
export function settleGrant(
  grant: InstructionGrant,
  actions: readonly AnyAppAction[],
): {
  readonly grant: InstructionGrant;
  readonly dropped: readonly string[];
  readonly askedInstead: readonly string[];
} {
  const byName = new Map(actions.map((action) => [action.name, action]));
  const dropped: string[] = [];
  const askedInstead: string[] = [];
  const seen = new Set<string>();
  const settled: InstructionGrant["actions"][number][] = [];
  for (const entry of grant.actions) {
    const declared = byName.get(entry.action);
    if (declared === undefined || declared.classification !== "CONSEQUENTIAL") {
      dropped.push(entry.action);
      continue;
    }
    if (seen.has(entry.action)) continue;
    seen.add(entry.action);
    if (entry.mode === "AUTO" && !delegableOnItsOwn(declared)) {
      askedInstead.push(entry.action);
      settled.push({ action: entry.action, mode: "ASK" });
      continue;
    }
    settled.push(entry);
  }
  return { grant: { ...grant, actions: settled }, dropped, askedInstead };
}
