import type { PromptDefinition } from "../definition.js";
import type {
  GateQInterviewerResultV2,
  GateQInterviewerVariablesV7,
} from "../schemas/gateq-interviewer.js";
import { GATEQ_INTERVIEWER_V7 } from "./gateq-interviewer.v7.js";

/**
 * GATEQ_INTERVIEWER v8: relations come from what was said once, about one
 * metric (root cause 2026-11-14, audits/2026-11-14-gateq-root-cause.md).
 *
 * Three live runs failed because statements were related by coincidence on
 * a broad dimension. The platform now relates two statements only when
 * they are about the same metric and period and were said in different
 * messages, and code enforces that whatever the reading says. v8 tells the
 * reader the same rules, so what it reads already fits them:
 *
 *   - a change or a range said once is one statement, never two;
 *   - "nobody pays yet" is a stated zero of revenue, not only of paying
 *     customers;
 *   - a share of users is a PERCENT with no quantity;
 *   - saying "leave it open" again is a LEAVE_OPEN on its D<n> again, and
 *     a request to leave something open is never a statement or a note.
 *
 * Same variables and the same reading schema (v2) as v7.
 */
const replaced = (text: string, anchor: string, by: string): string => {
  if (!text.includes(anchor))
    throw new Error(`GATEQ_INTERVIEWER_V8: anchor moved: ${anchor}`);
  return text.replace(anchor, by);
};

let template = GATEQ_INTERVIEWER_V7.template;
template = replaced(
  template,
  "- op NEW: it stands beside everything on record, even on the same dimension (a second traction line adds to the first). target null.\n",
  '- op NEW: it stands beside everything on record, even on the same dimension (a second traction line adds to the first). target null.\n- A change or a range said once ("we went from 1 partner school to 4 since March", "between 600 and 700 a week") is ONE statement: the current or upper figure, with all their words. Never two statements, and never DISAGREES between parts of one sentence.\n',
);
template = replaced(
  template,
  '- ZERO is a stated nothing: "nobody pays yet", "revenue so far is zero", "no customers yet". It is a value, never unknown. Once something is a stated zero, never ask for it again.\n',
  '- ZERO is a stated nothing: "nobody pays yet", "revenue so far is zero", "no customers yet". It is a value, never unknown. "Nobody pays yet" is a ZERO on claims.revenue with quantity revenue (and a ZERO of paying_customers too when they speak of customers). Once something is a stated zero, never ask for it again, and never ask what period a zero covers.\n',
);
template = replaced(
  template,
  "- quantity: for MONEY, COUNT, PERCENT, ZERO or UNKNOWN about a metric, its key from STATEMENT QUANTITIES; null for prose or a metric not on the list.",
  '- quantity: for MONEY, COUNT, PERCENT, ZERO or UNKNOWN about a metric, its key from STATEMENT QUANTITIES; null for prose or a metric not on the list (CAC is not on the list: null). A share or proportion ("40 percent of students are girls") is a PERCENT with quantity null; only a rate on the list (growth, churn, retention, margin) takes a PERCENT quantity.',
);
template = replaced(
  template,
  'RESOLVE with keep S<n> when they say which statement is right. A correction of one side is a CORRECTS statement instead.\n',
  'RESOLVE with keep S<n> when they say which statement is right. A correction of one side is a CORRECTS statement instead. Saying it again about a D<n> already marked (left open by them) is LEAVE_OPEN on that D<n> again. A request to leave something open is only a disagreementAction: never a statement, never application.note.\n',
);

export const GATEQ_INTERVIEWER_V8: PromptDefinition<
  GateQInterviewerVariablesV7,
  GateQInterviewerResultV2
> = {
  ...GATEQ_INTERVIEWER_V7,
  version: 8,
  effectiveFrom: "2026-11-14",
  changeDescription:
    "Relations from what was said once, about one metric (root cause 2026-11-14): a change or range said once is one statement; nobody pays is a zero of revenue and a zero needs no period; a share is a PERCENT with no quantity; a repeated leave-open is LEAVE_OPEN on its D<n>, never a statement or a note.",
  template,
};
