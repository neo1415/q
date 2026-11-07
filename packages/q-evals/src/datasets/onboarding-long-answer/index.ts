import {
  LONG_ANSWER_CATEGORIES,
  LONG_ANSWER_DATASET_VERSION,
  LongAnswerCaseSchema,
  type LongAnswerCase,
} from "./contracts.js";
import { LONG_ANSWER_DEV } from "./dev.js";
import { LONG_ANSWER_HELDOUT } from "./heldout.js";

export * from "./contracts.js";
export { LONG_ANSWER_QUESTIONS } from "./build.js";

export type LongAnswerDataset = {
  readonly version: typeof LONG_ANSWER_DATASET_VERSION;
  readonly synthetic: true;
  readonly cases: readonly LongAnswerCase[];
};

/** The fixed eval. Every case is validated when the module loads. */
export const LONG_ANSWER_DATASET: LongAnswerDataset = {
  version: LONG_ANSWER_DATASET_VERSION,
  synthetic: true,
  cases: [...LONG_ANSWER_DEV, ...LONG_ANSWER_HELDOUT].map((c) =>
    LongAnswerCaseSchema.parse(c),
  ),
};

/** The task's floor and the owner's held-out share (DECISIONS 72). */
export const LONG_ANSWER_MIN_CASES = 40;
export const LONG_ANSWER_MIN_HELDOUT_SHARE = 0.3;

/** Structural problems with the dataset; empty means it is sound. */
export function lintLongAnswerDataset(
  dataset: LongAnswerDataset = LONG_ANSWER_DATASET,
): string[] {
  const issues: string[] = [];
  const ids = new Set<string>();
  for (const c of dataset.cases) {
    if (ids.has(c.id)) issues.push(`${c.id}: duplicate id`);
    ids.add(c.id);
    const shown = new Set(c.steps.map((s) => s.stepKey));
    const expected = new Set(c.expect.map((e) => e.stepKey));
    for (const e of c.expect)
      if (!shown.has(e.stepKey))
        issues.push(`${c.id}: expects ${e.stepKey}, not shown to the reader`);
    for (const s of c.scripted)
      if (!expected.has(s.stepKey))
        issues.push(`${c.id}: scripted ${s.stepKey} is not expected`);
    if (c.scripted.length !== c.expect.length)
      issues.push(`${c.id}: one scripted value per expected step`);
    // Two steps from one line are each summarised (reader v14).
    if (
      c.category === "TWO_STEPS" &&
      (c.expect.length < 2 || c.expect.some((e) => e.decision !== "SUMMARISE"))
    )
      issues.push(`${c.id}: a two-step line summarises each step`);
  }
  const heldout = dataset.cases.filter((c) => c.split === "heldout").length;
  if (dataset.cases.length < LONG_ANSWER_MIN_CASES)
    issues.push(
      `${String(dataset.cases.length)} cases, want ${String(LONG_ANSWER_MIN_CASES)}+`,
    );
  if (
    heldout / Math.max(1, dataset.cases.length) <
    LONG_ANSWER_MIN_HELDOUT_SHARE
  )
    issues.push(
      `held-out ${String(heldout)}/${String(dataset.cases.length)} is under ${String(LONG_ANSWER_MIN_HELDOUT_SHARE)}`,
    );
  for (const category of LONG_ANSWER_CATEGORIES)
    for (const split of ["dev", "heldout"] as const)
      if (
        !dataset.cases.some((c) => c.category === category && c.split === split)
      )
        issues.push(`${category}: no ${split} case`);
  for (const split of ["dev", "heldout"] as const)
    for (const side of ["FOUNDER", "INVESTOR"] as const)
      for (const decision of ["KEEP", "SUMMARISE"] as const)
        if (
          !dataset.cases.some(
            (c) =>
              c.split === split &&
              c.side === side &&
              c.expect.some((e) => e.decision === decision),
          )
        )
          issues.push(`${split}: no ${side} ${decision} case`);
  return issues;
}
