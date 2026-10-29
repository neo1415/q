import { describe, expect, it } from "vitest";

import {
  claimsSection,
  matchClaims,
  measureOf,
  type CompanyClaim,
} from "../src/composition/workforce/claims.js";
import {
  heldBackGap,
  readDataRoom,
} from "../src/composition/workforce/diligence-memo.js";
import { ActorContextSchema } from "@capital-q/security";

/** Diligence audit 2026-10-28: claims vs evidence, by code. */

const claim = (statement: string): CompanyClaim => ({
  statement,
  source: "its record",
  truthClass: "USER_CLAIM",
  evidenceStatus: "SELF_REPORTED",
});
const fact = (statement: string, sourceIndex = 1) => ({
  statement,
  sourceIndex,
  domain: "press.example",
  asOf: null,
});

describe("measureOf", () => {
  it("reads money with its currency and scale, and counts", () => {
    expect(measureOf("ARR of $1.2 million in 2025")).toEqual({
      measure: "REVENUE",
      value: 1_200_000,
      currency: "USD",
      year: "2025",
    });
    expect(measureOf("It raised KES 40m in a seed round")).toMatchObject({
      measure: "FUNDING",
      value: 40_000_000,
      currency: "KES",
    });
    expect(measureOf("It serves 1,400 merchants")).toMatchObject({
      measure: "CUSTOMERS",
      value: 1_400,
      currency: null,
    });
    expect(measureOf("A great team with vision")).toBeNull();
  });
});

describe("matchClaims", () => {
  it("corroborates within 15%, contradicts beyond it, and shows both sides", () => {
    const rows = matchClaims({
      companyName: "Ledgerfold",
      claims: [
        claim("Ledgerfold's revenue was $1.2 million in 2025."),
        claim("Ledgerfold has 140 customers."),
      ],
      evidence: [
        fact("Ledgerfold reported revenue of $0.8 million in 2025.", 1),
        fact("Ledgerfold counts 150 customers.", 2),
      ],
    });
    expect(rows.map((row) => row.status)).toEqual([
      "CONTRADICTED",
      "CORROBORATED",
    ]);
    expect(rows[0]?.evidence[0]?.source).toBe("press.example [S1]");
  });

  it("never compares a market's figure, another currency or another year", () => {
    const rows = matchClaims({
      companyName: "Ledgerfold",
      claims: [
        claim("Ledgerfold's revenue was $1.2 million in 2025."),
        claim("Ledgerfold's revenue was €2 million."),
      ],
      evidence: [
        // Does not name the company: the market's, not Ledgerfold's.
        fact(
          "The bookkeeping software market had revenue of $9 million in 2025.",
        ),
        fact("Ledgerfold reported revenue of $0.4 million in 2023."),
      ],
    });
    expect(rows.map((row) => row.status)).toEqual(["UNVERIFIED", "UNVERIFIED"]);
    expect(rows[0]?.note).toBe(
      "Public figures found are for a different period.",
    );
  });

  it("keeps the record's own contradictions, every side labelled", () => {
    const rows = matchClaims({
      companyName: "Ledgerfold",
      claims: [],
      evidence: [],
      recordContradictions: [
        ["The deck says ARR is $1.2M.", "The FY26 model says ARR is $0.8M."],
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: "CONTRADICTED",
      claim: { statement: "The deck says ARR is $1.2M." },
      evidence: [{ statement: "The FY26 model says ARR is $0.8M." }],
    });
    const section = claimsSection(rows, "seed");
    expect(section.body).toContain("The deck says ARR is $1.2M.");
    expect(section.body).toContain("The FY26 model says ARR is $0.8M.");
    expect(section.findings[0]).toMatchObject({
      lifecycleStatus: "CONTRADICTORY",
      truthClass: "USER_CLAIM",
    });
  });

  it("says there was nothing to check rather than inventing a row", () => {
    expect(claimsSection([], "seed").body).toMatch(/nothing to check/u);
  });
});

describe("readDataRoom", () => {
  const actor = ActorContextSchema.parse({
    tenantId: "33333333-3333-4333-8333-333333333333",
    userId: "44444444-4444-4444-8444-444444444444",
    organisationId: "22222222-2222-4222-8222-222222222222",
    actorType: "HUMAN",
  });

  it("reads only documents open to the person, bounded, and counts the rest", async () => {
    const read: string[] = [];
    const room = await readDataRoom(
      {
        documents: () =>
          Promise.resolve(
            ["OPEN", "OWNER", "REQUESTABLE", "REQUESTED"].map((access, i) => ({
              documentId: `d${String(i)}`,
              title: `Doc ${String(i)}`,
              folder: "F",
              documentType: null,
              access: access as "OPEN",
              pageCount: null,
              updatedAt: "2026-10-01T00:00:00.000Z",
              opening: null,
            })),
          ),
        documentText: (_a, _c, id) => {
          read.push(id);
          return Promise.resolve({ text: "x".repeat(50_000), truncated: true });
        },
      },
      actor,
      "company",
    );
    expect(read).toEqual(["d0", "d1"]);
    expect(room.notOpen).toBe(2);
    expect(
      room.passages.reduce((sum, one) => sum + one.passage.length, 0),
    ).toBeLessThanOrEqual(6_000);
  });

  it("reads nothing when the data room cannot be read as them", async () => {
    const room = await readDataRoom(
      {
        documents: () => Promise.resolve(null),
        documentText: () => Promise.reject(new Error("never")),
      },
      actor,
      "company",
    );
    expect(room).toEqual({
      passages: [],
      notOpen: 0,
      available: false,
      heldBack: [],
    });
  });

  // Stress 2026-10-28 (F03): the founder's own room: the deck is read, the
  // highly confidential management accounts are named as held back and
  // never read, whoever may open them.
  it("never reads a held-back document, and names it", async () => {
    const read: string[] = [];
    const room = await readDataRoom(
      {
        documents: () =>
          Promise.resolve([
            {
              documentId: "deck",
              title: "LedgerBridge seed deck",
              folder: "F",
              documentType: "PITCH_DECK",
              access: "OWNER" as const,
              pageCount: 2,
              updatedAt: "2026-10-01T00:00:00.000Z",
              opening: null,
            },
            {
              documentId: "accounts",
              title: "LedgerBridge financial report Sept 2026",
              folder: "F",
              documentType: "MANAGEMENT_ACCOUNTS",
              access: "OWNER" as const,
              pageCount: 2,
              updatedAt: "2026-10-01T00:00:00.000Z",
              opening: null,
              heldBack: true,
            },
          ]),
        documentText: (_a, _c, id) => {
          read.push(id);
          return Promise.resolve({
            text: "Monthly recurring revenue: $65,000 (September 2026).",
            truncated: false,
          });
        },
      },
      actor,
      "company",
    );
    expect(read).toEqual(["deck"]);
    expect(room.heldBack).toEqual(["LedgerBridge financial report Sept 2026"]);
    expect(room.passages.map((one) => one.title)).toEqual([
      "LedgerBridge seed deck",
    ]);
    expect(
      heldBackGap("LedgerBridge financial report Sept 2026", true),
    ).toMatch(/held back from Q.*become usable once you confirm them/su);
  });
});
