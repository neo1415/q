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
   * #4: what their words state is held, not saved, while its topic is
   * open, and played back for their yes when Q moves on ("Let me get this
   * right: … Is that right?"). Typed conversations: the voice line plays
   * back in its own words (its prompt) and saves as before.
   */
  readonly playbackBeforeSave: boolean;
  /** Owner Q1: code's explicit nones are saved at once and named in the playback. */
  readonly nonesImmediate: boolean;
  /** Owner Q2: identity facts (website, role, country) are played back with their topic. */
  readonly identityPlayedBack: boolean;
  /** Owner Q3: their answer to Q's "why" is kept as that topic's private note. */
  readonly whyAsNote: boolean;
};

export const CONVERSATIONAL_DEPTH: ConversationalDepth = {
  playbackBeforeSave: true,
  nonesImmediate: true,
  identityPlayedBack: true,
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
 * Phases one topic spans, as the profile shows them: an investor's
 * deployment goes with their cheques.
 */
const MERGED_PHASES: Readonly<Record<string, string>> = { I1: "I2" };

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
  return replay
    ? `Thanks. So: ${said}. Is that right?`
    : `Let me get this right: ${said}. Is that right?`;
}

/** Code's own playback line (first or replay). */
export function isPlaybackLine(line: string): boolean {
  return (
    /\b(Let me get this right:|Thanks\. So:)/u.test(line) &&
    /\bIs that right\?/u.test(line)
  );
}

/** A step whose choices are put to them to react to (D81 #3). */
export function offersChoices(stepKey: string): boolean {
  return /_strength$/u.test(stepKey) || stepKey === "I10.inbound_preference";
}
