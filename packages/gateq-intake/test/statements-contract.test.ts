import { describe, expect, it } from "vitest";

import {
  ApplicationStatementSchema,
  ApplicationStatementViewSchema,
  DimensionViewSchema,
  DisagreementEventSchema,
  STATEMENTS_CONTRACT_VERSION,
  StatementLinkSchema,
  StatementValueSchema,
  TurnReadingSchema,
} from "../src/index.js";
import { projectView } from "../src/application/statement-view.js";

/**
 * The statement contracts (slice 1) hold the same rules as the
 * 20261231540000 table checks, so a bad row is refused before the database
 * and a row read back is known to satisfy them.
 */

const APPLICATION = "00000000-0000-4000-8000-000000000a01";
const TURN = "00000000-0000-4000-8000-0000000000f1";
const S1 = "00000000-0000-4000-8000-000000000001";
const S2 = "00000000-0000-4000-8000-000000000002";
const NOW = "2026-11-14T10:00:00.000Z";

const base = {
  id: S1,
  applicationId: APPLICATION,
  dimension: "claims.traction",
  quantity: "weekly_active_users",
  value: { kind: "COUNT", count: "1500" },
  asOf: "2026-11-01",
  words: "about 1,500 a week",
  provenance: "ESTIMATED",
  origin: "TURN",
  sourceTurnId: TURN,
  backfillKey: null,
  statedAt: NOW,
  recordedAt: NOW,
};

describe("statement contracts", () => {
  it("is versioned", () => {
    expect(STATEMENTS_CONTRACT_VERSION).toBe("gateq-statements.v1");
  });

  it("accepts a well-formed statement", () => {
    expect(ApplicationStatementSchema.safeParse(base).success).toBe(true);
  });

  it.each([
    ["an unknown dimension", { dimension: "claims.vibes" }],
    ["an unknown quantity", { quantity: "vibes" }],
    ["a quantity on prose", { value: { kind: "TEXT", text: "lots" } }],
    ["an UNKNOWN with a value provenance", { value: { kind: "UNKNOWN" } }],
    ["a value provenance on UNKNOWN", { provenance: "UNKNOWN" }],
    ["a turn statement with no turn", { sourceTurnId: null }],
    ["a form statement naming a turn", { origin: "FORM" }],
    ["a backfill key outside a backfill", { backfillKey: "fact:1" }],
    ["a backfill without a key", { origin: "BACKFILL" }],
    ["a malformed date", { asOf: "1 Nov" }],
    ["empty words", { words: "" }],
    ["an extra field", { reading: "x" }],
  ])("refuses %s", (_label, change) => {
    expect(
      ApplicationStatementSchema.safeParse({ ...base, ...change }).success,
    ).toBe(false);
  });

  it.each([
    [{ kind: "COUNT", count: "0" }, false],
    [{ kind: "MONEY", amount: "0.00", currency: "USD" }, false],
    [{ kind: "MONEY", amount: "1.5", currency: "usd" }, false],
    [{ kind: "MONEY", amount: "1.5", currency: null }, true],
    [{ kind: "ZERO" }, true],
    [{ kind: "ZERO", currency: "NGN" }, true],
    [{ kind: "UNKNOWN", declined: true }, true],
    [{ kind: "UNKNOWN", declined: false }, false],
    [{ kind: "PERCENT", percent: "-3.5" }, true],
    [{ kind: "TEXT", text: "x".repeat(2001) }, false],
  ])("value %j valid=%s", (value, valid) => {
    expect(StatementValueSchema.safeParse(value).success).toBe(valid);
  });

  it("refuses a self-link and an unattributed model link", () => {
    const link = {
      id: "00000000-0000-4000-8000-000000000101",
      applicationId: APPLICATION,
      kind: "DISAGREES",
      fromStatementId: S2,
      toStatementId: S1,
      origin: "MODEL_READING",
      sourceTurnId: TURN,
      createdAt: NOW,
    };
    expect(StatementLinkSchema.safeParse(link).success).toBe(true);
    expect(
      StatementLinkSchema.safeParse({ ...link, fromStatementId: S1 }).success,
    ).toBe(false);
    expect(
      StatementLinkSchema.safeParse({ ...link, sourceTurnId: null }).success,
    ).toBe(false);
    expect(
      StatementLinkSchema.safeParse({ ...link, kind: "REPLACES" }).success,
    ).toBe(false);
  });

  it("names a resolving statement exactly when a disagreement is resolved", () => {
    const event = {
      id: "00000000-0000-4000-8000-000000000201",
      applicationId: APPLICATION,
      linkId: "00000000-0000-4000-8000-000000000101",
      state: "RESOLVED",
      resolvedByStatementId: S1,
      sourceTurnId: null,
      recordedAt: NOW,
    };
    expect(DisagreementEventSchema.safeParse(event).success).toBe(true);
    expect(
      DisagreementEventSchema.safeParse({
        ...event,
        resolvedByStatementId: null,
      }).success,
    ).toBe(false);
    expect(
      DisagreementEventSchema.safeParse({ ...event, state: "LEFT_OPEN" })
        .success,
    ).toBe(false);
    expect(
      DisagreementEventSchema.safeParse({
        ...event,
        state: "OPEN",
        resolvedByStatementId: null,
      }).success,
    ).toBe(false);
  });

  it("ties READ to recorded statements and bounds what was not recorded", () => {
    const reading = {
      id: "00000000-0000-4000-8000-000000000301",
      applicationId: APPLICATION,
      turnId: TURN,
      outcome: "READ",
      recordedStatementIds: [S1],
      notRecorded: [
        {
          dimension: "raise.amount",
          words: "two pay 180k each",
          reason: "AMOUNT_READ_BACK",
        },
      ],
      readingVersion: 2,
      recordedAt: NOW,
    };
    expect(TurnReadingSchema.safeParse(reading).success).toBe(true);
    expect(
      TurnReadingSchema.safeParse({ ...reading, recordedStatementIds: [] })
        .success,
    ).toBe(false);
    expect(
      TurnReadingSchema.safeParse({ ...reading, outcome: "NO_STATEMENTS" })
        .success,
    ).toBe(false);
    expect(
      TurnReadingSchema.safeParse({
        ...reading,
        notRecorded: [{ dimension: null, words: "x", reason: "SHRUG" }],
      }).success,
    ).toBe(false);
    expect(
      TurnReadingSchema.safeParse({ ...reading, readingVersion: 0 }).success,
    ).toBe(false);
  });

  it("the projector's output satisfies the view contract", () => {
    const statement = ApplicationStatementSchema.parse(base);
    const view = projectView([statement], [], []);
    expect(ApplicationStatementViewSchema.parse(view)).toEqual(view);
    for (const dimension of view.dimensions)
      expect(DimensionViewSchema.safeParse(dimension).success).toBe(true);
  });
});
