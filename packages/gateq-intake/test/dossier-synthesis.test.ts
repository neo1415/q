import { describe, expect, it, vi } from "vitest";

import {
  GateqSynthesisSchema,
  GateqSynthesisV2Schema,
  type GateqDossierV1,
  type GateqSynthesisV2,
} from "@capital-q/contracts";

import { acceptStructuredOutput } from "@capital-q/model-gateway";
import {
  GateqDossierSynthesisResultSchema,
  GateqDossierSynthesisResultV2Schema,
} from "@capital-q/q-core";

import {
  citedPoints,
  createDossierSynthesis,
  gateqSynthesisMaxAttempts,
  gateqSynthesisRetryDelaySeconds,
  synthesisContext,
  synthesisParts,
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

  describe("a long interview (decision 97: the latest corrections are never lost)", () => {
    // 300 turns of ~300 characters: far over one call's transcript budget.
    const long = Array.from({ length: 300 }, (_, i) => ({
      seq: i + 1,
      role: i % 2 === 0 ? ("Q" as const) : ("PERSON" as const),
      text:
        i === 299
          ? "Correction: revenue is USD 120,000, not 360,000."
          : `Turn ${String(i + 1)} ${"filler ".repeat(40)}`,
      at: "2026-10-15T20:01:00Z",
    }));

    it("shows the latest turn, and the turns facts cite, in the first part", () => {
      const context = synthesisContext({ dossier, transcript: long });
      expect(context.transcript).toContain(
        "Correction: revenue is USD 120,000",
      );
      // turn 6 is where both facts were heard, and turn 5 asked for it.
      expect(context.turnSeqs.has(6)).toBe(true);
      expect(context.turnSeqs.has(5)).toBe(true);
      // The model is told, in code's words, what it is not shown.
      expect(context.coverage).toMatch(/The interview has 300 turns/u);
      expect(context.coverage).toMatch(/turns are NOT shown here/u);
    });

    it("plans every turn into some part: nothing is left unread by design", () => {
      const plan = synthesisParts({ dossier, transcript: long });
      expect(plan.parts.length).toBeGreaterThan(1);
      const read = new Set(plan.parts.flatMap((part) => [...part.turnSeqs]));
      expect(read.size).toBe(300);
      // Every part can still cite the facts.
      for (const part of plan.parts)
        expect(part.factIds.has(FACT_TRACTION)).toBe(true);
    });

    it("reads the later parts and records coverage on the reading", async () => {
      const recorded: GateqSynthesisV2[] = [];
      let calls = 0;
      const execute = vi.fn(() =>
        Promise.resolve({
          output: {
            kind: "STRUCTURED",
            value: {
              takeaway: "Early.",
              points: [
                {
                  kind: "RISK",
                  text: `Point ${String((calls += 1))}`,
                  factIds: [FACT_TRACTION],
                  turnSeqs: [],
                },
              ],
            },
          },
        }),
      );
      const job = createDossierSynthesis({
        gateway: { execute } as never,
        store: {
          pending: () =>
            Promise.resolve([
              {
                applicationId: "9ac8e432-4108-4492-9ea5-eb9e1faaba20",
                tenantId: "3965fb62-6225-48f2-8daf-480a8c6cb05b",
                investorName: "Savanna Seed Partners",
                dossier,
                transcript: long,
              },
            ]),
          claim: () => Promise.resolve(true),
          ready: (input) => {
            recorded.push(input.synthesis);
            return Promise.resolve();
          },
        },
      });
      expect(await job.sweep(1)).toEqual({ ready: 1, failed: 0 });
      const parts = synthesisParts({ dossier, transcript: long }).parts.length;
      expect(execute).toHaveBeenCalledTimes(parts);
      expect(recorded[0]?.coverage).toMatchObject({
        turns: 300,
        turnsRead: 300,
        calls: parts,
      });
      expect(recorded[0]?.complete).toBe(true);
    });
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
    const out = citedPoints(
      GateqDossierSynthesisResultV2Schema.parse({
        takeaway: "Early, founder-reported traction in regulated AI.",
        points: [
          {
            kind: "STRENGTH",
            importance: "HIGH",
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
      }),
      synthesisContext({ dossier, transcript }),
    );
    expect(out.uncited).toBe(1);
    expect(out.points).toEqual([
      {
        kind: "STRENGTH",
        importance: "HIGH",
        text: "Two paying design partners",
        textClipped: false,
        factIds: [FACT_TRACTION],
        turnSeqs: [6],
      },
    ]);
  });

  it("keeps every citation a point made, not the first four", () => {
    const facts = Array.from(
      { length: 6 },
      (_, i) => `6b1f0e5e-0000-4000-8000-00000000010${String(i)}`,
    );
    const out = citedPoints(
      GateqDossierSynthesisResultV2Schema.parse({
        points: [
          {
            kind: "RISK",
            text: "Spread across many facts",
            factIds: facts,
            turnSeqs: [1, 2, 3, 4, 5, 6],
          },
        ],
      }),
      { factIds: new Set(facts), turnSeqs: new Set([1, 2, 3, 4, 5, 6]) },
    );
    expect(out.points[0]?.factIds).toHaveLength(6);
    expect(out.points[0]?.turnSeqs).toHaveLength(6);
  });
});

describe("stored readings: v1 rows stay readable beside v2", () => {
  it("accepts a v1 reading as written and a v2 reading with more than nine points", () => {
    expect(
      GateqSynthesisSchema.safeParse({
        schemaVersion: 1,
        generatedAt: "2026-10-15T20:05:00.000Z",
        truthClass: "Q_INFERENCE",
        takeaway: "Old reading",
        points: [
          { kind: "RISK", text: "x", factIds: [FACT_REVENUE], turnSeqs: [] },
        ],
      }).success,
    ).toBe(true);
    const v2: GateqSynthesisV2 = {
      schemaVersion: 2,
      generatedAt: "2026-11-14T10:00:00.000Z",
      truthClass: "Q_INFERENCE",
      takeaway: "New reading",
      points: Array.from({ length: 12 }, (_, i) => ({
        kind: "RISK" as const,
        importance: "MEDIUM" as const,
        text: `Point ${String(i + 1)}`,
        textClipped: false,
        factIds: [FACT_REVENUE],
        turnSeqs: [],
      })),
      complete: true,
      incomplete: null,
      uncitedDropped: 0,
      coverage: { facts: 2, turns: 2, turnsRead: 2, calls: 1 },
    };
    const parsed = GateqSynthesisSchema.safeParse(v2);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.points).toHaveLength(12);
    // complete and incomplete never disagree.
    expect(
      GateqSynthesisV2Schema.safeParse({ ...v2, complete: false }).success,
    ).toBe(false);
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
    const recorded: GateqSynthesisV2[] = [];
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
    expect(recorded[0]?.complete).toBe(true);
    expect(GateqSynthesisV2Schema.safeParse(recorded[0]).success).toBe(true);
  });

  it("stores all twelve points Q wrote, most important first (v1 kept nine)", async () => {
    const { s, recorded } = store(true);
    const g = gateway({
      takeaway: "Founder-reported early traction.",
      points: Array.from({ length: 12 }, (_, i) => ({
        kind: "RISK",
        importance: i === 11 ? "HIGH" : "LOW",
        text: `Point ${String(i + 1)}`,
        factIds: [FACT_TRACTION],
        turnSeqs: [],
      })),
    });
    const job = createDossierSynthesis({ gateway: g as never, store: s });
    expect(await job.sweep(1)).toEqual({ ready: 1, failed: 0 });
    const reading = recorded[0];
    expect(reading?.points).toHaveLength(12);
    expect(reading?.points[0]?.text).toBe("Point 12");
    expect(reading?.complete).toBe(true);
  });

  it("continues an answer that ran out of room, and never repeats a point", async () => {
    const { s, recorded } = store(true);
    const point = (n: number) => ({
      kind: "RISK",
      text: `Point ${String(n)}`,
      factIds: [FACT_TRACTION],
      turnSeqs: [],
    });
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        finish: "MAX_OUTPUT_TOKENS",
        output: {
          kind: "STRUCTURED",
          value: { takeaway: "Early.", points: [point(1), point(2)] },
          dropped: ["(cut-off):kept_2_items"],
        },
      })
      .mockResolvedValueOnce({
        finish: "COMPLETE",
        output: {
          kind: "STRUCTURED",
          value: { takeaway: "", points: [point(2), point(3)], more: false },
        },
      });
    const job = createDossierSynthesis({
      gateway: { execute } as never,
      store: s,
    });
    expect(await job.sweep(1)).toEqual({ ready: 1, failed: 0 });
    expect(execute).toHaveBeenCalledTimes(2);
    // The continuation is told what was already written.
    expect(JSON.stringify(execute.mock.calls[1])).toContain("Point 1");
    expect(recorded[0]?.points.map((p) => p.text)).toEqual([
      "Point 1",
      "Point 2",
      "Point 3",
    ]);
    expect(recorded[0]?.complete).toBe(true);
    expect(recorded[0]?.coverage.calls).toBe(2);
  });

  it("records an incomplete reading when the call budget ends with more to write", async () => {
    const { s, recorded } = store(true);
    let n = 0;
    const execute = vi.fn(() => {
      n += 1;
      return Promise.resolve({
        output: {
          kind: "STRUCTURED",
          value: {
            takeaway: "Early.",
            points: [
              {
                kind: "RISK",
                text: `Point ${String(n)}`,
                factIds: [FACT_TRACTION],
                turnSeqs: [],
              },
            ],
            more: true,
          },
        },
      });
    });
    const job = createDossierSynthesis({
      gateway: { execute } as never,
      store: s,
      budgets: { findingsChars: 32_000, transcriptChars: 32_000, calls: 3 },
    });
    expect(await job.sweep(1)).toEqual({ ready: 1, failed: 0 });
    expect(execute).toHaveBeenCalledTimes(3);
    expect(recorded[0]?.points).toHaveLength(3);
    expect(recorded[0]?.complete).toBe(false);
    expect(recorded[0]?.incomplete?.reason).toBe("OUTPUT_BUDGET");
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

  it("is kept whole by v2: all eleven points, with the job's options", async () => {
    const accepted = acceptStructuredOutput(
      answer,
      GateqDossierSynthesisResultV2Schema,
      { invalidListItems: "DROP" },
    );
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(accepted.value.points).toHaveLength(11);
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
    const recorded: GateqSynthesisV2[] = [];
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
