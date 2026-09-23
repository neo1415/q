import { describe, expect, it } from "vitest";

import type { PresenceFinding } from "../src/contracts.js";
import {
  MANDATE_STEPS_NEVER_INFERRED,
  presenceCandidates,
} from "../src/domain/candidates.js";

/**
 * What the public web found, on its way to being offered (CQ-Q-PRESENCE-001).
 *
 * The regression these guard is the one that made the loop invisible: the
 * research ran, the understandings were held, and nothing was ever put in
 * front of the person to confirm or correct. A finding that cannot become
 * a pending suggestion is a finding nobody can refuse.
 */

function finding(
  key: PresenceFinding["key"],
  statement: string,
  sources: readonly { id: string; url: string; retrievedAt: string }[] = [
    {
      id: "11111111-1111-4111-8111-111111111111",
      url: "https://zinoaviation.com/about",
      retrievedAt: "2026-09-23T09:00:00.000Z",
    },
  ],
): PresenceFinding {
  return {
    key,
    statement,
    sources: sources.map((source) => ({
      evidenceSourceId: source.id,
      url: source.url,
      title: null,
      retrievedAt: source.retrievedAt,
    })),
  };
}

const NOTHING = new Set<string>();

describe("presenceCandidates", () => {
  it("offers what a company's own site says as a candidate on the description step, citing the page", () => {
    const reading = presenceCandidates({
      journeyType: "founder",
      subjectType: "COMPANY",
      findings: [
        finding(
          "presence.what_they_do",
          "Aviation training and consultancy for commercial operators.",
        ),
      ],
      answeredStepKeys: NOTHING,
      pendingStepKeys: NOTHING,
    });

    expect(reading.candidates).toHaveLength(1);
    const [candidate] = reading.candidates;
    expect(candidate?.stepKey).toBe("F1.description");
    expect(candidate?.suggestedValue).toEqual({
      type: "TEXT",
      text: "Aviation training and consultancy for commercial operators.",
    });
    // Provenance travels with the offer, or it is not evidence.
    expect(candidate?.sourceRefs).toEqual([
      {
        sourceType: "EVIDENCE_SOURCE",
        sourceId: "11111111-1111-4111-8111-111111111111",
      },
    ]);
    expect(candidate?.saying.domains).toEqual(["zinoaviation"]);
    expect(candidate?.saying.retrievedAt).toBe("2026-09-23T09:00:00.000Z");
    // A number Q invented would read as though it had been measured.
    expect(candidate?.confidence).toBeNull();
  });

  it("never proposes into a declared mandate step, whatever the web says", () => {
    const reading = presenceCandidates({
      journeyType: "investor",
      subjectType: "INVESTOR_ORGANISATION",
      findings: [
        finding(
          "presence.signal.stated_focus",
          "Backs early-stage logistics and mobility businesses across West Africa.",
        ),
        finding(
          "presence.what_they_do",
          "An aviation training and consultancy business.",
        ),
      ],
      answeredStepKeys: NOTHING,
      pendingStepKeys: NOTHING,
    });

    // Declared Mandate != Observed Behaviour != Q Inference. A page about a
    // firm may never fill in what that firm says it invests in.
    for (const candidate of reading.candidates) {
      expect(MANDATE_STEPS_NEVER_INFERRED).not.toContain(candidate.stepKey);
    }
    expect(reading.candidates).toHaveLength(0);
  });

  it("reports a missing public investment profile as absence, never as a candidate or a negative", () => {
    const reading = presenceCandidates({
      journeyType: "investor",
      subjectType: "PERSON",
      findings: [
        finding(
          "presence.what_they_do",
          "Runs an aviation training and consultancy business.",
        ),
      ],
      answeredStepKeys: NOTHING,
      pendingStepKeys: NOTHING,
    });

    expect(reading.absences).toEqual([
      {
        code: "NO_PUBLIC_INVESTMENT_PROFILE",
        stepKey: "I1.mandate_context",
      },
    ]);
    // Absence is something Q says, not something Q records.
    expect(
      reading.candidates.some((c) => c.stepKey === "I1.mandate_context"),
    ).toBe(false);
  });

  it("does not re-offer a step the person has already answered or already been asked about", () => {
    const findings = [
      finding("presence.what_they_do", "Aviation training and consultancy."),
    ];

    const answered = presenceCandidates({
      journeyType: "founder",
      subjectType: "COMPANY",
      findings,
      answeredStepKeys: new Set(["F1.description"]),
      pendingStepKeys: NOTHING,
    });
    expect(answered.candidates).toHaveLength(0);

    const alreadyPending = presenceCandidates({
      journeyType: "founder",
      subjectType: "COMPANY",
      findings,
      answeredStepKeys: NOTHING,
      pendingStepKeys: new Set(["F1.description"]),
    });
    expect(alreadyPending.candidates).toHaveLength(0);
  });

  it("drops a statement that does not fit the step rather than truncating it", () => {
    // I0.business_title asks for a role in 120 characters. Half a sentence
    // is a different claim, so it is not offered at all.
    const reading = presenceCandidates({
      journeyType: "investor",
      subjectType: "PERSON",
      findings: [finding("presence.what_they_do", "x".repeat(200))],
      answeredStepKeys: NOTHING,
      pendingStepKeys: NOTHING,
    });
    expect(reading.candidates).toHaveLength(0);
  });

  it("refuses to offer a finding that cites nothing", () => {
    const reading = presenceCandidates({
      journeyType: "founder",
      subjectType: "COMPANY",
      findings: [
        { key: "presence.what_they_do", statement: "Something.", sources: [] },
      ],
      answeredStepKeys: NOTHING,
      pendingStepKeys: NOTHING,
    });
    expect(reading.candidates).toHaveLength(0);
  });

  it("offers one candidate per step even when two pages say the same thing", () => {
    const reading = presenceCandidates({
      journeyType: "founder",
      subjectType: "COMPANY",
      findings: [
        finding("presence.what_they_do", "Aviation training."),
        finding("presence.self_description", "We train pilots."),
      ],
      answeredStepKeys: NOTHING,
      pendingStepKeys: NOTHING,
    });
    expect(reading.candidates).toHaveLength(1);
  });
});
