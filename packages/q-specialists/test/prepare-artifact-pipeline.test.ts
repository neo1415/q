import { describe, expect, it } from "vitest";

import type { QVisibleStage } from "@capital-q/contracts";
import type { QAnswerRequest } from "@capital-q/q-runtime";

import type {
  CompanyFinding,
  CompanyIntelligenceResult,
} from "../src/company/contracts.js";
import {
  prepareOrReviseArtifact,
  type ArtifactPreparation,
} from "../src/company/prepare-artifact.js";
import type { DocumentPipelinePort } from "../src/index.js";

/**
 * Q room W5 (R8): a deck (or one-pager, or memo) asked for in a run goes
 * to the worker as a job with the run's first draft; the run follows the
 * job's stages (the silence ladder speaks them) and answers with the card,
 * READY when the worker finished inside the wait, PREPARING otherwise.
 */

const COMPANY = "c0000000-0000-4000-8000-000000000001";
const ARTIFACT = "a1000000-0000-4000-8000-000000000001";

function finding(dimension: string, statement: string): CompanyFinding {
  return {
    findingId: `a0000000-0000-4000-8000-0000000000${String(dimension.length).padStart(2, "0")}`,
    type: "FACT",
    statement,
    truthClass: "USER_CLAIM",
    evidenceStatus: "SELF_REPORTED",
    confidence: "MODERATE",
    subjects: [{ kind: "COMPANY", companyId: COMPANY }],
    evidenceRefs: [],
    dimension,
    derivation: "MODEL",
  } as unknown as CompanyFinding;
}

function result(
  artifactType: "PITCH_DECK" | "ONE_PAGER" | "MEMO",
): CompanyIntelligenceResult {
  return {
    companyId: COMPANY,
    specialistVersion: "company-intelligence/v1",
    asOf: "2026-10-07T00:00:00.000Z",
    blocked: null,
    findings: [
      finding(
        "DESCRIPTION",
        "Northstar moves freight between Lagos and Abuja.",
      ),
      finding("PRODUCT", "The product is a mobile app for booking freight."),
      finding("TEAM", "Three founders, two former logistics operators."),
    ],
    coverage: [],
    materialChanges: [],
    contradictions: [],
    informationConfidence: "MODERATE",
    synthesis: null,
    research: null,
    recordedStatements: [],
    artifactRequest: {
      kind: "PREPARE",
      artifactType,
      instruction: "",
      visualDirection: null,
      quote: "Draft my deck",
    },
    telemetry: {} as CompanyIntelligenceResult["telemetry"],
  };
}

const request = {
  runId: "90000000-0000-4000-8000-000000000001",
  correlationId: "91000000-0000-4000-8000-000000000001",
  actor: {
    userId: "b0000000-0000-4000-8000-000000000001",
    tenantId: "c1000000-0000-4000-8000-000000000001",
    organisationId: "d0000000-0000-4000-8000-000000000001",
    actorType: "HUMAN",
  },
  plan: { maxSensitivity: "CONFIDENTIAL" },
} as unknown as QAnswerRequest;

function card(status: "PREPARING" | "READY") {
  return {
    artifactId: ARTIFACT,
    type: "PITCH_DECK",
    status,
    title: "Northstar — investor deck",
    currentVersion: status === "READY" ? 1 : 0,
  } as never;
}

function preparation(pipeline: DocumentPipelinePort): ArtifactPreparation {
  return {
    port: {
      prepare: () =>
        Promise.reject(new Error("the job path never prepares in the run")),
      revise: () => Promise.reject(new Error("not a revision")),
      currentVersion: () => Promise.resolve(null),
    },
    reviser: {} as ArtifactPreparation["reviser"],
    pipeline: { mode: "JOB", port: pipeline },
  };
}

describe("a document made by the worker", () => {
  it("queues the draft, says the job's stages, and answers with the filed card", async () => {
    const requested: Parameters<DocumentPipelinePort["request"]>[0][] = [];
    const shown: QVisibleStage[] = [];
    const outcome = await prepareOrReviseArtifact({
      artifacts: preparation({
        request: (input) => {
          requested.push(input);
          return Promise.resolve(card("PREPARING"));
        },
        wait: async ({ onStage }) => {
          for (const stage of [
            "DESIGNING",
            "FINDING_ASSETS",
            "CHECKING",
            "FIXING",
          ] as const) {
            await onStage(stage);
          }
          return card("READY");
        },
      }),
      request,
      company: { kind: "COMPANY", companyId: COMPANY },
      companyName: "Northstar",
      saidVerbatim: "Draft my deck",
      result: result("PITCH_DECK"),
      history: [],
      showStage: (stage) => {
        shown.push(stage);
        return Promise.resolve();
      },
    });
    expect(outcome).toMatchObject({
      kind: "PREPARED",
      summary: { status: "READY" },
    });
    expect(requested).toHaveLength(1);
    expect(requested[0]).toMatchObject({
      kind: "PITCH_DECK",
      artifactType: "PITCH_DECK",
      job: { sensitivity: "CONFIDENTIAL", directionChosen: false },
    });
    // The draft is the record's own words: grounding travels with it.
    expect(requested[0]?.job.grounding).toContain(
      "Northstar moves freight between Lagos and Abuja.",
    );
    expect(shown).toEqual([
      "PREPARING_DOCUMENT",
      "DESIGNING_DOCUMENT",
      "FINDING_DOCUMENT_IMAGES",
      "CHECKING_DOCUMENT",
      "CHECKING_DOCUMENT",
    ]);
  });

  it("the founder's own deck carries their round and its grounding; another company's deck never asks", async () => {
    const asked: string[] = [];
    const run = async (ownCompanyId: string) => {
      const requested: Parameters<DocumentPipelinePort["request"]>[0][] = [];
      const base = preparation({
        request: (input) => {
          requested.push(input);
          return Promise.resolve(card("PREPARING"));
        },
        wait: () => Promise.resolve(null),
      });
      await prepareOrReviseArtifact({
        artifacts: {
          ...base,
          studio: {
            brandOf: () => Promise.resolve(null),
            ownCompanyOf: () =>
              Promise.resolve({ companyId: ownCompanyId, sectorCodes: [] }),
            ownDeckFactsOf: (_actor, companyId) => {
              asked.push(companyId);
              return Promise.resolve({
                round: {
                  amount: "150000000",
                  currency: "NGN",
                  instrument: "SAFE",
                  name: null,
                  useOfFunds: "Hiring four engineers.",
                },
                team: [{ name: "Amaka Obi", role: "CEO", founder: true }],
              });
            },
          },
        },
        request,
        company: { kind: "COMPANY", companyId: COMPANY },
        companyName: "Northstar",
        saidVerbatim: "Draft my deck",
        result: result("PITCH_DECK"),
        history: [],
      });
      return requested[0];
    };
    const own = await run(COMPANY);
    expect(asked).toEqual([COMPANY]);
    expect(own?.job.grounding).toContain("We are raising ₦150m on a SAFE.");
    const slides = own?.content.content.deck?.slides ?? [];
    expect(slides.some((slide) => slide.title === "Raising ₦150m")).toBe(true);
    const other = await run("c0000000-0000-4000-8000-0000000000ff");
    expect(asked).toEqual([COMPANY]);
    expect(other?.job.grounding).not.toContain(
      "We are raising ₦150m on a SAFE.",
    );
  });

  it("still being made when the wait ends: the PREPARING card, not a failure", async () => {
    const outcome = await prepareOrReviseArtifact({
      artifacts: preparation({
        request: () => Promise.resolve(card("PREPARING")),
        wait: () => Promise.resolve(null),
      }),
      request,
      company: { kind: "COMPANY", companyId: COMPANY },
      companyName: "Northstar",
      saidVerbatim: "Draft my deck",
      result: result("PITCH_DECK"),
      history: [],
    });
    expect(outcome).toMatchObject({
      kind: "PREPARED",
      summary: { status: "PREPARING" },
    });
  });

  it("a one-pager goes the same way, as a document", async () => {
    const requested: Parameters<DocumentPipelinePort["request"]>[0][] = [];
    await prepareOrReviseArtifact({
      artifacts: preparation({
        request: (input) => {
          requested.push(input);
          return Promise.resolve(card("PREPARING"));
        },
        wait: () => Promise.resolve(null),
      }),
      request,
      company: { kind: "COMPANY", companyId: COMPANY },
      companyName: "Northstar",
      saidVerbatim: "Draft my deck",
      result: result("ONE_PAGER"),
      history: [],
    });
    expect(requested[0]?.kind).toBe("ONE_PAGER");
    expect(requested[0]?.content.title).toBe("Northstar — one-pager");
    expect(requested[0]?.content.content.deck).toBeUndefined();
  });
});
