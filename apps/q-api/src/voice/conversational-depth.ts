import { investorListThemeOf } from "@capital-q/investor-onboarding";

import { definitionFor } from "./interview-steps.js";

/**
 * Conversational depth (DECISIONS 81; design in
 * docs/specs/onboarding/CONVERSATIONAL-DEPTH.md): Q converses like a
 * skilled interviewer, in a professional register, never a form. What code
 * owns is here; the wording rules live in the prompts and the checklist.
 *
 * Each owner choice is one switch (integration, 8 Nov: "build so that each
 * is one switch"). Production runs CONVERSATIONAL_DEPTH; NO_DEPTH is the
 * behaviour before D81, which the tests that predate it keep.
 */
export type ConversationalDepth = {
  /**
   * #4, as D82 settles it (e2e run 9): what waits for their yes -- what Q
   * inferred or restated, a figure to read back -- is played back once per
   * topic, all of it together, when Q moves on ("Let me get this right:
   * … , is that right?"). A clear answer they typed saves at once in their
   * words (D77); never one value per question; a topic with one value
   * waiting joins the next playback or the final read-back. Typed
   * conversations: the voice line plays back in its own words.
   */
  readonly playbackBeforeSave: boolean;
  /** Owner Q1: code's explicit nones are saved at once and named in the playback. */
  readonly nonesImmediate: boolean;
  /**
   * Owner Q2, flipped by D82: identity facts held for the playback. Off:
   * they save at once (the firm's name comes first, and every other save
   * waits on it).
   */
  readonly identityPlayedBack: boolean;
  /** Owner Q3: their answer to Q's "why" is kept as that topic's private note. */
  readonly whyAsNote: boolean;
};

export const CONVERSATIONAL_DEPTH: ConversationalDepth = {
  playbackBeforeSave: true,
  nonesImmediate: true,
  // D82 (e2e run 9): the firm's name held for a playback left every save
  // that needs the firm refused; identity facts save at once.
  identityPlayedBack: false,
  whyAsNote: true,
};

export const NO_DEPTH: ConversationalDepth = {
  playbackBeforeSave: false,
  nonesImmediate: true,
  identityPlayedBack: false,
  whyAsNote: false,
};

/** Who they are and where: saved at once when identity is not played back. */
export const IDENTITY_STEPS: ReadonlySet<string> = new Set([
  "I0.investor_type",
  "I0.organisation_name",
  "I0.website",
  "I0.business_title",
  "I0.hq_country",
  "F1.company_name",
  "F1.website",
  "F1.country",
  "F1.city",
  "F4.founder_role",
]);

/**
 * Phases one topic spans. None today: e2e run 10's playback mixed whether
 * they are deploying with their cheque, two things to confirm apart.
 */
const MERGED_PHASES: Readonly<Record<string, string>> = {};

/**
 * The topic a step belongs to: its investor list theme, else its phase.
 * Null: not a step of this journey.
 */
export function topicOf(
  journey: "founder" | "investor",
  stepKey: string | null | undefined,
): string | null {
  if (stepKey === null || stepKey === undefined) return null;
  if (journey === "investor") {
    const theme = investorListThemeOf(stepKey);
    if (theme !== undefined) return `theme:${theme.key}`;
  }
  const step = definitionFor(journey).steps.find(
    (one) => one.stepKey === stepKey,
  );
  if (step === undefined) return null;
  const phase = step.configuration.phaseKey;
  if (phase === undefined) return null;
  return MERGED_PHASES[phase] ?? phase;
}

/** A value held from their own words (not research, not a document). */
export function heldFromTheirWords(rationale: string | null): boolean {
  return rationale !== null && /^From what you said\b/u.test(rationale);
}

/**
 * The playback of a topic, in labels and their values, never questions:
 * "Let me get this right: Role in a round: lead and co-invest; Typical
 * cheque: $500,000. Is that right?" A replay after a correction opens
 * "Thanks. So:".
 */
export function playbackLine(
  lines: readonly string[],
  replay: boolean,
): string {
  const said = lines
    .map((line) => line.trim().replace(/[.;\s]+$/u, ""))
    .filter((line) => line.length > 0)
    .join("; ");
  // One sentence that carries the values to the question (D82: never a
  // bare "Is that right?").
  return replay
    ? `Thanks. So: ${said}, is that right?`
    : `Let me get this right: ${said}, is that right?`;
}

/** Code's own playback line (first or replay). */
export function isPlaybackLine(line: string): boolean {
  return (
    /\b(Let me get this right:|Thanks\. So:)/u.test(line) &&
    /\bis that right\?/iu.test(line)
  );
}

/** A step whose choices are put to them to react to (D81 #3). */
export function offersChoices(stepKey: string): boolean {
  // The inbound question names its choices in words already (e2e run 10:
  // "…or nobody for now: Closed, Qualified or Open?").
  return /_strength$/u.test(stepKey);
}
