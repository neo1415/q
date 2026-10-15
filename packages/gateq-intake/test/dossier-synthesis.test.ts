import { describe, expect, it, vi } from "vitest";

import {
  GateqSynthesisV1Schema,
  type GateqDossierV1,
  type GateqSynthesisV1,
} from "@capital-q/contracts";

import {
  citedSynthesis,
  createDossierSynthesis,
  synthesisContext,
  type PendingSynthesis,
  type SynthesisStore,
} from "../src/application/dossier-synthesis.js";

/**
 * Q's reading of a GateQ submission (lead decision 2026-10-15). The model
 * is scripted: these cases are about what reaches it and what survives.
 */

const FACT_REVENUE = "6b1f0e5e-0000-4000-8000-000000000001";
const FACT_TRACTION = "6b1f0e5e-0000-4000-8000-000000000002";

const dossier: GateqDossierV1 = {
  schemaVersion: "gateq-dossier.v1",
  generatedAt: "2026-10-15T20:04:00.000Z",
  application: { reference: "ga_x", submittedAt: "2026-10-15T20:04:00.000Z" },
  company: {
    name: "TensorGate",
    description: "Enclave inference",
    website: null,
    country: "United States",
    stage: "Seed",
    sectorPhrases: ["Software"],
    note: null,
  },
  contact: {
    name: "Laura Mensah",
    role: "Founder",
    companyName: "Tensorgate",
    email: "laura.private@example.test",
    phone: "+1 555 0100",
    preferredChannel: "EMAIL",
    emailConfirmed: true,
    confirmedVia: "ACCOUNT",
  },
  qualification: {
    outcome: "QUALIFIED",
    access: "MAY_APPLY",
    criteria: [{ label: "Stage", requiredness: "REQUIRED", status: "MATCH" }],
  },
  dimensions: [
    {
      group: "TRACTION",
      label: "Traction and revenue",
      facts: [
        {
          dimension: "claims.revenue",
          label: "Revenue",
          summary: "360000 USD",
          provenance: "APPLICANT_PROVIDED",
          sourceFactId: FACT_REVENUE,
          sourceTurnSeq: 6,
          truthClass: "USER_CLAIM",
          evidenceStatus: "SELF_REPORTED",
        },
        {
          dimension: "claims.traction",
          label: "Traction",
          summary: "Two design partners pay $180,000 each",
          provenance: "APPLICANT_PROVIDED",
          sourceFactId: FACT_TRACTION,
          sourceTurnSeq: 6,
          truthClass: "USER_CLAIM",
          evidenceStatus: "SELF_REPORTED",
        },
      ],
    },
  ],
  unknowns: [],
  declined: [],
  missing: [],
  contradictions: [],
  documents: [],
  diligenceQuestions: [],
  transcript: { turnCount: 2 },
  synthesis: null,
} as unknown as GateqDossierV1;

const transcript = [
  { seq: 5, role: "Q", text: "Who pays?", at: "2026-10-15T20:01:00Z" },
  {
    seq: 6,
    role: "PERSON",
    text: "Two of them pay us on annual contracts of $180,000 each.",
    at: "2026-10-15T20:01:30Z",
  },
] as PendingSynthesis["transcript"];

describe("what Q reads", () => {
  it("only the frozen findings and transcript, with ids, and no contact details", () => {
    const context = synthesisContext({ dossier, transcript });
    expect(context.findings).toContain(`sourceFactId=${FACT_TRACTION}`);
    expect(context.transcript).toContain("turn 6 PERSON");
    expect(context.findings + context.transcript).not.toContain(
      "laura.private@example.test",
    );
    expect(context.findings + context.transcript).not.toContain("555 0100");
    // A computed figure reaches the model as Q's inference, not a claim.
    expect(context.findings).toMatch(/360000 USD \[truth=Q_INFERENCE/u);
  });
});

describe("what survives", () => {
  it("keeps only points that cite a real fact or turn, all as Q's inference", () => {
    const out = citedSynthesis(
      {
        takeaway: "Early, founder-reported traction in regulated AI.",
        points: [
          {
            kind: "STRENGTH",
            text: "Two paying design partners",
            factIds: [FACT_TRACTION, "not-a-fact"],
            turnSeqs: [6, 99],
          },
          {
            kind: "RISK",
            text: "Uncited worry",
            factIds: ["x"],
            turnSeqs: [42],
          },
        ],
      },
      synthesisContext({ dossier, transcript }),
      "2026-10-15T20:05:00.000Z",
    );
    expect(out.truthClass).toBe("Q_INFERENCE");
    expect(out.points).toEqual([
      {
        kind: "STRENGTH",
        text: "Two paying design partners",
        factIds: [FACT_TRACTION],
        turnSeqs: [6],
      },
    ]);
    expect(GateqSynthesisV1Schema.safeParse(out).success).toBe(true);
  });
});

describe("the job", () => {
  const pending: PendingSynthesis = {
    applicationId: "9ac8e432-4108-4492-9ea5-eb9e1faaba20",
    tenantId: "3965fb62-6225-48f2-8daf-480a8c6cb05b",
    investorName: "Savanna Seed Partners",
    dossier,
    transcript,
  };
  const store = (claimed: boolean) => {
    const recorded: GateqSynthesisV1[] = [];
    const s: SynthesisStore = {
      pending: vi.fn(() => Promise.resolve([pending])),
      claim: vi.fn(() => Promise.resolve(claimed)),
      ready: vi.fn((input: Parameters<SynthesisStore["ready"]>[0]) => {
        recorded.push(input.synthesis);
        return Promise.resolve();
      }),
    };
    return { s, recorded };
  };
  const gateway = (value: unknown) => ({
    execute: vi.fn(() =>
      Promise.resolve({ output: { kind: "STRUCTURED", value } }),
    ),
  });

  it("calls the gateway once, on EVIDENCE_SYNTHESIS, and records a cited reading", async () => {
    const { s, recorded } = store(true);
    const g = gateway({
      takeaway: "Founder-reported early traction.",
      points: [
        {
          kind: "QUESTION",
          text: "See the contracts",
          factIds: [],
          turnSeqs: [6],
        },
      ],
    });
    const job = createDossierSynthesis({ gateway: g as never, store: s });
    expect(await job.sweep(1)).toEqual({ ready: 1, failed: 0 });
    expect(g.execute).toHaveBeenCalledTimes(1);
    const request = (
      g.execute.mock.calls[0] as unknown as [
        {
          taskClass: string;
          sensitivity: string;
          messages: { content: string }[];
        },
      ]
    )[0];
    expect(request.taskClass).toBe("EVIDENCE_SYNTHESIS");
    expect(request.sensitivity).toBe("CONFIDENTIAL");
    expect(JSON.stringify(request.messages)).not.toContain(
      "laura.private@example.test",
    );
    expect(recorded[0]?.points[0]?.turnSeqs).toEqual([6]);
  });

  it("never calls the model for a reading another attempt holds", async () => {
    const { s } = store(false);
    const g = gateway({});
    const job = createDossierSynthesis({ gateway: g as never, store: s });
    expect(await job.sweep(1)).toEqual({ ready: 0, failed: 1 });
    expect(g.execute).not.toHaveBeenCalled();
  });

  it("a malformed answer is a failed attempt, never a recorded reading", async () => {
    const { s, recorded } = store(true);
    const job = createDossierSynthesis({
      gateway: gateway({ takeaway: "" }) as never,
      store: s,
    });
    expect(await job.sweep(1)).toEqual({ ready: 0, failed: 1 });
    expect(recorded).toEqual([]);
  });
});
