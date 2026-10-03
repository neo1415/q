import { INSTRUCTION_AUTO_ELIGIBLE_ACTIONS } from "@capital-q/contracts";

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
