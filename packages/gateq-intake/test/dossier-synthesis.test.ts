import { describe, expect, it, vi } from "vitest";

import {
  GateqSynthesisV1Schema,
  type GateqDossierV1,
  type GateqSynthesisV1,
} from "@capital-q/contracts";

import { acceptStructuredOutput } from "@capital-q/model-gateway";
import { GateqDossierSynthesisResultSchema } from "@capital-q/q-core";

import {
  citedSynthesis,
  createDossierSynthesis,
  gateqSynthesisMaxAttempts,
  gateqSynthesisRetryDelaySeconds,
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

describe("the mandate check names the facts it read (live check 2026-10-16)", () => {
  it("cites a location criterion to the country fact, not to stage or raise", () => {
    const COUNTRY = "6b1f0e5e-0000-4000-8000-000000000003";
    const STAGE = "6b1f0e5e-0000-4000-8000-000000000004";
    const RAISE = "6b1f0e5e-0000-4000-8000-000000000005";
    const fact = (dimension: string, sourceFactId: string) => ({
      dimension,
      label: dimension,
      summary: "x",
      provenance: "APPLICANT_PROVIDED" as const,
      sourceFactId,
      sourceTurnSeq: null,
      truthClass: "USER_CLAIM" as const,
      evidenceStatus: "SELF_REPORTED" as const,
    });
    const checked = {
      ...dossier,
      qualification: {
        ...dossier.qualification,
        criteria: [
          {
            label: "Where the company is based",
            requiredness: "REQUIRED",
            status: "NO_MATCH",
          },
          {
            label: "Stage we invest at",
            requiredness: "REQUIRED",
            status: "MATCH",
          },
          {
            label: "Our cheque size",
            requiredness: "REQUIRED",
            status: "MATCH",
          },
          {
            label: "Something else",
            requiredness: "PREFERRED",
            status: "UNKNOWN",
          },
        ],
      },
      dimensions: [
        {
          group: "COMPANY",
          label: "Company",
          facts: [
            fact("company.country", COUNTRY),
            fact("company.stage", STAGE),
            fact("raise.amount", RAISE),
          ],
        },
      ],
    } as unknown as GateqDossierV1;
    const { findings } = synthesisContext({ dossier: checked, transcript });
    expect(findings).toContain(
      `Where the company is based NO_MATCH (checked against sourceFactId=${COUNTRY})`,
    );
    expect(findings).toContain(
      `Stage we invest at MATCH (checked against sourceFactId=${STAGE})`,
    );
    expect(findings).toContain(
      `Our cheque size MATCH (checked against sourceFactId=${RAISE})`,
    );
    expect(findings).toContain("Something else UNKNOWN.");
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

describe("money in the dossier (live check 2026-10-16)", () => {
  it("reads as the currency and grouped digits, and still parses back, old format too", async () => {
    const { amountWords, amountOfSummary } =
      await import("../src/application/stated-amount.js");
    expect(amountWords("360000", "USD")).toBe("USD 360,000");
    expect(amountWords("1500000.50", "EUR")).toBe("EUR 1,500,000.50");
    expect(amountWords("950.00", "NGN")).toBe("NGN 950");
    expect(amountOfSummary("USD 360,000")).toEqual({
      amount: "360000",
      currency: "USD",
    });
    expect(amountOfSummary("360000 USD")).toEqual({
      amount: "360000",
      currency: "USD",
    });
    expect(amountOfSummary("USD 36,00")).toBeNull();
  });
});

describe("a reading that overflows its bounds (live D1, application 3ec9713b)", () => {
  const point = (n: number) => ({
    kind: "RISK",
    text: `Point ${String(n)}`,
    factIds: [FACT_REVENUE, FACT_TRACTION],
    turnSeqs: [6],
  });
  const answer = JSON.stringify({
    takeaway: "An early marketplace with founder-reported sign-ups.",
    points: Array.from({ length: 11 }, (_, i) => point(i + 1)),
  });

  it("was refused whole as points:too_big without list dropping", () => {
    const refused = acceptStructuredOutput(
      answer,
      GateqDossierSynthesisResultSchema,
    );
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.refusals?.some((r) => r.startsWith("points"))).toBe(true);
  });

  it("is kept, cut to its first nine points, with the job's options", async () => {
    const accepted = acceptStructuredOutput(
      answer,
      GateqDossierSynthesisResultSchema,
      { invalidListItems: "DROP" },
    );
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(accepted.value.points).toHaveLength(9);
    expect(accepted.value.points[0]?.text).toBe("Point 1");

    // The job asks the gateway for exactly that.
    const execute = vi.fn(() =>
      Promise.resolve({
        output: { kind: "STRUCTURED", value: accepted.value },
      }),
    );
    const s: SynthesisStore = {
      pending: () =>
        Promise.resolve([
          {
            applicationId: "3ec9713b-f060-428e-9cc7-abedd3e0e7cb",
            tenantId: "a27357f9-e431-4ed8-b6cf-c7f6a5498a1b",
            investorName: "Kilima Angel Network",
            dossier,
            transcript,
          },
        ]),
      claim: () => Promise.resolve(true),
      ready: () => Promise.resolve(),
    };
    const job = createDossierSynthesis({
      gateway: { execute } as never,
      store: s,
    });
    expect(await job.sweep(1)).toEqual({ ready: 1, failed: 0 });
    const options = (
      execute.mock.calls[0] as unknown as [
        unknown,
        { invalidListItems?: string },
      ]
    )[1];
    expect(options.invalidListItems).toBe("DROP");
  });
});

describe("bounded retry", () => {
  it("fails, is tried again later, and then records the reading", async () => {
    let attempts = 0;
    const recorded: GateqSynthesisV1[] = [];
    const s: SynthesisStore = {
      pending: () =>
        Promise.resolve(
          recorded.length > 0
            ? []
            : [
                {
                  applicationId: "9ac8e432-4108-4492-9ea5-eb9e1faaba20",
                  tenantId: "3965fb62-6225-48f2-8daf-480a8c6cb05b",
                  investorName: "Savanna Seed Partners",
                  dossier,
                  transcript,
                },
              ],
        ),
      claim: () => {
        attempts += 1;
        return Promise.resolve(
          attempts <= gateqSynthesisMaxAttempts(undefined),
        );
      },
      ready: (input) => {
        recorded.push(input.synthesis);
        return Promise.resolve();
      },
    };
    const execute = vi
      .fn()
      .mockRejectedValueOnce(new Error("provider timed out"))
      .mockResolvedValue({
        output: {
          kind: "STRUCTURED",
          value: {
            takeaway: "Founder-reported early traction.",
            points: [
              {
                kind: "QUESTION",
                text: "See the contracts",
                factIds: [],
                turnSeqs: [6],
              },
            ],
          },
        },
      });
    const job = createDossierSynthesis({
      gateway: { execute } as never,
      store: s,
    });
    expect(await job.sweep(1)).toEqual({ ready: 0, failed: 1 });
    expect(recorded).toEqual([]);
    expect(await job.sweep(1)).toEqual({ ready: 1, failed: 0 });
    expect(recorded).toHaveLength(1);
    expect(await job.sweep(1)).toEqual({ ready: 0, failed: 0 });
  });

  it("stops after its bound: no model call once the attempts are spent", async () => {
    const execute = vi.fn();
    const s: SynthesisStore = {
      pending: () =>
        Promise.resolve([
          {
            applicationId: "9ac8e432-4108-4492-9ea5-eb9e1faaba20",
            tenantId: "3965fb62-6225-48f2-8daf-480a8c6cb05b",
            investorName: "Savanna Seed Partners",
            dossier,
            transcript,
          },
        ]),
      // The store refuses a claim once the attempts are spent.
      claim: () => Promise.resolve(false),
      ready: () => Promise.resolve(),
    };
    const job = createDossierSynthesis({
      gateway: { execute } as never,
      store: s,
    });
    expect(await job.sweep(1)).toEqual({ ready: 0, failed: 1 });
    expect(execute).not.toHaveBeenCalled();
  });

  it("backs off: 10 minutes, then 20; bounded to three attempts by default", () => {
    expect(gateqSynthesisRetryDelaySeconds(1, 600)).toBe(600);
    expect(gateqSynthesisRetryDelaySeconds(2, 600)).toBe(1200);
    expect(gateqSynthesisRetryDelaySeconds(1, 5)).toBe(60);
    expect(gateqSynthesisMaxAttempts(undefined)).toBe(3);
    expect(gateqSynthesisMaxAttempts("2")).toBe(2);
    expect(gateqSynthesisMaxAttempts("9")).toBe(3);
  });
});
