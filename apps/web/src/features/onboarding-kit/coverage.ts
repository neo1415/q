import type {
  OnboardingCoverage,
  OnboardingCoverageField,
  OnboardingCoverageSource,
  OnboardingSessionView,
} from "@capital-q/contracts";
import {
  FOUNDER_COVERAGE_PROFILE,
  FOUNDER_DEFINITION_CURRENT,
} from "@capital-q/founder-onboarding/definition";
import {
  INVESTOR_COVERAGE_PROFILE,
  INVESTOR_DEFINITION_V1,
} from "@capital-q/investor-onboarding/definition";
import {
  deriveOnboardingCoverage,
  knownFactsFromRegistration,
} from "@capital-q/onboarding";

/**
 * The form's view of onboarding coverage (owner directive 2026-10-16, "Form
 * onboarding equally capable").
 *
 * The form does not keep its own list of fields or its own idea of what is
 * done: it renders lane ob1's canonical coverage, derived by the same pure
 * `deriveOnboardingCoverage` over the same published definition, the same
 * session view and the same registration facts Q uses. So an answer given to
 * Q shows here as on the record, and a value Q only proposed shows here as
 * waiting for confirmation, never as saved.
 *
 * Integration point: when ob1's `GET /v1/onboarding/sessions/:id/coverage`
 * ships, it adds what only the server knows (held saves, the subject's
 * document types, code checks). The form should then read that response in
 * place of `coverageFor`; the rendering below already handles every field.
 */

export type CoverageJourney = "founder" | "investor";

function setupFor(journey: CoverageJourney) {
  return journey === "founder"
    ? {
        profile: FOUNDER_COVERAGE_PROFILE,
        definition: FOUNDER_DEFINITION_CURRENT,
      }
    : {
        profile: INVESTOR_COVERAGE_PROFILE,
        definition: INVESTOR_DEFINITION_V1,
      };
}

export function coverageFor(input: {
  readonly journey: CoverageJourney;
  readonly view: OnboardingSessionView;
  /** The organisation typed at sign-up, for this journey (registration-defaults-for). */
  readonly registeredOrganisation: string | null;
  /** Plain labels for reference ids (taxonomy nodes) the view mentions. */
  readonly labels?: Readonly<Record<string, string>> | undefined;
  readonly now?: Date | undefined;
}): OnboardingCoverage {
  const { profile, definition } = setupFor(input.journey);
  const labels = input.labels ?? {};
  return deriveOnboardingCoverage({
    profile,
    definition,
    view: input.view,
    known: knownFactsFromRegistration(profile, {
      organisationName: input.registeredOrganisation,
    }),
    now: input.now ?? new Date(),
    labelFor: (_stepKey, value) => {
      if (value.type !== "RESOURCE_REFERENCE") return null;
      const words = value.resourceIds
        .map((id) => labels[id])
        .filter((label): label is string => label !== undefined);
      return words.length === value.resourceIds.length && words.length > 0
        ? words.join(", ")
        : null;
    },
  });
}

/** The journey's phases, in order, as the overview groups fields. */
export function phasesFor(
  journey: CoverageJourney,
): readonly { readonly phaseKey: string; readonly label: string }[] {
  return setupFor(journey).definition.schema.phases;
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
