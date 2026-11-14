import { describe, expect, it } from "vitest";

import {
  QAccountDigestSchema,
  type QAccountDigest,
  type QAnswerCardsBlock,
} from "@capital-q/contracts";
import type { QToolPort } from "@capital-q/q-runtime";

import {
  ACCOUNT_DIGEST_BLOCK_MAX_CHARS,
  accountDigestBlock,
  exclusionLine,
  relationshipCounterparts,
  withoutExcludedCompanies,
} from "../src/q/account-digest.js";
import { fitSweepCardsBlock, fitSweepSummary } from "../src/q/fit-cards.js";
import { fitSweepAskOfReading, runFitSweep } from "../src/q/fit-sweep.js";
import {
  environmentNoteParts,
  situationWithAccount,
  SITUATION_WITH_ACCOUNT_MAX_CHARS,
} from "../src/q/index.js";
import { fitFixture } from "./fit-fixture.js";

/**
 * Owner 14 Nov 2026 (audit 2026-11-14 P0 #2, D1): every Q turn is told the
 * person's account digest beside the situation, and code lanes honour it.
 * Fixtures only; no model and no network.
 */

const ID = (n: number) =>
  `5c1d7a10-0b0e-4e7a-9a0c-${String(n).padStart(12, "0")}`;
const NOW = new Date("2026-11-14T21:20:00.000Z");
const ZONE = "Africa/Lagos";

function digestOf(overrides: Partial<QAccountDigest> = {}): QAccountDigest {
  return QAccountDigestSchema.parse({
    side: "INVESTOR",
    relationships: [
      {
        relationshipId: ID(101),
        counterpart: { kind: "COMPANY", id: ID(1), name: "Ledgerline" },
        stage: "CONNECTED",
        stageSince: "2026-11-10T09:00:00.000Z",
        nextStep: "SCHEDULE_MEETING",
        owed: "AWAITING_THEM",
        lastMessageAt: "2026-11-12T10:00:00.000Z",
      },
      {
        relationshipId: ID(102),
        counterpart: { kind: "COMPANY", id: ID(2), name: "Tensorgate" },
        stage: "CONNECTED",
        stageSince: "2026-11-09T09:00:00.000Z",
        nextStep: "SCHEDULE_MEETING",
        owed: "YOU_OWE_REPLY",
        lastMessageAt: "2026-11-13T15:00:00.000Z",
      },
    ].reverse(),
    relationshipsTotal: 3,
    byStage: { CONNECTED: 2, IN_DILIGENCE: 1 },
    relationshipCounterpartIds: [ID(1), ID(2), ID(3)],
    waiting: [
      {
        key: `msg:${ID(102)}:2026-11-13T15:00:00.000Z`,
        source: "UNANSWERED_MESSAGE",
        title: "Tensorgate is waiting for your reply",
        entity: { kind: "RELATIONSHIP", id: ID(102) },
        counterpart: "Tensorgate",
        since: "2026-11-13T15:00:00.000Z",
        decidable: true,
      },
      {
        key: `approval:${ID(201)}`,
        source: "APPROVAL",
        title: "Send the diligence request to Clinicrest",
        entity: { kind: "APPROVAL", id: ID(201) },
        since: "2026-11-14T08:00:00.000Z",
        decidable: true,
      },
    ],
    waitingTotal: 2,
    meetings: [
      {
        id: ID(301),
        relationshipId: ID(103),
        purpose: "Intro call",
        // 10:00 in Lagos on Sunday 15 Nov: tomorrow for them.
        startsAt: "2026-11-15T09:00:00.000Z",
        timeZone: ZONE,
        with: ["Ada Obi"],
        hasBrief: true,
      },
    ],
    work: [
      {
        id: ID(401),
        kind: "INVESTOR_OUTREACH",
        status: "ACTIVE",
        goal: "Reach three seed fintechs in Lagos",
        open: 2,
        updatedAt: "2026-11-14T07:00:00.000Z",
      },
    ],
    requests: [
      {
        relationshipId: ID(103),
        counterpart: "Clinicrest",
        direction: "FROM_YOU",
        open: ["Audited accounts 2025"],
        openCount: 1,
        answeredCount: 2,
      },
    ],
    gateq: {
      applications: [],
      applicationsTotal: 0,
      inbox: {
        gatewayName: "Savanna Seed",
        unread: 4,
        fits: 2,
        partial: 1,
        notAFit: 1,
        needsJudgement: 2,
        top: [
          {
            applicationId: ID(501),
            companyName: "Maji Loop",
            fit: "FITS",
            daysLeft: 2,
          },
        ],
      },
    },
    recent: [
      {
        at: "2026-11-13T15:00:00.000Z",
        text: "Tensorgate wrote to you",
        relationshipId: ID(102),
      },
    ],
    unread: [],
    readAt: NOW.toISOString(),
    ...overrides,
  });
}

describe("the account digest block every turn is told", () => {
  const block = accountDigestBlock({ digest: digestOf(), now: NOW, timeZone: ZONE });

  it("answers 'who should I follow up with' from the digest: the reply they owe first", () => {
    const tensor = block.indexOf("Tensorgate (company");
    const ledger = block.indexOf("Ledgerline (company");
    expect(tensor).toBeGreaterThan(0);
    expect(ledger).toBeGreaterThan(tensor);
    expect(block).toMatch(/Tensorgate \(company, connected since [^)]*; you owe them a reply \(they wrote 13 Nov\)/u);
    expect(block).toMatch(/Ledgerline [^[]*awaiting their reply/u);
    // Ids Q can cite and act on.
    expect(block).toContain(`[relationship ${ID(102)}]`);
  });

  it("answers 'what's waiting for me' from the digest", () => {
    expect(block).toContain("Waiting on them (2): Tensorgate is waiting for your reply");
    expect(block).toContain(`Send the diligence request to Clinicrest [approval ${ID(201)}]`);
    expect(block).toContain("their gateway Savanna Seed: 4 unread");
    expect(block).toContain("2 need their judgement");
  });

  it("answers 'any meetings tomorrow' from the digest, labelled in their own time", () => {
    expect(block).toMatch(/Sun 15 Nov, 10:00 \(tomorrow, Africa\/Lagos\): Intro call with Ada Obi \(brief ready\)/u);
    // Unknown zone: said in UTC, never passed off as theirs.
    const utc = accountDigestBlock({ digest: digestOf(), now: NOW, timeZone: null });
    expect(utc).toMatch(/Sun 15 Nov, 09:00 \(tomorrow, UTC\)/u);
  });

  it("says Q's work, requests and recent events, and never 'none' for an unread section", () => {
    expect(block).toContain("Reach three seed fintechs in Lagos (active, 2 open)");
    expect(block).toContain("you asked Clinicrest: 1 open, 2 answered");
    expect(block).toContain("Recent (last 3 days): 13 Nov: Tensorgate wrote to you");
    const unread = accountDigestBlock({
      digest: digestOf({ meetings: [], unread: ["MEETINGS"] }),
      now: NOW,
      timeZone: ZONE,
    });
    expect(unread).not.toContain("none booked");
    expect(unread).toContain("Could not be read just now: meetings");
    const empty = accountDigestBlock({
      digest: digestOf({ meetings: [] }),
      now: NOW,
      timeZone: ZONE,
    });
    expect(empty).toContain("Calls in the next 14 days: none booked.");
  });

  it("is bounded however large the account", () => {
    const many = digestOf({
      relationships: Array.from({ length: 12 }, (_, i) => ({
        relationshipId: ID(600 + i),
        counterpart: {
          kind: "COMPANY" as const,
          id: ID(700 + i),
          name: `A company with a rather long name number ${String(i)}`,
        },
        stage: "IN_DILIGENCE" as const,
        stageSince: "2026-11-01T09:00:00.000Z",
        nextStep: "DECIDE_NEXT_STEP" as const,
        owed: "YOU_OWE_REPLY" as const,
        lastMessageAt: "2026-11-13T15:00:00.000Z",
      })),
      relationshipsTotal: 180,
    });
    const big = accountDigestBlock({ digest: many, now: NOW, timeZone: ZONE });
    expect(big.length).toBeLessThanOrEqual(ACCOUNT_DIGEST_BLOCK_MAX_CHARS);
    expect(big).toMatch(/and \d+ more/u);
    const situation = situationWithAccount({
      header: "SITUATION (Capital Q, by code, this turn): x".padEnd(1_600, "x"),
      digest: many,
      now: NOW,
      timeZone: ZONE,
    });
    expect(situation.length).toBeLessThanOrEqual(SITUATION_WITH_ACCOUNT_MAX_CHARS);
  });

  it("is the same for a typed and a spoken turn, and is never cut from the notes", () => {
    const situation = situationWithAccount({
      header: "SITUATION (Capital Q, by code, this turn): Asking: Zino.",
      digest: digestOf(),
      now: NOW,
      timeZone: ZONE,
    });
    const typed = environmentNoteParts([], [], [], { situation });
    const spoken = environmentNoteParts([], [], [], { situation, spoken: true });
    const digestPart = accountDigestBlock({ digest: digestOf(), now: NOW, timeZone: ZONE });
    expect(typed.turn).toContain(digestPart);
    expect(spoken.turn).toContain(digestPart);
    expect(situationWithAccount({ header: "H", digest: null, now: NOW, timeZone: ZONE })).toBe("H");
  });
});

describe("the code check behind a stated exclusion (D1)", () => {
  const card = (n: number, name: string): QAnswerCardsBlock["cards"][number] => ({
    key: `c${String(n)}`,
    name,
    line: null,
    hue: 1,
    fit: null,
    reasons: ["On record"],
    measures: [],
    view: null,
    said: null,
    sourceCount: 0,
    subject: { kind: "COMPANY", companyId: ID(n) },
  });
  const block: QAnswerCardsBlock = {
    kind: "ANSWER_CARDS",
    shape: "RANKED",
    title: "Fit against your mandate",
    cards: [card(2, "Tensorgate"), card(9, "Kora"), card(1, "Ledgerline")],
    followUps: [],
  } as QAnswerCardsBlock;

  it("drops the companies they are in touch with and says so", () => {
    const inTouch = relationshipCounterparts(digestOf());
    const checked = withoutExcludedCompanies([block], inTouch);
    const kept = checked.blocks?.[0] as QAnswerCardsBlock;
    expect(kept.cards.map((c) => c.name)).toEqual(["Kora"]);
    expect(checked.dropped).toEqual(["Tensorgate", "Ledgerline"]);
    expect(exclusionLine(checked.dropped)).toBe(
      "I left out Tensorgate, Ledgerline: you're already in touch with those companies, and you asked me to leave those out.",
    );
  });

  it("removes a card set left empty and leaves other blocks alone", () => {
    const only = { ...block, cards: [card(2, "Tensorgate")] } as QAnswerCardsBlock;
    const checked = withoutExcludedCompanies([only], new Set([ID(2)]));
    expect(checked.blocks).toEqual([]);
    expect(withoutExcludedCompanies([block], new Set()).dropped).toEqual([]);
    expect(exclusionLine([])).toBeNull();
  });
});

/**
 * Replay of run bba40261's shape (14 Nov 21:27): an investor asked for the
 * strongest fits, leaving out companies already in contact with them. The
 * platform's top ten held three of their relationships, one of them
 * Tensorgate, whom Q had told them six minutes earlier they owe a reply.
 */
describe("bba40261 replay: fits leaving out the companies they are in touch with", () => {
  const NAMES = [
    "Tensorgate",
    "Ajopot",
    "Ledgerline",
    "Kora",
    "Clinicrest",
    "Nixo",
    "Halyard",
    "Savanna",
    "Clearwater",
    "Basketari",
  ];
  const RELATIONSHIPS = [ID(1), ID(3), ID(5)];
  const own = {
    side: "INVESTOR",
    relationships: RELATIONSHIPS.map((id) => ({
      counterpart: {
        kind: "COMPANY",
        id,
        name: NAMES[Number(id.slice(-2)) - 1],
      },
    })),
    saved: [],
  };
  const tools: Pick<QToolPort, "execute"> & { asked: unknown[] } = {
    asked: [],
    execute(proposal) {
      this.asked.push({ name: proposal.name, args: proposal.arguments });
      const base = {
        callId: proposal.callId,
        toolVersion: 1,
        classification: "READ_ONLY",
        status: "SUCCEEDED",
        failureCode: null,
        sensitivity: "CONFIDENTIAL",
        latencyMs: 1,
      } as const;
      const limit = Number(
        (proposal.arguments as Record<string, unknown>)["limit"] ?? 10,
      );
      const entries = NAMES.slice(0, Math.min(limit, 10)).map((name, i) => {
        const fit = fitFixture(
          ID(i + 1),
          name,
          { STAGE: "STRONG", SECTOR: "STRONG", GEOGRAPHY: "STRONG" },
          "STRONG_FIT",
        ).result.data as { name: string; profile: unknown };
        return { name: fit.name, line: null, profile: fit.profile };
      });
      return Promise.resolve({
        ...base,
        toolName: "fit.top_candidates",
        result: { ok: true, data: { status: "OK", comparison: { entries } } },
      } as never);
    },
  };

  it("the reading's excludeRelationships sweeps their candidates without their relationships", async () => {
    const asked =
      "Give me the strongest fits for my mandate, leaving out companies I'm already in contact with";
    const ask = fitSweepAskOfReading(
      { text: asked, count: null, excludeRelationships: true },
      [],
      [],
      [],
    );
    expect(ask).toMatchObject({
      scope: "CANDIDATES",
      excludeRelationships: true,
    });
    const result = await runFitSweep({
      ask,
      tools,
      context: {} as Parameters<typeof runFitSweep>[0]["context"],
      available: new Set(["fit_profile", "fit_top_candidates"]),
      own: Promise.resolve(own),
    });
    if (result === null) throw new Error("no sweep");
    const ids = result.fits.map((fit) => fit.companyId);
    expect(ids).not.toContain(ID(1)); // Tensorgate, who is owed a reply
    expect(ids.some((id) => RELATIONSHIPS.includes(id))).toBe(false);
    expect(ids).toHaveLength(7);
    expect([...result.excludedRelationships].sort()).toEqual([...RELATIONSHIPS].sort());
    const block = fitSweepCardsBlock(result.fits, "Fit against your mandate");
    if (block === null) throw new Error("no block");
    const said = fitSweepSummary({
      block,
      scope: result.ask.scope,
      place: null,
      considered: result.considered,
      asked,
    });
    expect(said).not.toMatch(/Tensorgate|Ledgerline|Clinicrest/u);
    // And the final check finds nothing left to drop.
    expect(
      withoutExcludedCompanies([block], relationshipCounterparts(digestOf({ relationshipCounterpartIds: RELATIONSHIPS }))).dropped,
    ).toEqual([]);
  });

  it("without the reading's exclusion, the plain ranking still adds their relationships (unchanged)", async () => {
    const ask = fitSweepAskOfReading({ text: "strongest fits", count: null }, [], [], []);
    expect(ask.excludeRelationships).toBeUndefined();
    const result = await runFitSweep({
      ask,
      tools,
      context: {} as Parameters<typeof runFitSweep>[0]["context"],
      available: new Set(["fit_profile", "fit_top_candidates"]),
      own: Promise.resolve(own),
    });
    expect(result?.fits.map((fit) => fit.companyId)).toContain(ID(1));
    expect(result?.excludedRelationships).toEqual([]);
  });
});
