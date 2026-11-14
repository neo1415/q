import type {
  GateqDisagreementState,
  GateqDossier,
  GateqStatementViewV1,
} from "./gateq-intake.js";
import {
  gateqStandingDisagreements,
  gateqStatementsInWords,
} from "./gateq-statements.js";

/**
 * THE relation rule of GateQ statements (root cause 2026-11-14,
 * docs/ai-handoff/audits/2026-11-14-gateq-root-cause.md). Three live runs
 * failed because each place that related two statements asked "same
 * dimension?" with its own extra heuristic, while one dimension (traction)
 * holds weekly active users, CAC and partner schools at once. Every writer
 * (the interview's write path, the form), the projector and every reader of
 * a frozen dossier ask this one predicate, and nothing else.
 *
 * Two statements can stand in a relation (disagree, or be the pair a
 * leave-open is about) only when:
 *
 *   1. both hold a value: an unknown is never an end;
 *   2. they are on the same dimension and about the same metric: two
 *      numbers name the same quantity their values fit (a share is not a
 *      number of users); one side naming none relates only when the reader
 *      said so explicitly;
 *   3. their periods are comparable: equal known dates, or a date not given;
 *   4. they were said in different turns: a change or range said once is
 *      not a contradiction.
 */

/** Quantities that are rates: only a PERCENT (or a zero) is about one. */
const RATE_QUANTITIES: ReadonlySet<string> = new Set([
  "growth_rate_monthly",
  "churn_rate_monthly",
  "retention_rate",
  "gross_margin",
]);
/** Quantities that are money: only MONEY (or a zero) is about one. */
const MONEY_QUANTITIES: ReadonlySet<string> = new Set([
  "revenue",
  "mrr",
  "arr",
  "gmv",
  "burn_monthly",
  "raise_amount",
  "pre_money_valuation",
]);

export type GateqValueKind =
  "TEXT" | "CODE" | "MONEY" | "COUNT" | "PERCENT" | "ZERO" | "UNKNOWN";

/** The metric a statement is about: its quantity when its value fits it. */
export function gateqQuantityFitting(
  kind: GateqValueKind,
  quantity: string | null,
): string | null {
  if (quantity === null) return null;
  switch (kind) {
    case "ZERO":
    case "UNKNOWN":
      return quantity;
    case "PERCENT":
      return RATE_QUANTITIES.has(quantity) ? quantity : null;
    case "MONEY":
      return MONEY_QUANTITIES.has(quantity) ? quantity : null;
    case "COUNT":
      return RATE_QUANTITIES.has(quantity) || MONEY_QUANTITIES.has(quantity)
        ? null
        : quantity;
    case "TEXT":
    case "CODE":
      return null;
  }
}

export type GateqRelatableEnd = {
  readonly dimension: string;
  readonly quantity: string | null;
  readonly valueKind: GateqValueKind;
  readonly asOf: string | null;
  /** The turn it was said in (an id or a sequence number); null: no turn. */
  readonly sourceTurn: string | number | null;
};

export function gateqRelatable(
  a: GateqRelatableEnd,
  b: GateqRelatableEnd,
  options: { readonly explicit?: boolean } = {},
): boolean {
  if (a.valueKind === "UNKNOWN" || b.valueKind === "UNKNOWN") return false;
  if (a.dimension !== b.dimension) return false;
  if (
    a.sourceTurn !== null &&
    b.sourceTurn !== null &&
    a.sourceTurn === b.sourceTurn
  )
    return false;
  if (a.asOf !== null && b.asOf !== null && a.asOf !== b.asOf) return false;
  const qa = gateqQuantityFitting(a.valueKind, a.quantity);
  const qb = gateqQuantityFitting(b.valueKind, b.quantity);
  if (qa !== null && qb !== null) return qa === qb;
  if (qa === null && qb === null) return true;
  return options.explicit === true;
}

type Dimension = GateqStatementViewV1["dimensions"][number];

function statusOf(
  dimension: Dimension,
): GateqStatementViewV1["dimensions"][number]["status"] {
  const { statements } = dimension;
  if (statements.length === 0) return "UNANSWERED";
  const standing = dimension.disagreements.filter(
    (d) => d.active && d.state !== "RESOLVED",
  );
  if (standing.some((d) => d.state === "OPEN")) return "DISAGREEMENT_OPEN";
  if (standing.some((d) => d.state === "LEFT_OPEN"))
    return "DISAGREEMENT_LEFT_OPEN";
  const held = statements.filter((s) => s.valueKind !== "UNKNOWN");
  if (held.length > 0)
    return held.every((s) => s.valueKind === "ZERO") ? "ZERO" : "SETTLED";
  return statements.at(-1)?.declined === true ? "DECLINED" : "UNKNOWN";
}

/**
 * A statement view as the relation rule reads it today. A disagreement
 * recorded before the rule (a same-turn range, an unknown end, two
 * metrics) no longer stands: it is kept as written, marked inactive, and
 * the dimension's status follows. Statements are never changed; a view
 * that already obeys the rule comes back equal. The origin of a stored
 * link is not on the wire, so a link is judged as the reader's own
 * (explicit), the lenient reading: it is dropped only for what no
 * relation may ever be.
 */
export function gateqViewUnderRelationRule(
  view: GateqStatementViewV1,
): GateqStatementViewV1 {
  const ends = new Map<string, GateqRelatableEnd>();
  for (const dimension of view.dimensions)
    for (const s of dimension.statements)
      ends.set(s.statementId, {
        dimension: dimension.dimension,
        quantity: s.quantity,
        valueKind: s.valueKind,
        asOf: s.asOf,
        sourceTurn: s.sourceTurnSeq,
      });
  let anyChanged = false;
  const dimensions = view.dimensions.map((dimension) => {
    let changed = false;
    const disagreements = dimension.disagreements.map((d) => {
      if (!d.active) return d;
      const older = ends.get(d.olderStatementId);
      const newer = ends.get(d.newerStatementId);
      if (
        older !== undefined &&
        newer !== undefined &&
        gateqRelatable(older, newer, { explicit: true })
      )
        return d;
      changed = true;
      return { ...d, active: false };
    });
    if (!changed) return dimension;
    anyChanged = true;
    const next = { ...dimension, disagreements };
    return { ...next, status: statusOf(next) };
  });
  return anyChanged ? { ...view, dimensions } : view;
}

/**
 * A frozen dossier as read now (decision on pre-fix submissions, root
 * cause 2026-11-14): the submitted record is never rewritten, but a
 * relation the current rule does not allow is not shown to the investor
 * as a contradiction (live c4cf20bd: "600 weekly active" vs "Not known").
 * Only v2 dossiers carry the statements to judge; a v1 dossier is read as
 * frozen. The qualification stays as it was decided at submission.
 */
export function gateqDossierAsReadNow<D extends GateqDossier>(dossier: D): D {
  if (dossier.schemaVersion !== "gateq-dossier.v2") return dossier;
  const statements = gateqViewUnderRelationRule(dossier.statements);
  if (statements === dossier.statements) return dossier;
  const before = new Set(
    gateqStandingDisagreements(gateqStatementsInWords(dossier.statements)).map(
      (line) => line.text.slice(0, 300),
    ),
  );
  const nowLines = gateqStatementsInWords(statements);
  const now = new Set(
    gateqStandingDisagreements(nowLines).map((line) => line.text.slice(0, 300)),
  );
  const gone = new Set([...before].filter((line) => !now.has(line)));
  if (gone.size === 0) return { ...dossier, statements };
  const states = new Map<string, GateqDisagreementState | null>();
  for (const line of nowLines)
    if (line.kind === "STATEMENT")
      states.set(line.statementIds[0] ?? "", line.disagreementState);
  const goneQuestions = new Set(
    [...gone].map((line) => `Please reconcile: ${line}.`.slice(0, 400)),
  );
  const diligenceQuestions = dossier.diligenceQuestions.filter(
    (q) => !(q.basis === "CONTRADICTION" && goneQuestions.has(q.question)),
  );
  return {
    ...dossier,
    statements,
    contradictions: dossier.contradictions.filter((line) => !gone.has(line)),
    contradictionsTotal: now.size,
    diligenceQuestions,
    ...(dossier.diligenceQuestionsTotal === undefined
      ? {}
      : {
          diligenceQuestionsTotal:
            dossier.diligenceQuestionsTotal -
            (dossier.diligenceQuestions.length - diligenceQuestions.length),
        }),
    dimensions: dossier.dimensions.map((group) => ({
      ...group,
      facts: group.facts.map((fact) =>
        states.has(fact.statementId)
          ? { ...fact, disagreementState: states.get(fact.statementId) ?? null }
          : fact,
      ),
    })),
  };
}
