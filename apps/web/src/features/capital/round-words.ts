import type {
  CapitalRoundNotice,
  CapitalRoundStatus,
  CapitalRoundStep,
  ProRataRights,
} from "@capital-q/contracts";

/**
 * The words the Capital page uses for a round's lifecycle (plan P8). Status
 * is always text (and a shape), never colour alone.
 */

export const STATUS_WORDS: Readonly<Record<CapitalRoundStatus, string>> = {
  PLANNED: "Planned",
  OPEN: "Raising",
  FIRST_CLOSED: "First close done",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
};

export const STEP_WORDS: Readonly<Record<CapitalRoundStep, string>> = {
  OPEN: "Start raising",
  CLOSE: "Record a close",
  TRANCHE: "Record a tranche",
  FINAL_CLOSE: "Final close",
  REOPEN: "Reopen",
  CANCEL: "Cancel round",
};

/** What each step means, said once in the step's sheet. */
export const STEP_EXPLAINED: Readonly<Record<CapitalRoundStep, string>> = {
  OPEN: "The round becomes your current round and starts counting commitments.",
  CLOSE:
    "Money closed in this round: a first close, or a later close while you keep raising.",
  TRANCHE:
    "A tranche of committed money arrived, for example when a milestone was hit.",
  FINAL_CLOSE: "The round is done. What it raised stays on record.",
  REOPEN:
    "For an extension or a second close. Its earlier closes stay in its history.",
  CANCEL:
    "The round isn't happening. It stays in your history; commitments that named it stay on record.",
};

/** Friendly copy for each notice: what it means and what to do. */
export const NOTICE_WORDS: Readonly<Record<CapitalRoundNotice, string>> = {
  OVER_TARGET:
    "Oversubscribed: agreed money is above the target. Raise the target, set a hard cap, or decide who to cut back.",
  OVER_HARD_CAP:
    "Agreed money is above the hard cap. Talk to the investors before more is received.",
  OVERLAPS_OPEN_ROUND:
    "Another round is raising at the same time. Investors may ask which one their money goes to.",
  OTHER_CURRENCY:
    "Some commitments are in another currency. They're listed apart and aren't counted in this round's meter; nothing is converted.",
  CLOSED_EMPTY:
    "Closed with nothing received on Capital Q. If it raised money elsewhere, add the amount in its terms.",
  PAST_TARGET_CLOSE:
    "The target close date has passed. Move the date, record a close, or close the round.",
};

export const PRO_RATA_WORDS: Readonly<Record<ProRataRights, string>> = {
  NONE: "No pro-rata rights",
  MAJOR_INVESTORS: "Pro-rata for major investors",
  ALL: "Pro-rata for every investor",
};

/** Whether a status reads as "in progress" (a shape cue beside the word). */
export function isLive(status: CapitalRoundStatus): boolean {
  return status === "OPEN" || status === "FIRST_CLOSED";
}
