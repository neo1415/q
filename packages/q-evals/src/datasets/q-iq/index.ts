import { buildQIqCases } from "./cases.js";
import {
  Q_IQ_CATEGORIES,
  Q_IQ_DATASET_VERSION,
  QIqCaseSchema,
  type QIqCase,
} from "./contracts.js";
import { Q_IQ_ENTITIES, Q_IQ_FACTS } from "./world.js";

export * from "./contracts.js";
export {
  Q_IQ_LIVE_GAPS_2026_11_06,
  type QIqLiveGap,
} from "./live-2026-11-06.js";
export {
  Q_IQ_COMPANIES,
  Q_IQ_CONTRADICTIONS,
  Q_IQ_DOCUMENTS,
  Q_IQ_ENTITIES,
  Q_IQ_FACTS,
  Q_IQ_PEOPLE,
} from "./world.js";

export type QIqDataset = {
  readonly version: typeof Q_IQ_DATASET_VERSION;
  readonly synthetic: true;
  readonly cases: readonly QIqCase[];
};

/** The fixed benchmark. Every case is validated when the module loads. */
export const Q_IQ_DATASET: QIqDataset = {
  version: Q_IQ_DATASET_VERSION,
  synthetic: true,
  cases: buildQIqCases().map((c) => QIqCaseSchema.parse(c)),
};

export const Q_IQ_WORLD = {
  entities: Q_IQ_ENTITIES,
  facts: Q_IQ_FACTS,
} as const;

/** Structural problems with the dataset; empty means it is sound. */
export function lintQIqDataset(dataset: QIqDataset = Q_IQ_DATASET): string[] {
  const issues: string[] = [];
  const ids = new Set<string>();
  const entityIds = new Set(Q_IQ_ENTITIES.map((e) => e.id));
  for (const c of dataset.cases) {
    if (ids.has(c.id)) issues.push(`${c.id}: duplicate id`);
    ids.add(c.id);
    c.turns.forEach((t, i) => {
      for (const id of [
        ...t.expect.entityIds,
        ...t.expect.forbiddenEntityIds,
        ...t.expect.clarifyOptions,
      ]) {
        if (!entityIds.has(id))
          issues.push(`${c.id}#${i}: unknown entity ${id}`);
      }
      if (
        t.expect.behaviour === "CLARIFY" &&
        t.expect.clarifyOptions.length < 2
      ) {
        issues.push(`${c.id}#${i}: a clarify needs two readings`);
      }
    });
  }
  for (const category of Q_IQ_CATEGORIES) {
    const n = dataset.cases.filter((c) => c.category === category).length;
    if (category === "ADVERSARIAL") {
      if (n < 10) issues.push(`${category}: ${n} cases, want at least 10`);
    } else if (n !== 15) issues.push(`${category}: ${n} cases, want 15`);
  }
  for (const c of dataset.cases) {
    const adversarial = c.category === "ADVERSARIAL";
    if (adversarial && (c.planted ?? []).length === 0)
      issues.push(`${c.id}: an adversarial case plants nothing`);
    if (!adversarial && c.planted !== undefined)
      issues.push(`${c.id}: only adversarial cases plant content`);
    c.turns.forEach((t, i) => {
      if (adversarial !== (t.expect.adversarial !== undefined))
        issues.push(
          `${c.id}#${i}: adversarial aims belong to adversarial cases`,
        );
    });
  }
  const core = dataset.cases.filter((c) => c.category !== "ADVERSARIAL");
  if (core.length !== 150) issues.push(`${core.length} core cases, want 150`);
  return issues;
}
