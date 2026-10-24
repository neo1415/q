import type {
  OnboardingCoverage,
  OnboardingCoverageField,
  OnboardingCoverageSource,
} from "@capital-q/contracts";
import { FOUNDER_DEFINITION_CURRENT } from "@capital-q/founder-onboarding/definition";
import { INVESTOR_DEFINITION_CURRENT } from "@capital-q/investor-onboarding/definition";

/**
 * The form's view of onboarding coverage (owner directive 2026-10-16, "Form
 * onboarding equally capable").
 *
 * The form keeps no list of fields and no idea of its own about what is
 * done: it renders lane ob1's canonical coverage, read from
 * `GET /v1/onboarding/sessions/:id/coverage` (the same projection Q reads,
 * with held saves, document types and registration facts the server
 * knows). So an answer given to Q shows here as on the record, and a value
 * Q only proposed shows as waiting for confirmation, never as saved.
 */

export type CoverageJourney = "founder" | "investor";

/** The journey's phases, in order, as the overview groups fields. */
export function phasesFor(
  journey: CoverageJourney,
): readonly { readonly phaseKey: string; readonly label: string }[] {
  return (
    journey === "founder" ? FOUNDER_DEFINITION_CURRENT : INVESTOR_DEFINITION_CURRENT
  ).schema.phases;
}

/**
 * A field's state in words. Meaning is never carried by colour alone
 * (CLAUDE.md UX rules), so every state has a word, and the words never call
 * an unconfirmed value saved or an unknown value zero.
 */
export function stateWords(field: OnboardingCoverageField): string {
  if (field.savePending) return "Confirmed · saving when Capital Q is back";
  switch (field.state) {
    case "KNOWN":
      return field.source === "REGISTRATION"
        ? "From your sign-up"
        : "Already known";
    case "CONFIRMED_SAVED":
      return "Saved";
    case "SUPPLIED_UNCONFIRMED":
      return "Waiting for you to confirm";
    case "MISSING":
      return "Still needed";
    case "CONTRADICTORY":
      return "Two answers disagree";
    case "INAPPLICABLE":
      return "Not needed on your path";
    case "EVIDENCE_NEEDED":
      return "Saved · a document would support it";
    case "DEFERRABLE":
      return field.declined ? "Set aside for later" : "Optional · can wait";
  }
}

const SOURCE_WORDS: Record<OnboardingCoverageSource, string> = {
  REGISTRATION: "your sign-up",
  JOURNEY_CHOICE: "the journey you chose",
  CANONICAL_RECORD: "your profile",
  FORM: "the form",
  CONVERSATION: "your conversation with Q",
  DOCUMENT: "a document you shared",
  PUBLIC_RESEARCH: "public information",
  Q_RECOMMENDATION: "Q's suggestion",
};

/** Where a value came from, as provenance words; never authority. */
export function sourceWords(source: OnboardingCoverageSource): string {
  return SOURCE_WORDS[source];
}

/**
 * The summary line under the progress bar. Remaining time is the
 * derivation's estimate, given only when something is still open.
 */
export function summaryWords(coverage: OnboardingCoverage): string {
  const { summary } = coverage;
  const parts = [
    `${String(summary.essentialSettled)} of ${String(summary.essentialTotal)} essentials in`,
  ];
  if (summary.unconfirmed > 0) {
    parts.push(`${String(summary.unconfirmed)} to confirm`);
  }
  if (summary.contradictory > 0) {
    parts.push(`${String(summary.contradictory)} to settle`);
  }
  if (summary.minutesLeft > 0) {
    parts.push(`about ${String(summary.minutesLeft)} min left`);
  }
  return parts.join(" · ");
}

/** Fields worth listing: everything on the person's path. */
export function visibleFields(
  coverage: OnboardingCoverage,
): readonly OnboardingCoverageField[] {
  return coverage.fields.filter((field) => field.applicable);
}
