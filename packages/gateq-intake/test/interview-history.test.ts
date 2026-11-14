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
import {
  contradictionsForInterview,
  contradictionsIn,
  questionNeedsFor,
} from "../src/application/question-needs.js";
import { factSummary } from "../src/application/coverage.js";
import { statementsInWords } from "../src/application/fact-history.js";
import { profileOf } from "../src/inbox/domain.js";

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
        // Q's reading of the turn: this disagrees with the 600 on record.
        facts: [
          {
            ...traction(TRACTION_10, "ESTIMATED"),
            disagreesWith: "around 600 use Kazikit every week",
          },
        ],
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
          facts: [{ ...traction(TRACTION_10), disagreesWith: "600" }],
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
      facts: [{ ...traction(TRACTION_10), disagreesWith: "9,000 weekly" }],
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

/**
 * Live D2b (re-check 2026-11-14 on 985db1796, Kilima Angel Network <-
 * Branchari, application bf389feb, fictional parties). The rows below are
 * the production facts as they stood after turn 8 and the founder's words
 * at turns 10, 12 and 14, read by SQL from `gateq.application_facts` and
 * `gateq.application_turns`. Each later turn was read as traction NONE
 * (provenance UNKNOWN; turn 10 under the CORRECTION intent) and each
 * replaced the accumulated fact with an empty one.
 */
const BRANCHARI_TRACTION_8 = {
  kind: "TEXT" as const,
  text: [
    "running pilots with five SACCOs in Nakuru and Eldoret",
    "Across the five pilots the member app has 1,900 sign-ups and 600 weekly active.",
    "Of the five pilots, three asked about pricing.",
    "About 1,500 weekly active now on the member app.",
  ].join("\n"),
  unreconciled: [
    {
      earlier:
        "Across the five pilots the member app has 1,900 sign-ups and 600 weekly active.",
      later: "About 1,500 weekly active now on the member app.",
    },
  ],
};
const BRANCHARI_10 =
  "I'd need to check our dashboard; the two numbers came from different exports and I'm not sure which is right.";
const BRANCHARI_Q_11 =
  "Fair enough—let’s leave weekly active unresolved until you’ve checked the dashboard. Which export should we treat as authoritative: the one showing six hundred weekly active, or the one showing about one thousand five hundred?";
const BRANCHARI_12 = "I don't know yet.";
const BRANCHARI_14 =
  "Three people: I'm Zawadi Odhiambo, CEO, I spent eight years in SACCO operations; our CTO built lending systems at a Nairobi bank; and one engineer. Willingness to pay is not tested yet; that is what the paid conversions in this round will prove.";
const BRANCHARI_TEAM_14 =
  "Three people: Zawadi Odhiambo is CEO and spent eight years in SACCO operations; the CTO built lending systems at a Nairobi bank; and there is one engineer.";

const unknownTraction = (correction: boolean) => ({
  dimension: "claims.traction" as const,
  value: { kind: "NONE" as const },
  provenance: "UNKNOWN" as const,
  correction,
});

function branchariAfterTurn8() {
  const s = store();
  s.record(
    [
      {
        dimension: "claims.revenue",
        value: { kind: "AMOUNT", amount: "0", currency: "USD" },
        provenance: "APPLICANT_PROVIDED",
      },
    ],
    6,
  );
  s.record(
    [
      {
        dimension: "claims.traction",
        value: BRANCHARI_TRACTION_8,
        provenance: "ESTIMATED",
      },
    ],
    8,
  );
  return s;
}

describe("an unsure or unknown answer never empties what they said (live D2b)", () => {
  it.each([true, false])(
    "replays Branchari turns 10, 12 and 14 (turn 10 read as a correction: %s)",
    async (turn10Correction) => {
      const s = branchariAfterTurn8();

      const t10 = await say(s.current(), BRANCHARI_10, {
        intent: "CORRECTION",
        facts: [unknownTraction(turn10Correction)],
      });
      s.record(t10.facts, 10);
      expect(t10.facts).toEqual([]);

      const t12 = await say(
        s.current(),
        BRANCHARI_12,
        { intent: "UNKNOWN_OR_SKIP", facts: [unknownTraction(false)] },
        [
          { role: "person", text: BRANCHARI_10 },
          { role: "q", text: BRANCHARI_Q_11 },
        ],
      );
      s.record(t12.facts, 12);
      expect(t12.facts).toEqual([]);

      const t14 = await say(s.current(), BRANCHARI_14, {
        facts: [
          {
            dimension: "company.team",
            value: { kind: "TEXT", text: BRANCHARI_TEAM_14 },
            provenance: "APPLICANT_PROVIDED",
            correction: false,
          },
          unknownTraction(false),
        ],
      });
      s.record(t14.facts, 14);
      // The team answer is recorded; the unknown traction reading is not.
      expect(t14.facts.map((f) => f.dimension)).toEqual(["company.team"]);

      const now = s.current().find((f) => f.dimension === "claims.traction");
      // The very fact held after turn 8, untouched: same row, same words,
      // the 600 against 1,500 still unreconciled, no empty successor.
      expect(now?.sourceTurnSeq).toBe(8);
      expect(now?.value).toEqual(BRANCHARI_TRACTION_8);
      expect(now?.provenance).toBe("ESTIMATED");
      expect(
        s.rows.filter((r) => r.dimension === "claims.traction"),
      ).toHaveLength(1);
      const flagged = contradictionsIn(s.current());
      expect(flagged).toHaveLength(1);
      expect(flagged[0]).toContain("600");
      expect(flagged[0]).toContain("1,500");
    },
  );

  it("an explicit correction that states a value still replaces", async () => {
    const s = branchariAfterTurn8();
    const settled = await say(
      s.current(),
      "I checked: 1,500 weekly active is right.",
      {
        intent: "CORRECTION",
        facts: [
          {
            ...traction("About 1,500 weekly active on the member app."),
            correction: true,
          },
        ],
      },
    );
    s.record(settled.facts, 18);
    const now = s.current().find((f) => f.dimension === "claims.traction");
    expect(now?.value).toEqual({
      kind: "TEXT",
      text: "About 1,500 weekly active on the member app.",
    });
    expect(contradictionsIn(s.current())).toEqual([]);
    // History keeps the accumulated statements.
    expect(
      s.rows.filter((r) => r.dimension === "claims.traction"),
    ).toHaveLength(2);
  });

  it("an unknown answer with nothing on record is still recorded as unknown", async () => {
    const s = store();
    const t = await say(s.current(), BRANCHARI_12, {
      intent: "UNKNOWN_OR_SKIP",
      facts: [unknownTraction(false)],
    });
    expect(t.facts).toEqual([
      {
        dimension: "claims.traction",
        value: { kind: "NONE" },
        provenance: "UNKNOWN",
      },
    ]);
  });
});

describe("an accumulated text reads as sentences (live 2026-11-14)", () => {
  // Branchari's description as production holds it: two statements.
  const stored =
    "Core banking software for microfinance banks and credit unions in Kenya: Branchari licenses a cloud core with digital channels and regulatory reporting.\ncloud core banking for Kenyan microfinance banks and SACCOs; loan origination; repayments over M-Pesa; member app so borrowers can see balances and repay";
  const words =
    "Core banking software for microfinance banks and credit unions in Kenya: Branchari licenses a cloud core with digital channels and regulatory reporting. Cloud core banking for Kenyan microfinance banks and SACCOs; loan origination; repayments over M-Pesa; member app so borrowers can see balances and repay.";

  it("capitalises and stops each statement in review, dossier and brief", () => {
    expect(statementsInWords(stored)).toBe(words);
    expect(
      factSummary("company.description", { kind: "TEXT", text: stored }),
    ).toBe(words);
    expect(
      profileOf({
        declaredName: "Branchari",
        reference: "ga_x",
        facts: [
          {
            dimension: "company.description",
            value: { kind: "TEXT", text: stored },
            provenance: "APPLICANT_PROVIDED",
          },
        ],
        documentIds: [],
      }).oneLiner,
    ).toBe(words);
  });

  it("keeps a single statement exactly as said", () => {
    expect(statementsInWords("lower-case, no stop")).toBe(
      "lower-case, no stop",
    );
  });
});

/**
 * Live re-check 2026-11-14 (Kilima <- Routeix, application f21f0ddc), the
 * founder's words as stored (seq 4, 6, 8, 12). One weekly-active figure
 * disagrees with another; nothing else does.
 */
describe("live D10: only the statement that disagrees is paired (Routeix)", () => {
  const SEQ_4 =
    "Nobody pays yet: the pilots are free for six months. Across the pilots the driver app has 1,900 sign-ups, 600 weekly active.";
  const SEQ_6 =
    "Since the pilots began in May we went from 6 to 18 operators. We have about 1,500 weekly active now on the driver app.";
  const SEQ_8 =
    "I'd need to check our dashboard; the two numbers came from different exports and I'm not sure which is right.";
  const SEQ_12 =
    "Six people: I'm Achieng Mutua, CEO, I ran a fleet of forty trucks for eight years; Amani Kipchoge leads growth; and four engineers. Willingness to pay is not tested yet; converting pilots to paid plans is what this round will prove.";
  const T4 =
    "The pilots are free for six months; Across the pilots the driver app has 1,900 sign-ups; 600 weekly active";
  const GROWTH = "Since the pilots began in May we went from 6 to 18 operators.";
  const WEEKLY = "About 1,500 weekly active on the driver app.";
  const SUMMARY =
    "Since May, operator count grew from 6 to 18; weekly-active driver figure is unresolved because two exports showed different numbers.";
  const WTP =
    "Willingness to pay is not tested yet; converting pilots to paid plans is what this round will prove.";
  const CONFLICT = [
    { dimension: "claims.traction", earlier: "600 weekly active" },
  ];

  async function replay(marked: boolean) {
    const s = store();
    s.record(
      (await say(s.current(), SEQ_4, { facts: [traction(T4)] })).facts,
      4,
    );
    s.record(
      (
        await say(s.current(), SEQ_6, {
          facts: [
            traction(GROWTH),
            marked
              ? { ...traction(WEEKLY), disagreesWith: "600 weekly active" }
              : traction(WEEKLY),
          ],
          conflicts: CONFLICT,
        })
      ).facts,
      6,
    );
    // The live reading re-flagged the same pair on a summary line, and
    // again on willingness to pay.
    s.record(
      (
        await say(s.current(), SEQ_8, {
          intent: "UNKNOWN_OR_SKIP",
          facts: [traction(SUMMARY)],
          conflicts: CONFLICT,
        })
      ).facts,
      8,
    );
    s.record(
      (
        await say(s.current(), SEQ_12, {
          facts: [traction(WTP)],
          conflicts: CONFLICT,
        })
      ).facts,
      12,
    );
    return s;
  }

  it("one disagreement, every statement kept", async () => {
    const s = await replay(true);
    const now = s.current().find((f) => f.dimension === "claims.traction");
    if (now?.value.kind !== "TEXT") throw new Error("traction lost");
    // "6 to 18 operators" is no longer dropped by its own turn.
    for (const said of [T4, GROWTH, WEEKLY, SUMMARY, WTP])
      expect(now.value.text).toContain(said);
    expect(now.value.unreconciled).toHaveLength(1);
    expect(now.value.unreconciled?.[0]?.later).toBe(WEEKLY);
    expect(contradictionsIn(s.current())).toHaveLength(1);
  });

  it("a turn-level reading alone pairs nothing: it cannot say which statement disagrees", async () => {
    const s = store();
    s.record(
      (await say(s.current(), SEQ_4, { facts: [traction(T4)] })).facts,
      4,
    );
    const t6 = await say(s.current(), SEQ_6, {
      facts: [traction(GROWTH), traction(WEEKLY)],
      conflicts: CONFLICT,
    });
    expect(t6.facts).toHaveLength(1);
    const value = t6.facts[0]?.value;
    if (value?.kind !== "TEXT") throw new Error("expected text");
    expect(value.unreconciled ?? []).toEqual([]);
  });

  it("live D3: a disagreement already put to them is marked to leave open", async () => {
    const s = await replay(true);
    const asked = new Map([["claims.traction", 2]] as const);
    const lines = contradictionsForInterview(s.current(), asked);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/\(already asked; leave it open\)$/u);
    // Not yet asked about: put to them as it stands.
    expect(contradictionsForInterview(s.current())[0]).not.toContain(
      "already asked",
    );
  });

  it("live D3: never asks how many customers when traction already says", async () => {
    const s = await replay(true);
    const needs = questionNeedsFor({
      policy: { criteria: [] } as unknown as GatewayPolicy,
      qualification: {
        criteria: [],
        unknowns: [],
        principalMismatches: [],
      } as unknown as QualificationResult,
      facts: s.current(),
      limit: 20,
    });
    expect(needs.map((need) => need.dimension)).not.toContain(
      "company.customers",
    );
  });
});
