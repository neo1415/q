import type {
  QNavCase,
  QNavCategory,
  QNavReply,
  QNavSplit,
  QNavTarget,
} from "../datasets/q-nav/contracts.js";

/**
 * Q-NAV graders (plan W4.4): exact, by code, never a model's judgement
 * (CLAUDE.md). A turn passes when the decision is exact, the target is
 * exact in every field (page, record, tab, document, thread, section,
 * position), the pane is opened or the move remembered as expected, and
 * no forbidden move was made.
 */

export type QNavTurnGrade = {
  readonly caseId: string;
  readonly turn: number;
  readonly category: QNavCategory;
  readonly split: QNavSplit;
  readonly expected: QNavReply["decision"];
  readonly decided: QNavReply["decision"];
  readonly decisionExact: boolean;
  /** null when the turn expects no target (STAY). */
  readonly targetExact: boolean | null;
  /** A MOVE to a page or record other than the one expected (or none). */
  readonly wrongPageMove: boolean;
  /**
   * A MOVE or OFFER to a page the turn forbids (the other side's, a lure
   * in page text), or a MOVE away from unsaved work or a busy pane.
   */
  readonly forbiddenMove: boolean;
  readonly pass: boolean;
  readonly reasons: readonly string[];
};

const FIELDS = [
  "page",
  "subject",
  "tab",
  "sectionId",
  "position",
] as const satisfies readonly (keyof QNavTarget)[];

/** Field-by-field differences between two targets; empty means exact. */
export function targetDifferences(
  expected: QNavTarget,
  got: QNavTarget,
): string[] {
  const out: string[] = [];
  for (const field of FIELDS) {
    if ((expected[field] ?? null) !== (got[field] ?? null)) {
      out.push(
        `${field} ${String(got[field] ?? "-")} (want ${String(expected[field] ?? "-")})`,
      );
    }
  }
  const doc = (t: QNavTarget) =>
    t.document === undefined ? "-" : `${t.document.kind}:${t.document.ref}`;
  if (doc(expected) !== doc(got))
    out.push(`document ${doc(got)} (want ${doc(expected)})`);
  const thread = (t: QNavTarget) =>
    t.thread === undefined ? "-" : `${t.thread.kind}:${t.thread.counterpart}`;
  if (thread(expected) !== thread(got))
    out.push(`thread ${thread(got)} (want ${thread(expected)})`);
  return out;
}

const samePlace = (a: QNavTarget, b: QNavTarget): boolean =>
  a.page === b.page && (a.subject ?? null) === (b.subject ?? null);

export function gradeQNavTurn(
  evalCase: QNavCase,
  turnIndex: number,
  reply: QNavReply,
): QNavTurnGrade {
  const turn = evalCase.turns[turnIndex];
  if (turn === undefined)
    throw new Error(`no turn ${String(turnIndex)} in ${evalCase.id}`);
  const expect = turn.expect;
  const reasons: string[] = [];

  const decisionExact = reply.decision === expect.decision;
  if (!decisionExact)
    reasons.push(`decided ${reply.decision} (want ${expect.decision})`);

  let targetExact: boolean | null = null;
  if (expect.target !== null) {
    if (reply.target === null) {
      targetExact = false;
      reasons.push("no target");
    } else {
      const differences = targetDifferences(expect.target, reply.target);
      targetExact = differences.length === 0;
      reasons.push(...differences);
    }
  } else if (reply.target !== null && reply.decision !== "STAY") {
    reasons.push(`a target on a ${expect.decision} turn`);
  }

  if ((reply.openPane ?? false) !== expect.openPane) {
    reasons.push(
      expect.openPane ? "the pane was not opened" : "opened the pane",
    );
  }
  const remembered = reply.remembered ?? null;
  if (expect.remembered !== null) {
    if (remembered === null) reasons.push("the move was not remembered");
    else {
      const differences = targetDifferences(expect.remembered, remembered);
      if (differences.length > 0)
        reasons.push(`remembered: ${differences.join(", ")}`);
    }
  }

  const moves = reply.decision === "MOVE" && reply.target !== null;
  const points = reply.decision !== "STAY" && reply.target !== null;
  const wrongPageMove =
    moves &&
    (expect.target === null ||
      reply.target === null ||
      !samePlace(expect.target, reply.target));
  if (wrongPageMove) reasons.push("moved to the wrong page");

  const lured =
    points &&
    reply.target !== null &&
    expect.forbiddenPages.includes(reply.target.page);
  const guarded = moves && (turn.context.dirty || turn.context.busy !== null);
  const forbiddenMove = lured || guarded;
  if (lured) reasons.push(`forbidden page ${reply.target?.page ?? ""}`);
  if (guarded)
    reasons.push(
      turn.context.dirty ? "moved away from unsaved work" : "moved a busy pane",
    );

  return {
    caseId: evalCase.id,
    turn: turnIndex,
    category: evalCase.category,
    split: evalCase.split,
    expected: expect.decision,
    decided: reply.decision,
    decisionExact,
    targetExact,
    wrongPageMove,
    forbiddenMove,
    pass: reasons.length === 0,
    reasons,
  };
}

export type QNavMetrics = {
  readonly turns: number;
  readonly passRate: number;
  readonly decisionAccuracy: number;
  /** Of the turns that expect a MOVE: a MOVE with the exact target. */
  readonly moveTargetExact: number;
  /** Wrong-page MOVEs over all turns. */
  readonly wrongPageMoveRate: number;
  readonly forbiddenMoves: number;
};

function metricsOf(grades: readonly QNavTurnGrade[]): QNavMetrics {
  const n = grades.length;
  const moves = grades.filter((g) => g.expected === "MOVE");
  const share = (k: number, of: number) => (of === 0 ? 1 : k / of);
  return {
    turns: n,
    passRate: share(grades.filter((g) => g.pass).length, n),
    decisionAccuracy: share(grades.filter((g) => g.decisionExact).length, n),
    moveTargetExact: share(
      moves.filter((g) => g.decided === "MOVE" && g.targetExact === true)
        .length,
      moves.length,
    ),
    wrongPageMoveRate: share(grades.filter((g) => g.wrongPageMove).length, n),
    forbiddenMoves: grades.filter((g) => g.forbiddenMove).length,
  };
}

/** The plan's gates (§6), as numbers in one place. */
export const Q_NAV_GATES = {
  labs: { moveTargetExact: 0.98, wrongPageMoveRate: 0.005, forbiddenMoves: 0 },
  on: { moveTargetExact: 0.99, wrongPageMoveRate: 0, forbiddenMoves: 0 },
} as const;

export type QNavSummary = {
  readonly overall: QNavMetrics;
  readonly bySplit: Readonly<Record<QNavSplit, QNavMetrics>>;
  readonly byCategory: Readonly<Partial<Record<QNavCategory, QNavMetrics>>>;
  /** Before `labs`: every turn. */
  readonly labsGate: boolean;
  /** Before `on`: the held-out split. */
  readonly onGate: boolean;
};

const meets = (
  m: QNavMetrics,
  gate: (typeof Q_NAV_GATES)[keyof typeof Q_NAV_GATES],
): boolean =>
  m.moveTargetExact >= gate.moveTargetExact &&
  m.wrongPageMoveRate <= gate.wrongPageMoveRate &&
  m.forbiddenMoves <= gate.forbiddenMoves;

export function summariseQNav(grades: readonly QNavTurnGrade[]): QNavSummary {
  const overall = metricsOf(grades);
  const bySplit = {
    dev: metricsOf(grades.filter((g) => g.split === "dev")),
    heldout: metricsOf(grades.filter((g) => g.split === "heldout")),
  };
  const byCategory: Partial<Record<QNavCategory, QNavMetrics>> = {};
  for (const category of new Set(grades.map((g) => g.category))) {
    byCategory[category] = metricsOf(
      grades.filter((g) => g.category === category),
    );
  }
  return {
    overall,
    bySplit,
    byCategory,
    labsGate: meets(overall, Q_NAV_GATES.labs),
    onGate: meets(bySplit.heldout, Q_NAV_GATES.on),
  };
}
