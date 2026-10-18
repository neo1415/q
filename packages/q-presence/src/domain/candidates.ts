import { domainLabel } from "./subject-match.js";

import type { PresenceFinding, PresenceSubjectType } from "../contracts.js";

/**
 * What a public finding may become in somebody's setup (CQ-Q-PRESENCE-001).
 *
 * The research already worked: pages were read, understandings were held,
 * provenance was recorded. What never happened was any of it reaching the
 * person. A finding that only exists in a knowledge table is a finding
 * nobody can confirm, correct or refuse, and an unconfirmable finding is
 * the one kind Capital Q must not act on.
 *
 * This is the mapping from what the web said to what Q may OFFER — the
 * same pending-suggestion mechanism a person's own sentence goes through,
 * not a second channel and not a research report. Pure and deterministic:
 * a finding in, a draft out, no model, no I/O, no store. The caller
 * persists it through the onboarding runtime, which validates it against
 * the real step and refuses anything that is not already a valid answer.
 *
 * Three rules it exists to keep.
 *
 * A finding is never truth. It is Q's reading of a cited public page, and
 * it stays a proposal until the person says yes. Nothing here writes, and
 * nothing here raises a finding's standing by restating it.
 *
 * A declared mandate is never inferred. What the public web says a firm
 * does is an observation about a public page; an investor's mandate is
 * something they declare. `Declared Mandate ≠ Observed Behaviour ≠ Q
 * Inference` is a locked invariant, so no finding may ever propose into a
 * mandate step — see MANDATE_STEPS_NEVER_INFERRED. This is why the
 * investor journey yields few candidates and a great deal of context, and
 * that is the correct shape, not a gap to be closed by loosening it.
 *
 * Absence stays absence. "No public investment profile" is something Q
 * could not find, not something it found to be false. It is reported as
 * context for Q to say, never as a candidate and never as a zero.
 */

/** Exactly what the onboarding runtime needs to hold a pending suggestion. */
export type PresenceCandidate = {
  readonly stepKey: string;
  readonly targetField: string;
  /** Already a valid answer to the step: the runtime re-validates it anyway. */
  readonly suggestedValue: { readonly type: "TEXT"; readonly text: string };
  /**
   * Where it came from, as the onboarding contract carries provenance.
   * `EVIDENCE_SOURCE` ids point at the rows the presence build registered
   * before any model was allowed to read the page.
   */
  readonly sourceRefs: readonly {
    readonly sourceType: string;
    readonly sourceId: string;
  }[];
  /**
   * Always null, deliberately.
   *
   * A presence finding's strength is the pages it cites, which are carried
   * above and can be read. A number here would be one Q invented, and an
   * invented confidence is worse than none: it survives into a UI as though
   * it had been measured.
   */
  readonly confidence: null;
  /** Everything Q needs to say this well, and nothing it needs to persist. */
  readonly saying: PresenceCandidateSaying;
};

/**
 * The parts of the sentence, so Q composes it and this does not.
 *
 * Deliberately not a sentence. Wording is the interviewer's, in Q's own
 * voice and register; handing it finished prose would put a second writer
 * in the conversation and the two would drift. What it cannot invent is
 * the provenance, so that is what this supplies.
 */
export type PresenceCandidateSaying = {
  /** The finding in the page's own terms, already bounded. */
  readonly statement: string;
  /** "zinoaviation.com" — for "I found ...", never a bare claim. */
  readonly domains: readonly string[];
  /** ISO 8601 UTC, most recent of the cited pages. */
  readonly retrievedAt: string;
  /** What this would fill in, so Q can ask about the right thing. */
  readonly stepKey: string;
};

/**
 * Something Q looked for under this subject and did not find.
 *
 * Not a candidate: there is nothing to accept. It is the half of the
 * reading that makes Q sound like an analyst rather than a scraper — "I
 * couldn't find a public investment profile, so I'll learn that from you"
 * — and it must never be recorded, ranked or counted as a negative.
 */
export type PresenceAbsence = {
  /** A stable code, so Q's wording is Q's and this does not fix it. */
  readonly code: PresenceAbsenceCode;
  /** The step Q would otherwise have had to cold-ask for. */
  readonly stepKey: string;
};

export const PRESENCE_ABSENCE_CODES = [
  /** Nothing public describes what the subject actually does. */
  "NO_PUBLIC_DESCRIPTION",
  /** Nothing public describes an investment mandate, strategy or portfolio. */
  "NO_PUBLIC_INVESTMENT_PROFILE",
] as const;
export type PresenceAbsenceCode = (typeof PRESENCE_ABSENCE_CODES)[number];

export type PresenceCandidateReading = {
  readonly candidates: readonly PresenceCandidate[];
  readonly absences: readonly PresenceAbsence[];
};

export type PresenceCandidateInput = {
  readonly journeyType: "founder" | "investor";
  readonly subjectType: PresenceSubjectType;
  readonly findings: readonly PresenceFinding[];
  /**
   * Steps the person has already answered.
   *
   * Q does not propose over an answer somebody gave. Their own word
   * outranks a page every time, and re-offering what they just said is the
   * behaviour that makes an assistant feel like it was not listening.
   */
  readonly answeredStepKeys: ReadonlySet<string>;
  /**
   * Steps that already carry a pending proposal.
   *
   * The build is asked for after every turn and the offer must not stack
   * up one suggestion per sentence on the same step.
   */
  readonly pendingStepKeys: ReadonlySet<string>;
};

/**
 * Mandate steps, which no reading of a public page may ever propose into.
 *
 * Locked invariant, not a policy choice: an investor's mandate is declared
 * by the investor. A firm's website saying it backs logistics is evidence
 * about a website. Filling a mandate from it would let observed behaviour
 * silently rewrite a declaration, which doc 19 makes release-blocking.
 */
export const MANDATE_STEPS_NEVER_INFERRED: readonly string[] = [
  "I1.deployment_status",
  "I1.mandate_context",
  "I2.stages",
  "I2.currency",
  "I2.cheque_min",
  "I2.cheque_typical",
  "I2.cheque_max",
  "I2.investment_role",
  "I3.geography",
  "I3.geography_strength",
  "I3.sectors",
  "I3.sector_strength",
  "I3.sectors_avoid",
];

/**
 * Which step a finding may fill, per journey and per subject.
 *
 * Narrow on purpose. A key maps to a step only where the page is genuinely
 * answering that step's question; everything else is context Q may say and
 * must not record. `maxLength` mirrors the published step configuration,
 * because a statement that does not fit is dropped rather than truncated —
 * half a sentence is a different claim, and the runtime would reject it
 * anyway.
 */
type CandidateTarget = {
  readonly stepKey: string;
  readonly targetField: string;
  readonly maxLength: number;
};

function targetFor(
  journeyType: "founder" | "investor",
  subjectType: PresenceSubjectType,
  key: PresenceFinding["key"],
): CandidateTarget | null {
  const describesTheSubject =
    key === "presence.what_they_do" || key === "presence.self_description";
  if (!describesTheSubject) return null;

  // A founder's company, described by its own site: exactly the question
  // F1.description asks, in the words the company chose for itself.
  if (journeyType === "founder" && subjectType === "COMPANY") {
    return {
      stepKey: "F1.description",
      targetField: "company.description",
      maxLength: 2_000,
    };
  }

  /**
   * An investor's own role, and only when it is short enough to be one.
   *
   * I0.business_title asks "your role there" in 120 characters. Most of
   * what a public page says about a person is a paragraph, and a paragraph
   * is not a title: it is dropped here and stays context Q can mention.
   * There is deliberately no organisation target — see
   * MANDATE_STEPS_NEVER_INFERRED.
   */
  if (journeyType === "investor" && subjectType === "PERSON") {
    return {
      stepKey: "I0.business_title",
      targetField: "investor.business_title",
      maxLength: 120,
    };
  }

  return null;
}

/** Whether anything found speaks to an investment mandate at all. */
function mentionsInvestmentProfile(
  findings: readonly PresenceFinding[],
): boolean {
  return findings.some(
    (finding) =>
      finding.key === "presence.signal.stated_focus" ||
      finding.key === "presence.milestone",
  );
}

/**
 * What a completed build may offer, and what it must only say.
 *
 * Deterministic and total: the same findings always give the same reading,
 * and nothing here can throw. Callers run it off the conversation's path.
 */
export function presenceCandidates(
  input: PresenceCandidateInput,
): PresenceCandidateReading {
  const { journeyType, subjectType, findings } = input;

  const candidates: PresenceCandidate[] = [];
  const claimedSteps = new Set<string>();

  for (const finding of findings) {
    const target = targetFor(journeyType, subjectType, finding.key);
    if (target === null) continue;
    if (MANDATE_STEPS_NEVER_INFERRED.includes(target.stepKey)) continue;
    if (input.answeredStepKeys.has(target.stepKey)) continue;
    if (input.pendingStepKeys.has(target.stepKey)) continue;
    // One offer per step per reading: two readings of the same page are
    // still one thing to decide about.
    if (claimedSteps.has(target.stepKey)) continue;

    const statement = finding.statement.trim();
    if (statement.length === 0 || statement.length > target.maxLength) {
      continue;
    }
    // The gate refuses an uncited proposal, so this should not happen; if
    // it ever does, an uncitable finding is not offered to anybody.
    if (finding.sources.length === 0) continue;

    claimedSteps.add(target.stepKey);
    candidates.push({
      stepKey: target.stepKey,
      targetField: target.targetField,
      suggestedValue: { type: "TEXT", text: statement },
      sourceRefs: finding.sources.map((source) => ({
        sourceType: "EVIDENCE_SOURCE",
        sourceId: source.evidenceSourceId,
      })),
      confidence: null,
      saying: {
        statement,
        domains: [
          ...new Set(
            finding.sources
              .map((source) => domainLabel(source.url))
              .filter((label): label is string => label !== null),
          ),
        ],
        retrievedAt: finding.sources
          .map((source) => source.retrievedAt)
          .sort()
          .slice(-1)[0] as string,
        stepKey: target.stepKey,
      },
    });
  }

  const absences: PresenceAbsence[] = [];
  /**
   * An investor whose public presence says nothing about investing.
   *
   * Common and unremarkable — somebody who has just started, or whose firm
   * is known for its operating business. Saying so is what turns a silent
   * search into an analyst's sentence, and it is why Q then asks rather
   * than assumes. It is never recorded.
   */
  if (
    journeyType === "investor" &&
    findings.length > 0 &&
    !mentionsInvestmentProfile(findings) &&
    !input.answeredStepKeys.has("I1.mandate_context")
  ) {
    absences.push({
      code: "NO_PUBLIC_INVESTMENT_PROFILE",
      stepKey: "I1.mandate_context",
    });
  }
  if (
    journeyType === "founder" &&
    findings.length === 0 &&
    !input.answeredStepKeys.has("F1.description")
  ) {
    absences.push({
      code: "NO_PUBLIC_DESCRIPTION",
      stepKey: "F1.description",
    });
  }

  return { candidates, absences };
}
