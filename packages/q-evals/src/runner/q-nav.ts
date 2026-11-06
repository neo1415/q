import type {
  QNavCase,
  QNavContext,
  QNavReply,
  QNavSide,
} from "../datasets/q-nav/contracts.js";
import { Q_NAV_RECORDS, type QNavRecords } from "../datasets/q-nav/world.js";
import {
  gradeQNavTurn,
  summariseQNav,
  type QNavSummary,
  type QNavTurnGrade,
} from "../graders/q-nav.js";

/**
 * What a navigation subject sees on a turn: what Q would know, never the
 * expectation. `history` is the case's earlier turns as said (their words
 * and Q's), for pronouns, ordinals and follow-ups.
 */
export type QNavDecisionInput = {
  readonly caseId: string;
  readonly side: QNavSide;
  readonly history: readonly { readonly user: string; readonly q: string }[];
  readonly user: string;
  readonly modality: "TEXT" | "VOICE";
  readonly language: string;
  readonly context: QNavContext;
  /** What they may resolve by name (W2.3's job), ids and all. */
  readonly records: QNavRecords;
};

export type QNavSubject = {
  readonly name: string;
  readonly decide: (input: QNavDecisionInput) => Promise<QNavReply>;
};

export type QNavRun = {
  readonly subject: string;
  readonly grades: readonly QNavTurnGrade[];
  readonly summary: QNavSummary;
};

export async function runQNav(
  subject: QNavSubject,
  cases: readonly QNavCase[],
): Promise<QNavRun> {
  const grades: QNavTurnGrade[] = [];
  for (const evalCase of cases) {
    for (const [index, turn] of evalCase.turns.entries()) {
      const reply = await subject.decide({
        caseId: evalCase.id,
        side: evalCase.side,
        history: evalCase.turns
          .slice(0, index)
          .map((t) => ({ user: t.user, q: t.q })),
        user: turn.user,
        modality: turn.modality,
        language: turn.language,
        context: turn.context,
        records: Q_NAV_RECORDS,
      });
      grades.push(gradeQNavTurn(evalCase, index, reply));
    }
  }
  return { subject: subject.name, grades, summary: summariseQNav(grades) };
}

/**
 * The scripted reference (CI): answers every turn as expected. It must
 * score 100% and pass both gates; any miss is a dataset or grader defect.
 */
export function referenceQNavSubject(cases: readonly QNavCase[]): QNavSubject {
  const byKey = new Map<string, QNavReply>();
  for (const c of cases) {
    c.turns.forEach((t, i) => {
      byKey.set(`${c.id}#${String(i)}`, {
        decision: t.expect.decision,
        target: t.expect.target,
        openPane: t.expect.openPane,
        remembered: t.expect.remembered,
      });
    });
  }
  return {
    name: "q-nav:reference",
    decide: (input) => {
      const reply = byKey.get(
        `${input.caseId}#${String(input.history.length)}`,
      );
      if (reply === undefined)
        return Promise.reject(new Error(`no reference for ${input.caseId}`));
      return Promise.resolve(reply);
    },
  };
}
