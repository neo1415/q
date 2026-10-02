import type { QMeetingFollowUp } from "@capital-q/contracts";

/**
 * "How did it go?" (founder request 2026-10-02; PADL #130: Q works first,
 * the person confirms). After Q's notes are written, Q proposes what the
 * meeting seems to have led to, from the notes' own agreements and
 * follow-ups, and asks; nothing is recorded until the person says yes.
 *
 * Deterministic, never a model: plain phrases the notes already carry.
 * When nothing clearly matches, there is no proposal -- unknown stays
 * unknown, and Q just asks how it went. Never infers a pass: a decision
 * not to proceed is the investor's own to state.
 */

export type ProposedMeetingOutcome =
  "DILIGENCE" | "FOLLOW_UP_MEETING" | "MATERIALS_REQUESTED" | "INTRODUCTIONS";

/** Strongest first: diligence outranks another call, which outranks materials. */
const RULES: readonly {
  readonly outcome: ProposedMeetingOutcome;
  readonly pattern: RegExp;
}[] = [
  {
    outcome: "DILIGENCE",
    pattern:
      /\b(?:due diligence|diligence|data ?room|term sheet|investment committee|IC memo)\b/i,
  },
  {
    outcome: "FOLLOW_UP_MEETING",
    pattern:
      /\b(?:follow[- ]up (?:call|meeting)|next (?:call|meeting)|second (?:call|meeting)|meet again|another (?:call|meeting)|reconvene|catch up (?:again|next))\b/i,
  },
  {
    outcome: "MATERIALS_REQUESTED",
    pattern:
      /\b(?:send|share|provide)\b[^.]{0,40}\b(?:deck|financials?|model|metrics|materials|data|cap table|projections)\b/i,
  },
  {
    outcome: "INTRODUCTIONS",
    pattern: /\b(?:intro(?:duce|duction|s)?|connect (?:you|them) with)\b/i,
  },
];

export function proposeMeetingOutcome(notes: {
  readonly agreements: readonly string[];
  readonly followUps: readonly QMeetingFollowUp[];
}): ProposedMeetingOutcome | null {
  const said = [
    ...notes.agreements,
    ...notes.followUps.map((followUp) => followUp.text),
  ];
  for (const rule of RULES) {
    if (said.some((line) => rule.pattern.test(line))) return rule.outcome;
  }
  return null;
}

const PROPOSAL_WORDS: Readonly<Record<ProposedMeetingOutcome, string>> = {
  DILIGENCE: "next steps are diligence",
  FOLLOW_UP_MEETING: "you agreed to meet again",
  MATERIALS_REQUESTED: "materials were asked for",
  INTRODUCTIONS: "introductions are next",
};

/**
 * The question Q asks, in one line: the proposal when there is one, and
 * what Q noted to follow up (its own follow-ups and the proposals made to
 * it in the call), offered as reminders or drafts for approval.
 */
export function howDidItGo(input: {
  readonly proposal: ProposedMeetingOutcome | null;
  readonly followUps: number;
  readonly inCallProposals: number;
}): string {
  const ask =
    input.proposal === null
      ? "How did it go? Tell me what was agreed and I'll record it."
      : `How did it go? It sounded like ${PROPOSAL_WORDS[input.proposal]} — record that?`;
  const open = input.followUps + input.inCallProposals;
  const offer =
    open === 0
      ? ""
      : ` I noted ${String(open)} thing${open === 1 ? "" : "s"} to follow up; I can set reminders or draft the messages for you to approve.`;
  return `${ask}${offer}`;
}
