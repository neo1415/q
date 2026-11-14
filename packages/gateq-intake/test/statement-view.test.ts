import { describe, expect, it } from "vitest";

import {
  generateGatewayPublicId,
  GatewayPolicySchema,
  QUALIFICATION_POLICY_VERSION,
  qualify,
} from "@capital-q/gateq";

import {
  ApplicationStatementSchema,
  DisagreementEventSchema,
  StatementLinkSchema,
  type ApplicationStatement,
  type DisagreementEvent,
  type StatementLink,
  type StatementValue,
} from "../src/contracts/statements.js";
import {
  ApplicationFactIdSchema,
  ApplicationIdSchema,
  type ApplicationDimension,
  type ApplicationFact,
} from "../src/contracts/index.js";
import { applicationProjection } from "../src/domain/projection.js";
import { fitBandOf, readQualification, rulesOf } from "../src/inbox/domain.js";
import {
  dimensionView,
  disputedFactsFor,
  legacyFactsFrom,
  mayAsk,
  projectView,
  questionStatus,
  StatementViewIntegrityError,
} from "../src/application/statement-view.js";

/**
 * GateQ atomic statements, slice 1: the projector's rules, the live defect
 * sequences D2b, D9, D10 and D11 expressed as statements, and a property
 * test that input order never changes the view.
 */

const APPLICATION = "00000000-0000-4000-8000-000000000a01";
const TURN = "00000000-0000-4000-8000-0000000000f1";
const uuid = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const at = (minute: number) =>
  `2026-11-14T10:${String(minute).padStart(2, "0")}:00.000Z`;

function statement(
  n: number,
  dimension: ApplicationDimension,
  value: StatementValue,
  options: {
    readonly minute: number;
    readonly quantity?: string | null;
    readonly asOf?: string | null;
    readonly words?: string;
    readonly origin?: "TURN" | "FORM" | "DOCUMENT_CONFIRMED" | "BACKFILL";
    readonly estimated?: boolean;
  },
): ApplicationStatement {
  const origin = options.origin ?? "TURN";
  return ApplicationStatementSchema.parse({
    id: uuid(n),
    applicationId: APPLICATION,
    dimension,
    quantity: options.quantity ?? null,
    value,
    asOf: options.asOf ?? null,
    words: options.words ?? `statement ${n}`,
    provenance:
      value.kind === "UNKNOWN"
        ? "UNKNOWN"
        : options.estimated === true
          ? "ESTIMATED"
          : "APPLICANT_PROVIDED",
    origin,
    sourceTurnId: origin === "FORM" ? null : TURN,
    backfillKey: origin === "BACKFILL" ? `fact:${n}` : null,
    statedAt: at(options.minute),
    recordedAt: at(options.minute),
  });
}

function link(
  n: number,
  kind: "CORRECTS" | "DISAGREES",
  from: number,
  to: number,
): StatementLink {
  return StatementLinkSchema.parse({
    id: uuid(n),
    applicationId: APPLICATION,
    kind,
    fromStatementId: uuid(from),
    toStatementId: uuid(to),
    origin: "MODEL_READING",
    sourceTurnId: TURN,
    createdAt: at(50),
  });
}

function event(
  n: number,
  linkN: number,
  state: "LEFT_OPEN" | "REOPENED" | "RESOLVED",
  minute: number,
  resolvedBy: number | null = null,
): DisagreementEvent {
  return DisagreementEventSchema.parse({
    id: uuid(n),
    applicationId: APPLICATION,
    linkId: uuid(linkN),
    state,
    resolvedByStatementId: resolvedBy === null ? null : uuid(resolvedBy),
    sourceTurnId: TURN,
    recordedAt: at(minute),
  });
}

const count = (value: number): StatementValue => ({
  kind: "COUNT",
  count: String(value),
});
const text = (value: string): StatementValue => ({ kind: "TEXT", text: value });
const unknown: StatementValue = { kind: "UNKNOWN" };
const ids = (items: readonly { statementId: string }[]) =>
  items.map((item) => item.statementId);

describe("projectView: the rules", () => {
  it("lists every dimension, UNANSWERED when nothing was said", () => {
    const view = projectView([], [], []);
    expect(view.dimensions.length).toBeGreaterThan(20);
    expect(view.dimensions.every((d) => d.status === "UNANSWERED")).toBe(true);
  });

  it("CORRECTS hides only its target, and keeps it as history", () => {
    const view = projectView(
      [
        statement(1, "company.problem", text("Payouts are slow."), {
          minute: 1,
        }),
        statement(2, "company.problem", text("Reconciliation is manual."), {
          minute: 2,
        }),
        statement(3, "company.problem", text("Payouts take a week."), {
          minute: 3,
        }),
      ],
      [link(101, "CORRECTS", 3, 1)],
      [],
    );
    const problem = dimensionView(view, "company.problem");
    expect(ids(problem.items)).toEqual([uuid(2), uuid(3)]);
    expect(problem.superseded).toEqual([
      expect.objectContaining({ supersededBy: uuid(3), via: "CORRECTION" }),
    ]);
    expect(problem.superseded[0]?.item.statementId).toBe(uuid(1));
    expect(problem.status).toBe("SETTLED");
  });

  it("follows a chain of corrections", () => {
    const view = projectView(
      [
        statement(
          1,
          "company.stage",
          { kind: "CODE", code: "pre_seed" },
          { minute: 1 },
        ),
        statement(
          2,
          "company.stage",
          { kind: "CODE", code: "seed" },
          { minute: 2 },
        ),
        statement(
          3,
          "company.stage",
          { kind: "CODE", code: "series_a" },
          { minute: 3 },
        ),
      ],
      [link(101, "CORRECTS", 2, 1), link(102, "CORRECTS", 3, 2)],
      [],
    );
    const stage = dimensionView(view, "company.stage");
    expect(ids(stage.items)).toEqual([uuid(3)]);
    expect(
      stage.superseded.map((s) => [s.item.statementId, s.supersededBy]),
    ).toEqual([
      [uuid(1), uuid(2)],
      [uuid(2), uuid(3)],
    ]);
  });

  it("UNKNOWN never hides a held value, even when linked as a correction", () => {
    const view = projectView(
      [
        statement(
          1,
          "claims.revenue",
          { kind: "MONEY", amount: "4000", currency: "USD" },
          {
            minute: 1,
            quantity: "mrr",
          },
        ),
        statement(2, "claims.revenue", unknown, {
          minute: 2,
          quantity: "mrr",
          words: "not sure",
        }),
      ],
      [link(101, "CORRECTS", 2, 1)],
      [],
    );
    const revenue = dimensionView(view, "claims.revenue");
    expect(ids(revenue.items)).toEqual([uuid(1), uuid(2)]);
    expect(revenue.superseded).toEqual([]);
    expect(revenue.status).toBe("SETTLED");
  });

  it("a held value does correct an earlier unknown", () => {
    const view = projectView(
      [
        statement(1, "company.country", unknown, { minute: 1 }),
        statement(
          2,
          "company.country",
          { kind: "CODE", code: "KE" },
          { minute: 2 },
        ),
      ],
      [link(101, "CORRECTS", 2, 1)],
      [],
    );
    expect(ids(dimensionView(view, "company.country").items)).toEqual([
      uuid(2),
    ]);
  });

  it("ZERO is a value; only-unknown is UNKNOWN, or DECLINED when refused", () => {
    const view = projectView(
      [
        statement(
          1,
          "claims.revenue",
          { kind: "ZERO" },
          { minute: 1, quantity: "revenue" },
        ),
        statement(2, "raise.amount", unknown, { minute: 2 }),
        statement(
          3,
          "company.team",
          { kind: "UNKNOWN", declined: true },
          { minute: 3 },
        ),
      ],
      [],
      [],
    );
    expect(dimensionView(view, "claims.revenue").status).toBe("ZERO");
    expect(dimensionView(view, "raise.amount").status).toBe("UNKNOWN");
    expect(dimensionView(view, "company.team").status).toBe("DECLINED");
  });

  it("DISAGREES keeps both until RESOLVED, and REOPENED brings both back", () => {
    const statements = [
      statement(1, "claims.traction", count(600), {
        minute: 1,
        quantity: "users",
      }),
      statement(2, "claims.traction", count(1500), {
        minute: 2,
        quantity: "users",
      }),
    ];
    const links = [link(101, "DISAGREES", 2, 1)];

    const open = dimensionView(
      projectView(statements, links, []),
      "claims.traction",
    );
    expect(ids(open.items)).toEqual([uuid(1), uuid(2)]);
    expect(open.status).toBe("DISAGREEMENT_OPEN");
    expect(open.disagreements).toEqual([
      expect.objectContaining({
        linkId: uuid(101),
        state: "OPEN",
        active: true,
      }),
    ]);

    const leftOpen = dimensionView(
      projectView(statements, links, [event(201, 101, "LEFT_OPEN", 10)]),
      "claims.traction",
    );
    expect(leftOpen.status).toBe("DISAGREEMENT_LEFT_OPEN");
    expect(ids(leftOpen.items)).toEqual([uuid(1), uuid(2)]);

    const resolved = dimensionView(
      projectView(statements, links, [
        event(201, 101, "LEFT_OPEN", 10),
        event(202, 101, "RESOLVED", 11, 1),
      ]),
      "claims.traction",
    );
    expect(ids(resolved.items)).toEqual([uuid(1)]);
    expect(resolved.superseded).toEqual([
      expect.objectContaining({ supersededBy: uuid(1), via: "RESOLUTION" }),
    ]);
    expect(resolved.disagreements[0]).toMatchObject({
      state: "RESOLVED",
      resolvedByStatementId: uuid(1),
      active: false,
    });
    expect(resolved.status).toBe("SETTLED");

    const reopened = dimensionView(
      projectView(statements, links, [
        event(201, 101, "LEFT_OPEN", 10),
        event(202, 101, "RESOLVED", 11, 1),
        event(203, 101, "REOPENED", 12),
      ]),
      "claims.traction",
    );
    expect(ids(reopened.items)).toEqual([uuid(1), uuid(2)]);
    expect(reopened.status).toBe("DISAGREEMENT_OPEN");
  });

  it("code detects a disagreement on the same quantity for what may be the same period", () => {
    const view = projectView(
      [
        statement(1, "claims.traction", count(600), {
          minute: 1,
          quantity: "weekly_active_users",
          asOf: "2026-11-01",
        }),
        statement(2, "claims.traction", count(1500), {
          minute: 2,
          quantity: "weekly_active_users",
          asOf: "2026-11-01",
        }),
        // Same number again: agreement, not a conflict.
        statement(3, "claims.traction", count(1500), {
          minute: 3,
          quantity: "weekly_active_users",
          asOf: "2026-11-01",
        }),
        // Live 2026-11-14: unknown dates are never assumed to be different
        // periods, so undated figures that differ are a disagreement.
        statement(4, "claims.traction", count(10), {
          minute: 4,
          quantity: "pilots",
        }),
        statement(5, "claims.traction", count(12), {
          minute: 5,
          quantity: "pilots",
        }),
        // Two different known dates are two periods: no disagreement.
        statement(6, "claims.traction", count(20), {
          minute: 6,
          quantity: "employees",
          asOf: "2026-10-01",
        }),
        statement(7, "claims.traction", count(25), {
          minute: 7,
          quantity: "employees",
          asOf: "2026-11-01",
        }),
      ],
      [],
      [],
    );
    const traction = dimensionView(view, "claims.traction");
    expect(traction.disagreements.map((d) => d.key)).toEqual([
      `code:${uuid(1)}:${uuid(2)}`,
      `code:${uuid(1)}:${uuid(3)}`,
      `code:${uuid(4)}:${uuid(5)}`,
    ]);
    expect(
      traction.disagreements.every((d) => d.origin === "CODE_DETECTED"),
    ).toBe(true);
    expect(traction.status).toBe("DISAGREEMENT_OPEN");
  });

  it("never re-detects a pair a stored link already relates", () => {
    const statements = [
      statement(1, "claims.traction", count(600), {
        minute: 1,
        quantity: "users",
        asOf: "2026-11-01",
      }),
      statement(2, "claims.traction", count(900), {
        minute: 2,
        quantity: "users",
        asOf: "2026-11-01",
      }),
    ];
    const view = projectView(
      statements,
      [link(101, "DISAGREES", 2, 1)],
      [event(201, 101, "LEFT_OPEN", 9)],
    );
    const traction = dimensionView(view, "claims.traction");
    expect(traction.disagreements).toHaveLength(1);
    expect(traction.status).toBe("DISAGREEMENT_LEFT_OPEN");
  });

  it("compares exact decimals, never floats", () => {
    const view = projectView(
      [
        statement(
          1,
          "claims.traction",
          { kind: "PERCENT", percent: "20" },
          {
            minute: 1,
            quantity: "growth_rate_monthly",
            asOf: "2026-11-01",
          },
        ),
        statement(
          2,
          "claims.traction",
          { kind: "PERCENT", percent: "20.00" },
          {
            minute: 2,
            quantity: "growth_rate_monthly",
            asOf: "2026-11-01",
          },
        ),
        // Beyond float precision: these differ by one.
        statement(
          3,
          "claims.traction",
          { kind: "COUNT", count: "9007199254740993" },
          {
            minute: 3,
            quantity: "transactions",
            asOf: "2026-11-01",
          },
        ),
        statement(
          4,
          "claims.traction",
          { kind: "COUNT", count: "9007199254740992" },
          {
            minute: 4,
            quantity: "transactions",
            asOf: "2026-11-01",
          },
        ),
      ],
      [],
      [],
    );
    expect(
      dimensionView(view, "claims.traction").disagreements.map((d) => d.key),
    ).toEqual([`code:${uuid(3)}:${uuid(4)}`]);
  });

  it("compares money only in one known currency, and zero against anything", () => {
    const money = (
      amount: string,
      currency: string | null,
    ): StatementValue => ({
      kind: "MONEY",
      amount,
      currency,
    });
    const view = projectView(
      [
        statement(1, "claims.revenue", money("5000", "USD"), {
          minute: 1,
          quantity: "mrr",
          asOf: "2026-10-01",
        }),
        statement(2, "claims.revenue", money("4000", "EUR"), {
          minute: 2,
          quantity: "mrr",
          asOf: "2026-10-01",
        }),
        statement(3, "claims.revenue", money("4500", null), {
          minute: 3,
          quantity: "mrr",
          asOf: "2026-10-01",
        }),
        statement(
          4,
          "claims.revenue",
          { kind: "ZERO" },
          { minute: 4, quantity: "arr", asOf: "2026-10-01" },
        ),
        statement(5, "claims.revenue", money("60000", "USD"), {
          minute: 5,
          quantity: "arr",
          asOf: "2026-10-01",
        }),
      ],
      [],
      [],
    );
    expect(
      dimensionView(view, "claims.revenue").disagreements.map((d) => d.key),
    ).toEqual([`code:${uuid(4)}:${uuid(5)}`]);
  });

  it("labels each item by its own source", () => {
    const view = projectView(
      [
        statement(1, "company.problem", text("a"), {
          minute: 1,
          origin: "FORM",
        }),
        statement(2, "company.problem", text("b"), {
          minute: 2,
          origin: "DOCUMENT_CONFIRMED",
        }),
        statement(3, "company.problem", text("c"), {
          minute: 3,
          origin: "BACKFILL",
        }),
        statement(4, "company.problem", text("d"), { minute: 4 }),
      ],
      [],
      [],
    );
    expect(
      dimensionView(view, "company.problem").items.map((i) => [
        i.sourceKind,
        i.backfilled,
      ]),
    ).toEqual([
      ["FORM", false],
      ["DOCUMENT", false],
      ["APPLICATION_STATEMENT", true],
      ["APPLICATION_STATEMENT", false],
    ]);
  });

  it("refuses a partial set rather than guessing", () => {
    const one = [statement(1, "company.problem", text("a"), { minute: 1 })];
    expect(() => projectView(one, [link(101, "CORRECTS", 2, 1)], [])).toThrow(
      StatementViewIntegrityError,
    );
    expect(() =>
      projectView(one, [], [event(201, 101, "LEFT_OPEN", 2)]),
    ).toThrow(StatementViewIntegrityError);
  });
});

describe("question status", () => {
  it("never asks again about SETTLED, ZERO, DECLINED or LEFT_OPEN", () => {
    for (const status of [
      "SETTLED",
      "ZERO",
      "DECLINED",
      "DISAGREEMENT_LEFT_OPEN",
    ] as const) {
      expect(mayAsk(status)).toBe(false);
      expect(questionStatus(status)).toBeNull();
    }
    expect(questionStatus("DISAGREEMENT_OPEN")).toBe("CONTRADICTION");
    expect(questionStatus("UNANSWERED")).toBe("UNANSWERED");
    expect(questionStatus("UNKNOWN")).toBe("UNKNOWN");
    expect(mayAsk("DISAGREEMENT_OPEN")).toBe(true);
  });
});

describe("live defect sequences, as statements", () => {
  it("D2b: later 'not tested' / 'don't know' never empty traction; the 600 vs 1,500 pair stays open", () => {
    const statements = [
      statement(1, "claims.traction", count(1900), {
        minute: 1,
        quantity: "users",
        words: "1,900 signed up",
      }),
      statement(2, "claims.traction", count(600), {
        minute: 2,
        quantity: "weekly_active_users",
        words: "600 use it weekly",
      }),
      statement(3, "claims.traction", count(1500), {
        minute: 3,
        quantity: "weekly_active_users",
        words: "about 1,500 weekly",
        estimated: true,
      }),
      statement(4, "claims.traction", unknown, {
        minute: 4,
        words: "not tested",
      }),
      statement(5, "claims.traction", unknown, {
        minute: 5,
        words: "I don't know",
      }),
    ];
    const view = projectView(
      statements,
      [link(101, "DISAGREES", 3, 2), link(102, "CORRECTS", 4, 3)],
      [],
    );
    const traction = dimensionView(view, "claims.traction");
    expect(ids(traction.items)).toEqual([
      uuid(1),
      uuid(2),
      uuid(3),
      uuid(4),
      uuid(5),
    ]);
    expect(traction.status).toBe("DISAGREEMENT_OPEN");
    const { facts } = legacyFactsFrom(view);
    const fact = facts.find((f) => f.dimension === "claims.traction");
    expect(fact?.value).toEqual({
      kind: "TEXT",
      text: "1,900 signed up\n600 use it weekly\nabout 1,500 weekly\nnot tested\nI don't know",
      unreconciled: [
        { earlier: "600 use it weekly", later: "about 1,500 weekly" },
      ],
    });
  });

  it("D9: a stated zero stays a zero, and a later 'don't know' does not undo it", () => {
    const view = projectView(
      [
        statement(
          1,
          "claims.revenue",
          { kind: "ZERO" },
          { minute: 1, quantity: "revenue", words: "nobody pays yet" },
        ),
        statement(2, "claims.revenue", unknown, {
          minute: 2,
          quantity: "revenue",
          words: "don't know",
        }),
      ],
      [link(101, "CORRECTS", 2, 1)],
      [],
    );
    const revenue = dimensionView(view, "claims.revenue");
    expect(revenue.status).toBe("ZERO");
    expect(mayAsk(revenue.status)).toBe(false);
  });

  it("D10: unrelated traction lines are never paired as a contradiction", () => {
    const view = projectView(
      [
        statement(1, "claims.traction", count(2300), {
          minute: 1,
          quantity: "wallets",
          asOf: "2026-11-01",
        }),
        statement(
          2,
          "claims.traction",
          { kind: "PERCENT", percent: "20" },
          {
            minute: 2,
            quantity: "growth_rate_monthly",
            asOf: "2026-11-01",
          },
        ),
        statement(3, "claims.traction", count(40), {
          minute: 3,
          quantity: "pilots",
          asOf: "2026-11-01",
        }),
        statement(4, "claims.traction", text("Two banks are piloting."), {
          minute: 4,
        }),
      ],
      [],
      [],
    );
    const traction = dimensionView(view, "claims.traction");
    expect(traction.disagreements).toEqual([]);
    expect(traction.status).toBe("SETTLED");
  });

  it("D11: a 'now' figure updates one metric and keeps every other traction line", () => {
    const statements = [
      statement(1, "claims.traction", count(2300), {
        minute: 1,
        quantity: "wallets",
        asOf: "2026-10-01",
      }),
      statement(
        2,
        "claims.traction",
        text("Platform growing month on month."),
        { minute: 2 },
      ),
      statement(3, "claims.traction", count(1500), {
        minute: 3,
        quantity: "weekly_active_users",
        asOf: "2026-10-01",
      }),
      statement(4, "claims.traction", count(1900), {
        minute: 4,
        quantity: "weekly_active_users",
        asOf: "2026-11-14",
      }),
    ];
    // Read as a correction of the October figure: only that figure moves.
    const corrected = dimensionView(
      projectView(statements, [link(101, "CORRECTS", 4, 3)], []),
      "claims.traction",
    );
    expect(ids(corrected.items)).toEqual([uuid(1), uuid(2), uuid(4)]);
    expect(corrected.superseded.map((s) => s.item.statementId)).toEqual([
      uuid(3),
    ]);
    // Read as a new figure: a time series, not a contradiction.
    const series = dimensionView(
      projectView(statements, [], []),
      "claims.traction",
    );
    expect(ids(series.items)).toEqual([uuid(1), uuid(2), uuid(3), uuid(4)]);
    expect(series.disagreements).toEqual([]);
  });
});

const GATEWAY_ID = "00000000-0000-4000-8000-0000000000c1";
const VERSION_ID = "00000000-0000-4000-8000-0000000000c2";
const POLICY_USER = "00000000-0000-4000-8000-0000000000c3";

/** A QUALIFIED gateway requiring Nigeria or Kenya and a $250k–$1M round. */
const POLICY = GatewayPolicySchema.parse({
  gateway: {
    id: GATEWAY_ID,
    tenantId: uuid(0xb3),
    investorOrganisationId: "00000000-0000-4000-8000-0000000000c4",
    organisationId: "00000000-0000-4000-8000-0000000000c5",
    publicId: generateGatewayPublicId(),
    name: "Seed programme",
    status: "ACTIVE",
    createdByUserId: POLICY_USER,
    createdAt: at(0),
    updatedAt: at(0),
  },
  version: {
    id: VERSION_ID,
    gatewayId: GATEWAY_ID,
    tenantId: uuid(0xb3),
    versionNumber: 1,
    status: "PUBLISHED",
    inboundMode: "QUALIFIED",
    publicTitle: "Seed-stage fintech",
    publicDescription: "We read every application.",
    qualificationPolicyVersion: QUALIFICATION_POLICY_VERSION,
    createdByUserId: POLICY_USER,
    publishedByUserId: POLICY_USER,
    publishedAt: at(0),
    supersededAt: null,
    createdAt: at(0),
    updatedAt: at(0),
  },
  criteria: [
    {
      id: "00000000-0000-4000-8000-0000000000d1",
      versionId: VERSION_ID,
      position: 1,
      requiredness: "REQUIRED",
      label: "Nigeria or Kenya",
      config: { type: "GEOGRAPHY", allowedCountries: ["NG", "KE"] },
    },
    {
      id: "00000000-0000-4000-8000-0000000000d2",
      versionId: VERSION_ID,
      position: 2,
      requiredness: "REQUIRED",
      label: "$250k to $1M",
      config: {
        type: "RAISE_SIZE",
        currency: "USD",
        minAmount: "250000",
        maxAmount: "1000000",
      },
    },
  ],
});

/** Statements → legacy facts → the engine, as slice 2 will wire it. */
function qualifyView(view: ReturnType<typeof projectView>) {
  const { facts, disputed } = legacyFactsFrom(view);
  const asFacts: ApplicationFact[] = facts.map((fact, index) => ({
    id: ApplicationFactIdSchema.parse(uuid(900 + index)),
    applicationId: ApplicationIdSchema.parse(APPLICATION),
    dimension: fact.dimension,
    value: fact.value,
    provenance: fact.provenance,
    recordedAt: at(30),
    supersededAt: null,
  }));
  const projection = applicationProjection({
    applicationId: ApplicationIdSchema.parse(APPLICATION),
    tenantId: uuid(0xb3),
    facts: asFacts,
    classifications: [],
    disputed: disputedFactsFor(disputed),
  });
  return {
    facts,
    disputed,
    projection,
    result: qualify({ policy: POLICY, projection, evaluatedAt: at(40) }),
  };
}

const usd = (amount: string): StatementValue => ({
  kind: "MONEY",
  amount,
  currency: "USD",
});

describe("legacyFactsFrom and qualification: owner decision 91", () => {
  const raiseStatements = [
    statement(1, "raise.amount", usd("500000"), {
      minute: 1,
      quantity: "raise_amount",
      words: "raising $500k",
    }),
    statement(2, "raise.amount", usd("1500000"), {
      minute: 2,
      quantity: "raise_amount",
      words: "actually $1.5M",
    }),
    statement(
      3,
      "company.country",
      { kind: "CODE", code: "NG" },
      { minute: 3 },
    ),
    statement(
      4,
      "company.stage",
      { kind: "UNKNOWN", declined: true },
      { minute: 4 },
    ),
    statement(5, "company.sector_phrases", text("payments"), { minute: 5 }),
    statement(6, "company.sector_phrases", text("lending"), { minute: 6 }),
  ];

  it("an open disagreement on a required rule's fact is UNRESOLVED: never the latest value, never a refusal", () => {
    const view = projectView(
      raiseStatements,
      [link(101, "DISAGREES", 2, 1)],
      [],
    );
    expect(dimensionView(view, "raise.amount").status).toBe(
      "DISAGREEMENT_OPEN",
    );
    const { facts, disputed, projection, result } = qualifyView(view);

    expect(disputed).toEqual(["raise.amount"]);
    const byDimension = new Map(facts.map((f) => [f.dimension, f]));
    // Both values and their words stay visible; neither is readable by a rule.
    expect(byDimension.get("raise.amount")?.value).toEqual({
      kind: "TEXT",
      text: "raising $500k\nactually $1.5M",
      unreconciled: [{ earlier: "raising $500k", later: "actually $1.5M" }],
    });
    expect(projection.raise).toBeNull();
    expect(projection.disputed).toEqual(["RAISE"]);

    const raiseRule = result.criteria.find((c) => c.type === "RAISE_SIZE");
    expect(raiseRule).toMatchObject({
      status: "UNRESOLVED",
      reasonCode: "RAISE_DISPUTED",
    });
    expect(result.outcome).toBe("UNRESOLVED");
    // The submission gate admits only MAY_APPLY: an unresolved rule never blocks it.
    expect(result.access).toBe("MAY_APPLY");
    expect(result.accessReasonCode).toBe("REQUIRED_CRITERIA_UNRESOLVED");
    expect(result.principalMismatches).toEqual([]);
    expect(result.unresolved).toEqual([raiseRule?.criterionId]);

    // The rest of today's facts are unchanged.
    expect(byDimension.get("company.country")?.value).toEqual({
      kind: "CODE",
      code: "NG",
    });
    expect(byDimension.get("company.stage")).toEqual({
      dimension: "company.stage",
      value: { kind: "NONE", declined: true },
      provenance: "UNKNOWN",
    });
    expect(byDimension.get("company.sector_phrases")?.value).toEqual({
      kind: "PHRASES",
      phrases: ["payments", "lending"],
    });
    expect(byDimension.has("company.problem")).toBe(false);

    // The investor's inbox reads it as needing review, never as a miss.
    const read = readQualification(result);
    expect(read.outcome).toBe("UNRESOLVED");
    expect(
      read.criteria.find((c) => c.dimension === "RAISE_SIZE")?.status,
    ).toBe("UNRESOLVED");
    expect(fitBandOf(read)).toBe("PARTIAL");
    expect(rulesOf(read)).toEqual({ met: 1, total: 2, unknown: 1 });
  });

  it("a disagreement the founder left open is still unresolved", () => {
    const view = projectView(
      raiseStatements,
      [link(101, "DISAGREES", 2, 1)],
      [event(201, 101, "LEFT_OPEN", 10)],
    );
    expect(qualifyView(view).result.outcome).toBe("UNRESOLVED");
  });

  it("an explicit correction resolves it to the corrected value", () => {
    const view = projectView(
      raiseStatements,
      [link(101, "DISAGREES", 2, 1), link(102, "CORRECTS", 2, 1)],
      [],
    );
    const { disputed, projection, result } = qualifyView(view);
    expect(disputed).toEqual([]);
    expect(projection.raise).toEqual({ amount: "1500000", currency: "USD" });
    expect(projection.disputed).toBeUndefined();
    // $1.5M is outside the band: an established fact, so an honest no.
    expect(result.outcome).toBe("NOT_QUALIFIED");

    const back = projectView(
      raiseStatements,
      [link(101, "DISAGREES", 2, 1)],
      [event(201, 101, "RESOLVED", 10, 1)],
    );
    const resolved = qualifyView(back);
    expect(resolved.projection.raise).toEqual({
      amount: "500000",
      currency: "USD",
    });
    expect(resolved.result.outcome).toBe("QUALIFIED");
  });

  it("a dispute never outranks an established mismatch or a missing answer", () => {
    const disputedRaise = projectView(
      raiseStatements,
      [link(101, "DISAGREES", 2, 1)],
      [],
    );
    const elsewhere = projectView(
      [
        ...raiseStatements.filter((s) => s.dimension !== "company.country"),
        statement(
          3,
          "company.country",
          { kind: "CODE", code: "GH" },
          { minute: 3 },
        ),
      ],
      [link(101, "DISAGREES", 2, 1)],
      [],
    );
    expect(qualifyView(elsewhere).result.outcome).toBe("NOT_QUALIFIED");
    const noCountry = projectView(
      raiseStatements.filter((s) => s.dimension !== "company.country"),
      [link(101, "DISAGREES", 2, 1)],
      [],
    );
    expect(qualifyView(noCountry).result).toMatchObject({
      outcome: "INSUFFICIENT_INFORMATION",
      access: "NEEDS_INFORMATION",
    });
    expect(qualifyView(disputedRaise).result.outcome).toBe("UNRESOLVED");
  });

  it("maps disputed dimensions to the engine's facts, once each", () => {
    expect(
      disputedFactsFor([
        "raise.currency",
        "raise.amount",
        "company.stage",
        "company.problem",
      ]),
    ).toEqual(["CURRENT_STAGE", "RAISE"]);
  });
});

describe("legacyFactsFrom: the legacy shape", () => {
  it("never guesses a currency: an amount without one stays out of the rules", () => {
    const view = projectView(
      [
        statement(
          1,
          "raise.amount",
          { kind: "MONEY", amount: "500000", currency: null },
          {
            minute: 1,
            words: "half a million",
          },
        ),
      ],
      [],
      [],
    );
    const fact = legacyFactsFrom(view).facts.find(
      (f) => f.dimension === "raise.amount",
    );
    expect(fact?.value).toEqual({ kind: "TEXT", text: "half a million" });
  });

  it("reports, never hides, what the legacy text bound could not hold", () => {
    const long = "x".repeat(900);
    const view = projectView(
      [1, 2, 3].map((n) =>
        statement(n, "company.market", text(`${n}${long}`), { minute: n }),
      ),
      [],
      [],
    );
    const { facts, incomplete } = legacyFactsFrom(view);
    expect(incomplete).toEqual([
      { dimension: "company.market", reason: "TEXT_LIMIT" },
    ]);
    const fact = facts.find((f) => f.dimension === "company.market");
    expect(fact?.value.kind === "TEXT" && fact.value.text.startsWith("2")).toBe(
      true,
    );
  });
});

describe("projectView is a function of the set, not the order", () => {
  function seeded(seed: number) {
    let state = seed >>> 0;
    return () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 2 ** 32;
    };
  }
  function shuffle<T>(items: readonly T[], random: () => number): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      const a = copy[i];
      const b = copy[j];
      if (a === undefined || b === undefined) continue;
      copy[i] = b;
      copy[j] = a;
    }
    return copy;
  }

  it("gives the same view for 300 shuffles of a mixed history", () => {
    const statements = [
      statement(1, "claims.traction", count(600), {
        minute: 1,
        quantity: "weekly_active_users",
        asOf: "2026-11-01",
      }),
      statement(2, "claims.traction", count(1500), {
        minute: 2,
        quantity: "weekly_active_users",
        asOf: "2026-11-01",
      }),
      statement(3, "claims.traction", count(2300), {
        minute: 3,
        quantity: "wallets",
        asOf: "2026-11-01",
      }),
      statement(4, "claims.traction", count(2400), {
        minute: 4,
        quantity: "wallets",
        asOf: "2026-11-01",
      }),
      statement(5, "claims.traction", unknown, { minute: 5 }),
      statement(
        6,
        "claims.revenue",
        { kind: "ZERO" },
        { minute: 6, quantity: "revenue" },
      ),
      statement(
        7,
        "raise.amount",
        { kind: "MONEY", amount: "500000", currency: "USD" },
        { minute: 7 },
      ),
      statement(
        8,
        "raise.amount",
        { kind: "MONEY", amount: "600000", currency: "USD" },
        { minute: 8 },
      ),
      statement(
        9,
        "raise.amount",
        { kind: "MONEY", amount: "650000", currency: "USD" },
        { minute: 9 },
      ),
      statement(10, "company.problem", text("a"), { minute: 10 }),
      statement(11, "company.problem", text("b"), { minute: 10 }),
      statement(12, "company.problem", text("c"), { minute: 11 }),
    ];
    const links = [
      link(101, "DISAGREES", 2, 1),
      link(102, "CORRECTS", 5, 2),
      link(103, "DISAGREES", 8, 7),
      link(104, "CORRECTS", 9, 8),
      link(105, "CORRECTS", 12, 10),
      link(106, "CORRECTS", 12, 11),
    ];
    const events = [
      event(201, 101, "LEFT_OPEN", 20),
      event(202, 101, "REOPENED", 21),
      event(203, 101, "LEFT_OPEN", 22),
      event(204, 103, "RESOLVED", 23, 7),
    ];
    const baseline = projectView(statements, links, events);
    expect(dimensionView(baseline, "claims.traction").status).toBe(
      "DISAGREEMENT_OPEN",
    );
    const random = seeded(20261114);
    for (let round = 0; round < 300; round += 1) {
      expect(
        projectView(
          shuffle(statements, random),
          shuffle(links, random),
          shuffle(events, random),
        ),
      ).toEqual(baseline);
    }
  });
});
