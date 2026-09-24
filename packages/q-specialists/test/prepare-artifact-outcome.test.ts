import { describe, expect, it } from "vitest";

import type { QAnswerRequest } from "@capital-q/q-runtime";

import type { CompanyIntelligenceResult } from "../src/company/contracts.js";
import {
  prepareOrReviseArtifact,
  type ArtifactPreparation,
} from "../src/company/prepare-artifact.js";

/**
 * A requested document ends in one of four ways, and the thin record is
 * not a failure (CQ-QX-005): "ask again in a moment" for a record with
 * nothing to write from sent people round a loop that could only fail the
 * same way ("Create an investor deck for my company", local, 2026-09-24).
 */

const deckAsk: NonNullable<CompanyIntelligenceResult["artifactRequest"]> = {
  kind: "PREPARE",
  artifactType: "PITCH_DECK",
  instruction: "Create an investor deck",
  visualDirection: null,
  quote: "Create an investor deck for my company.",
};

function result(
  overrides: Partial<CompanyIntelligenceResult>,
): CompanyIntelligenceResult {
  return {
    companyId: "c0000000-0000-4000-8000-000000000001",
    specialistVersion: "company-intelligence/v1",
    asOf: new Date().toISOString(),
    blocked: null,
    findings: [],
    coverage: [],
    materialChanges: [],
    contradictions: [],
    informationConfidence: "LOW",
    synthesis: null,
    research: null,
    recordedStatements: [],
    artifactRequest: deckAsk,
    telemetry: {} as CompanyIntelligenceResult["telemetry"],
    ...overrides,
  };
}

const refusingPort: ArtifactPreparation = {
  port: {
    prepare: () => Promise.reject(new Error("service down")),
    revise: () => Promise.reject(new Error("service down")),
    currentVersion: () => Promise.resolve(null),
  },
  reviser: {} as ArtifactPreparation["reviser"],
};

const request = {
  runId: "90000000-0000-4000-8000-000000000001",
} as unknown as QAnswerRequest;

describe("how a requested document ended", () => {
  it("is NOT_ASKED when nobody asked for one", async () => {
    const outcome = await prepareOrReviseArtifact({
      artifacts: refusingPort,
      request,
      company: {
        kind: "COMPANY",
        companyId: "c0000000-0000-4000-8000-000000000001",
      },
      companyName: "your company",
      saidVerbatim: "hello",
      result: result({ artifactRequest: null }),
      history: [],
    });
    expect(outcome).toEqual({ kind: "NOT_ASKED" });
  });

  it("is THIN_RECORD, not a failure, when there is nothing on record to write from", async () => {
    const outcome = await prepareOrReviseArtifact({
      artifacts: refusingPort,
      request,
      company: {
        kind: "COMPANY",
        companyId: "c0000000-0000-4000-8000-000000000001",
      },
      companyName: "your company",
      saidVerbatim: deckAsk.quote,
      result: result({}),
      history: [],
    });
    expect(outcome).toEqual({
      kind: "THIN_RECORD",
      artifactType: "PITCH_DECK",
    });
  });
});
