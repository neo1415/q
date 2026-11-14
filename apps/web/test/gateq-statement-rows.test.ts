import { describe, expect, it } from "vitest";

import {
  gateqStatementIdentities,
  gateqStatementsInWords,
  type GateqStatementViewV1,
  type GateqStatementWords,
} from "@capital-q/contracts";

import {
  compactStatementRows,
  paneWhy,
  STATEMENT_ROWS_COMPACT,
  statementRowsOf,
} from "../src/features/gateq/page/inbox-model";
import { ruleLines } from "../src/features/gateq/form/form-model";

/**
 * Slice 3 (invariant 8): founder review and the investor's dossier rows
 * come from the one shared formatter, so they show the same statements,
 * sources and disagreement states.
 */

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function said(
  n: number,
  summary: string,
  sourceKind: GateqStatementWords["sourceKind"] = "APPLICATION_STATEMENT",
): GateqStatementWords {
  return {
    statementId: id(n),
    sourceKind,
    backfilled: false,
    valueKind: "COUNT",
    declined: false,
    summary,
    words: summary,
    quantity: "weekly_active_users",
    asOf: null,
    provenance: "APPLICANT_PROVIDED",
    sourceTurnSeq: n,
    statedAt: `2026-11-14T10:00:${String(n).padStart(2, "0")}.000Z`,
  };
}

const TRACTION: GateqStatementViewV1["dimensions"][number] = {
  dimension: "claims.traction",
  label: "Traction",
  group: "TRACTION",
  status: "DISAGREEMENT_LEFT_OPEN",
  statements: [
    said(2, "about 600 weekly active"),
    said(3, "1,500 weekly active", "FORM"),
  ],
  superseded: [
    { ...said(1, "300 weekly active"), supersededBy: id(2), via: "CORRECTION" },
  ],
  disagreements: [
    {
      key: "link-1",
      olderStatementId: id(2),
      newerStatementId: id(3),
      state: "LEFT_OPEN",
      resolvedByStatementId: null,
      active: true,
    },
  ],
};

const VIEW: GateqStatementViewV1 = {
  version: "gateq-statement-view.v1",
  dimensions: [
    TRACTION,
    {
      dimension: "contact.email",
      label: "Contact email",
      group: null,
      status: "SETTLED",
      statements: [said(4, "a@b.co")],
      superseded: [],
      disagreements: [],
    },
  ],
};

describe("statement rows from the shared formatter", () => {
  it("shows both disagreeing values with their sources and state, and history", () => {
    const rows = statementRowsOf(VIEW);
    expect(rows.map((r) => r.kind)).toEqual([
      "STATEMENT",
      "STATEMENT",
      "DISAGREEMENT",
      "HISTORY",
    ]);
    const disagreement = rows[2];
    expect(disagreement?.summaries).toEqual([
      "about 600 weekly active",
      "1,500 weekly active",
    ]);
    expect(disagreement?.sourceWords).toEqual([
      "Said in the application",
      "Given in the form",
    ]);
    expect(disagreement?.stateWords).toBe("Left open by the founder");
    // Founder review and the dossier read the same identities.
    expect(gateqStatementIdentities(rows)).toEqual(
      gateqStatementIdentities(gateqStatementsInWords(VIEW)),
    );
  });

  it("is compact by default, never hiding a standing disagreement, and counts what it hides", () => {
    const many: GateqStatementViewV1 = {
      ...VIEW,
      dimensions: [
        {
          ...TRACTION,
          statements: [
            ...TRACTION.statements,
            ...Array.from({ length: STATEMENT_ROWS_COMPACT }, (_, i) =>
              said(10 + i, `line ${String(i)}`),
            ),
          ],
        },
      ],
    };
    const rows = statementRowsOf(many);
    const compact = compactStatementRows(rows, false);
    expect(compact.rows.some((r) => r.kind === "DISAGREEMENT")).toBe(true);
    expect(compact.rows.filter((r) => r.kind === "STATEMENT")).toHaveLength(
      STATEMENT_ROWS_COMPACT,
    );
    expect(compact.hidden).toBe(rows.length - compact.rows.length);
    expect(compactStatementRows(rows, true).rows).toHaveLength(rows.length);
  });
});

describe("decision 91: one verdict on every surface", () => {
  it("labels a disputed rule as the investor's judgement, never unanswered", () => {
    expect(
      paneWhy({
        fit: "PARTIAL",
        rules: { met: 2, total: 3, unknown: 1, unresolved: 1 },
        replyState: "NONE",
      } as never),
    ).toBe("Needs your judgement: answers disagree.");
  });

  it("never shows the founder a disputed rule as met", () => {
    const lines = ruleLines(
      {
        criteria: [
          { label: "Stage", dimension: "STAGE", requiredness: "REQUIRED" },
        ],
      } as never,
      { unmet: [], stillNeeded: [], unresolved: ["Stage"] },
    );
    expect(lines[0]?.standing).toBe("UNRESOLVED");
  });
});
