import type { QMeetingFollowUp } from "@capital-q/contracts";

/**
 * "How did it go?" (founder request 2026-10-02; PADL #130: Q works first,
 * the person confirms). After Q's notes are written, Q proposes what the
 * meeting seems to have led to, from the notes' own agreements and
 * follow-ups, and asks; nothing is recorded until the person says yes.
 *
 * What the lines led to is read by meaning (founder brief J7,
 * MEETING_OUTCOME_READER), never matched against phrase rules. When it is
 * not read, or reads as none, there is no proposal -- unknown stays
 * unknown, and Q just asks how it went. Never infers a pass: a decision
 * not to proceed is the investor's own to state.
 */

export type ProposedMeetingOutcome =
  "DILIGENCE" | "FOLLOW_UP_MEETING" | "MATERIALS_REQUESTED" | "INTRODUCTIONS";

/** The reading of a call's lines; null: not read. */
export type MeetingOutcomeReader = (
  lines: readonly string[],
) => Promise<ProposedMeetingOutcome | "NONE" | null>;

/** What the lines led to, by the reader; no reader or no reading: none. */
export async function proposeMeetingOutcome(
  notes: {
    readonly agreements: readonly string[];
    readonly followUps: readonly QMeetingFollowUp[];
  },
  reader: MeetingOutcomeReader | undefined,
): Promise<ProposedMeetingOutcome | null> {
  const said = [
    ...notes.agreements,
    ...notes.followUps.map((followUp) => followUp.text),
  ].filter((line) => line.trim().length > 0);
  if (said.length === 0 || reader === undefined) return null;
  const read = await reader(said).catch(() => null);
  return read === null || read === "NONE" ? null : read;
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

/**
 * Both questions from one record: the organiser's (from their own Q notes,
 * with what Q noted and was asked in the call) and the other side's, built
 * only from what both sides read -- the agreements. Context Firewall: the
 * organiser's private Q analysis never shapes the other side's question.
 */
export async function notesQuestions(
  input: {
    readonly agreements: readonly string[];
    readonly followUps: readonly QMeetingFollowUp[];
    readonly inCallProposals: number;
  },
  reader?: MeetingOutcomeReader,
): Promise<{ readonly organiser: string; readonly others: string }> {
  // Two readings side by side: the other side's from the shared lines only.
  const [mine, theirs] = await Promise.all([
    proposeMeetingOutcome(input, reader),
    proposeMeetingOutcome(
      { agreements: input.agreements, followUps: [] },
      reader,
    ),
  ]);
  return {
    organiser: howDidItGo({
      proposal: mine,
      followUps: input.followUps.length,
      inCallProposals: input.inCallProposals,
    }),
    others: howDidItGo({
      proposal: theirs,
      followUps: 0,
      inCallProposals: 0,
    }),
  };
}
