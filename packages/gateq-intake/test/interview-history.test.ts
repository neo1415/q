import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type {
  GatewayPolicy,
  PublicGateway,
  QualificationResult,
} from "@capital-q/gateq";
import type { GateQInterviewerResult } from "@capital-q/q-core";

import type {
  ApplicationFact,
  NewApplicationFact,
} from "../src/contracts/index.js";
import {
  createGateQInterviewer,
  type InterviewTurnInput,
} from "../src/application/interviewer.js";
import { contradictionsIn } from "../src/application/question-needs.js";

/**
 * The live run of 2026-11-13 (Kilima Angel Network <- Kazikit, application
 * 3ec9713b), replayed against the interviewer with the model scripted to
 * read each turn as the live model did. The store is simulated the way
 * postgres-intake-repositories records: a fact for a dimension supersedes
 * the current one, which is kept as history.
 */

const PUBLIC_GATEWAY: PublicGateway = {
  publicId: "gq_7aekqs9vfk8kvavm8k7tcacryn",
  organisationDisplayName: "Kilima Angel Network",
  title: "Operator-led angels, Nairobi",
  description: "Early-stage, alongside founders.",
  inboundMode: "QUALIFIED",
  acceptingApplications: true,
  criteria: [],
  publishedAt: "2026-11-01T12:00:00.000Z",
};

const base: GateQInterviewerResult = {
  reply: "Got it.",
  intent: "ANSWER",
  facts: [],
  asking: null,
  questionForQ: null,
  readyToReview: false,
  conflicts: [],
  readBackConfirmed: null,
};

function store() {
  const rows: ApplicationFact[] = [];
  const applicationId = randomUUID();
  return {
    rows,
    current: () => rows.filter((row) => row.supersededAt === null),
    record: (facts: readonly NewApplicationFact[], seq: number) => {
      for (const fact of facts) {
        const at = new Date(Date.UTC(2026, 10, 13, 23, 0, seq)).toISOString();
        for (const row of rows) {
          if (row.dimension === fact.dimension && row.supersededAt === null)
            (row as { supersededAt: string | null }).supersededAt = at;
        }
        rows.push({
          id: randomUUID() as ApplicationFact["id"],
          applicationId: applicationId as ApplicationFact["applicationId"],
          dimension: fact.dimension,
          value: fact.value,
          provenance: fact.provenance,
          recordedAt: at,
          supersededAt: null,
          sourceTurnSeq: seq,
        });
      }
    },
  };
}

async function say(
  facts: ApplicationFact[],
  utterance: string,
  read: Partial<GateQInterviewerResult>,
  recentTurns: InterviewTurnInput["recentTurns"] = [],
) {
  const execute = vi.fn(() =>
    Promise.resolve({
      output: { kind: "STRUCTURED", value: { ...base, ...read } },
    }),
  );
  return createGateQInterviewer({ gateway: { execute } as never }).turn({
    stage: "APPLICATION",
    channel: "text",
    publicGateway: PUBLIC_GATEWAY,
    utterance,
    recentTurns,
    tangents: 0,
    askedAlready: [],
    application: {
      policy: {
        gateway: { id: randomUUID() },
        version: { id: randomUUID() },
        criteria: [],
      } as unknown as GatewayPolicy,
      qualification: {
        criteria: [],
        unknowns: [],
        principalMismatches: [],
      } as unknown as QualificationResult,
      facts,
      documentProposals: [],
    },
    attribution: {
      tenantId: "c0000000-0000-4000-8000-00000000000a",
      correlationId: "f0000000-0000-4000-8000-000000000001",
    },
  });
}

const TURN_8 =
  "Since our September 2025 launch about 1,900 fundis have signed up and around 600 use Kazikit every week. We have no revenue yet.";
const TRACTION_8 =
  "Since the September 2025 launch, about 1,900 fundis have signed up and around 600 use Kazikit every week.";
const Q_9 =
  "Since launching in September 2025, you've had about 1,900 sign-ups and around 600 weekly users, with no revenue yet. So that's USD 0 for revenue, right?";
const TURN_10 =
  "Yes, zero revenue so far. Of our roughly 1,500 weekly users, about a third already send M-Pesa payment requests through the app, which is where we plan to charge.";
const TRACTION_10 =
  "Of roughly 1,500 weekly users, about a third already send M-Pesa payment requests through the app.";
const TURN_14 =
  "The fundi pays. We have not tested willingness to pay yet; that is the first thing the round answers.";
const TRACTION_14 =
  "Willingness to pay has not been tested; validating it is the first thing the round answers.";

const traction = (text: string, provenance = "APPLICANT_PROVIDED") => ({
  dimension: "claims.traction" as const,
  value: { kind: "TEXT" as const, text },
  provenance: provenance as "APPLICANT_PROVIDED" | "ESTIMATED",
  correction: false,
});

describe("traction keeps every statement; 600 against 1,500 stands, flagged (live D2)", () => {
  it("replays turns 8, 10 and 14 without losing a number or picking one", async () => {
    const s = store();

    const t8 = await say(s.current(), TURN_8, {
      facts: [traction(TRACTION_8, "ESTIMATED")],
    });
    s.record(t8.facts, 8);

    const t10 = await say(
      s.current(),
      TURN_10,
      {
        facts: [traction(TRACTION_10, "ESTIMATED")],
        // Q's reading of the turn: this disagrees with the 600 on record.
        conflicts: [
          {
            dimension: "claims.traction",
            earlier: "around 600 use Kazikit every week",
          },
        ],
        readBackConfirmed: true,
      },
      [
        { role: "person", text: TURN_8 },
        { role: "q", text: Q_9 },
      ],
    );
    s.record(t10.facts, 10);

    // An unrelated statement about the same dimension: no conflict.
    const t14 = await say(s.current(), TURN_14, {
      facts: [traction(TRACTION_14)],
    });
    s.record(t14.facts, 14);

    const now = s.current().find((f) => f.dimension === "claims.traction");
    if (now?.value.kind !== "TEXT") throw new Error("traction lost");
    // Every number the founder gave is still on the current record.
    expect(now.value.text).toContain("1,900");
    expect(now.value.text).toContain("600");
    expect(now.value.text).toContain("1,500");
    expect(now.value.text).toContain("Willingness to pay");
    // An estimate stays an estimate.
    expect(now.provenance).toBe("ESTIMATED");
    // The disagreement is carried, both sides, and shown to the investor
    // and to Q (which asks the founder to reconcile it).
    expect(now.value.unreconciled).toEqual([
      { earlier: TRACTION_8, later: TRACTION_10 },
    ]);
    const flagged = contradictionsIn(s.current());
    expect(flagged).toHaveLength(1);
    expect(flagged[0]).toContain("600");
    expect(flagged[0]).toContain("1,500");
    expect(flagged[0]).toContain("not yet reconciled");
    // And the history rows keep each statement as it was said.
    expect(
      s.rows.filter((r) => r.dimension === "claims.traction"),
    ).toHaveLength(3);
  });

  it("a correction replaces the statement and settles the flag (history kept)", async () => {
    const s = store();
    s.record(
      (await say(s.current(), TURN_8, { facts: [traction(TRACTION_8)] })).facts,
      8,
    );
    s.record(
      (
        await say(s.current(), TURN_10, {
          facts: [traction(TRACTION_10)],
          conflicts: [{ dimension: "claims.traction", earlier: null }],
        })
      ).facts,
      10,
    );
    expect(contradictionsIn(s.current())).toHaveLength(1);
    const settled = await say(
      s.current(),
      "Sorry, 600 is right: 600 weekly users.",
      {
        intent: "CORRECTION",
        facts: [
          {
            ...traction("About 600 fundis use Kazikit every week."),
            correction: true,
          },
        ],
      },
    );
    s.record(settled.facts, 21);
    const now = s.current().find((f) => f.dimension === "claims.traction");
    expect(now?.value).toEqual({
      kind: "TEXT",
      text: "About 600 fundis use Kazikit every week.",
    });
    expect(contradictionsIn(s.current())).toEqual([]);
    expect(
      s.rows.filter((r) => r.dimension === "claims.traction"),
    ).toHaveLength(3);
  });

  it("a quote the founder never said is not trusted; their recorded words stand in", async () => {
    const s = store();
    s.record(
      (await say(s.current(), TURN_8, { facts: [traction(TRACTION_8)] })).facts,
      8,
    );
    const t10 = await say(s.current(), TURN_10, {
      facts: [traction(TRACTION_10)],
      conflicts: [{ dimension: "claims.traction", earlier: "9,000 weekly" }],
    });
    const value = t10.facts[0]?.value;
    if (value?.kind !== "TEXT") throw new Error("expected text");
    expect(value.unreconciled?.[0]?.earlier).toBe(TRACTION_8);
  });

  it("the same statement again writes nothing", async () => {
    const s = store();
    s.record(
      (await say(s.current(), TURN_8, { facts: [traction(TRACTION_8)] })).facts,
      8,
    );
    const again = await say(s.current(), TURN_8, {
      facts: [traction(TRACTION_8)],
    });
    expect(again.facts).toEqual([]);
  });

  it("a contact detail is still replaced, not accumulated", async () => {
    const s = store();
    const name = (text: string) => ({
      dimension: "contact.name" as const,
      value: { kind: "TEXT" as const, text },
      provenance: "APPLICANT_PROVIDED" as const,
      correction: false,
    });
    s.record(
      (
        await say(s.current(), "I'm Grace Achieng.", {
          facts: [name("Grace Achieng")],
        })
      ).facts,
      2,
    );
    const changed = await say(s.current(), "Actually it's Grace Wanjiru.", {
      facts: [name("Grace Wanjiru")],
    });
    expect(changed.facts[0]?.value).toEqual({
      kind: "TEXT",
      text: "Grace Wanjiru",
    });
  });
});

describe("a yes with more said is a yes (live D3)", () => {
  const revenue = {
    dimension: "claims.revenue" as const,
    value: { kind: "AMOUNT" as const, amount: "0", currency: "USD" },
    provenance: "APPLICANT_PROVIDED" as const,
    correction: false,
  };

  it("records USD 0 from turn 10 and does not ask the same confirmation again", async () => {
    const s = store();
    const t10 = await say(
      s.current(),
      TURN_10,
      {
        reply:
          "Understood, zero revenue so far, and a third of weekly users already send M-Pesa requests. What will Kazikit charge for?",
        facts: [revenue, traction(TRACTION_10)],
        readBackConfirmed: true,
      },
      [
        { role: "person", text: TURN_8 },
        { role: "q", text: Q_9 },
      ],
    );
    expect(t10.facts.map((f) => [f.dimension, f.value])).toContainEqual([
      "claims.revenue",
      { kind: "AMOUNT", amount: "0", currency: "USD" },
    ]);
    expect(t10.notRecorded).toBeUndefined();
    expect(t10.reply).not.toMatch(/right\?$/u);
  });

  it("records the read-back even when the model proposes no fact for it", async () => {
    const t10 = await say([], TURN_10, { facts: [], readBackConfirmed: true }, [
      { role: "q", text: Q_9 },
    ]);
    expect(t10.facts).toContainEqual({
      dimension: "claims.revenue",
      value: { kind: "AMOUNT", amount: "0", currency: "USD" },
      provenance: "APPLICANT_PROVIDED",
    });
  });

  it("their 'no' (the reading says not confirmed) records nothing, whatever the words", async () => {
    const t = await say(
      [],
      "Yes, but it's 340k really.",
      { facts: [], readBackConfirmed: false, intent: "CORRECTION" },
      [{ role: "q", text: "So that's USD 360,000 for revenue, right?" }],
    );
    expect(t.facts).toEqual([]);
  });

  it("a confirmation of a figure Q never read back records nothing", async () => {
    const t = await say([], "Yes.", { facts: [], readBackConfirmed: true }, [
      { role: "q", text: "What will Kazikit charge for?" },
    ]);
    expect(t.facts).toEqual([]);
  });
});
