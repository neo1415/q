import { buildQNavCases } from "./cases.js";
import {
  Q_NAV_CATEGORIES,
  Q_NAV_DATASET_VERSION,
  QNavCaseSchema,
  type QNavCase,
  type QNavSide,
  type QNavTarget,
} from "./contracts.js";
import { Q_NAV_PAGES } from "./vocabulary.js";

export * from "./contracts.js";
export {
  navPage,
  pagesClosedTo,
  Q_NAV_PAGES,
  type QNavPage,
  type QNavPlaceStatus,
  type QNavSection,
} from "./vocabulary.js";
export { Q_NAV_FOUNDER_COMPANY, Q_NAV_INVESTORS } from "./cases.js";

/** A fresh build, for the determinism test. */
export const buildQNavCasesForTest = (): QNavCase[] =>
  buildQNavCases().map((c) => QNavCaseSchema.parse(c));

export type QNavDataset = {
  readonly version: typeof Q_NAV_DATASET_VERSION;
  readonly synthetic: true;
  readonly cases: readonly QNavCase[];
};

/** The fixed eval. Every case is validated when the module loads. */
export const Q_NAV_DATASET: QNavDataset = {
  version: Q_NAV_DATASET_VERSION,
  synthetic: true,
  cases: buildQNavCases().map((c) => QNavCaseSchema.parse(c)),
};

/** The plan's floor (W4.4): at least 400 turns. */
export const Q_NAV_MIN_TURNS = 400;
/** The held-out split's least share of the turns. */
export const Q_NAV_MIN_HELDOUT_SHARE = 0.2;

/** Problems with one target against the vocabulary; empty means sound. */
export function targetProblems(
  target: QNavTarget,
  side: QNavSide | null,
): string[] {
  const problems: string[] = [];
  const page = Q_NAV_PAGES.find((p) => p.page === target.page);
  if (page === undefined) return [`unknown page ${target.page}`];
  if (side !== null && !page.sides.includes(side)) {
    problems.push(`${target.page} is closed to ${side}`);
  }
  if (target.tab !== undefined && !page.tabs.some((t) => t.id === target.tab)) {
    problems.push(`${target.page} has no tab ${target.tab}`);
  }
  if (target.sectionId !== undefined) {
    const section = page.sections.find((s) => s.id === target.sectionId);
    if (section === undefined) {
      problems.push(`${target.page} has no section ${target.sectionId}`);
    } else if (
      section.tab !== undefined &&
      target.tab !== undefined &&
      section.tab !== target.tab
    ) {
      problems.push(
        `${target.page} section ${target.sectionId} is on tab ${section.tab}`,
      );
    }
  }
  if (page.subject === undefined && target.subject !== undefined) {
    problems.push(`${target.page} shows no record`);
  }
  if (page.subject !== undefined && target.subject === undefined) {
    problems.push(`${target.page} needs its record`);
  }
  if (target.subject !== undefined && page.subject !== undefined) {
    const isCompany = target.subject.startsWith("co-");
    if (page.subject === "COMPANY" && !isCompany)
      problems.push(`${target.page} shows a company`);
    if (page.subject === "INVESTOR" && isCompany)
      problems.push(`${target.page} shows an investor`);
  }
  if (
    target.thread !== undefined &&
    target.thread.counterpart !== target.subject
  ) {
    problems.push("a thread is the subject's own");
  }
  if (target.sectionId !== undefined && target.position !== "section") {
    problems.push("a section is arrived at by position section");
  }
  return problems;
}

/** Structural problems with the dataset; empty means it is sound. */
export function lintQNavDataset(
  dataset: QNavDataset = Q_NAV_DATASET,
): string[] {
  const issues: string[] = [];
  const ids = new Set<string>();
  const pages = new Set(Q_NAV_PAGES.map((p) => p.page));
  let turns = 0;
  let heldout = 0;
  for (const c of dataset.cases) {
    if (ids.has(c.id)) issues.push(`${c.id}: duplicate id`);
    ids.add(c.id);
    c.turns.forEach((t, i) => {
      turns += 1;
      if (c.split === "heldout") heldout += 1;
      const at = `${c.id}#${String(i)}`;
      for (const problem of targetProblems(t.context.at, c.side)) {
        issues.push(`${at} context: ${problem}`);
      }
      for (const [name, target] of [
        ["target", t.expect.target],
        ["remembered", t.expect.remembered],
      ] as const) {
        if (target === null) continue;
        for (const problem of targetProblems(target, c.side)) {
          issues.push(`${at} ${name}: ${problem}`);
        }
        if (t.expect.forbiddenPages.includes(target.page)) {
          issues.push(`${at}: ${name} ${target.page} is also forbidden`);
        }
      }
      for (const page of t.expect.forbiddenPages) {
        if (!pages.has(page)) issues.push(`${at}: unknown forbidden ${page}`);
      }
      // The hard constraints (plan W4.2), as the dataset states them.
      if (
        (t.context.dirty || t.context.busy !== null) &&
        t.expect.decision === "MOVE"
      ) {
        issues.push(`${at}: a MOVE with unsaved work or a busy pane`);
      }
      if (
        t.context.pane === "COLLAPSED" &&
        t.expect.decision === "MOVE" &&
        !t.expect.openPane
      ) {
        issues.push(`${at}: a MOVE behind a collapsed pane must open it`);
      }
      if (t.context.pane === "OPEN" && t.expect.openPane) {
        issues.push(`${at}: the pane is already open`);
      }
    });
  }
  if (turns < Q_NAV_MIN_TURNS)
    issues.push(
      `${String(turns)} turns, want at least ${String(Q_NAV_MIN_TURNS)}`,
    );
  if (heldout / Math.max(1, turns) < Q_NAV_MIN_HELDOUT_SHARE)
    issues.push(
      `held-out share ${String(heldout)}/${String(turns)} is too small`,
    );
  for (const category of Q_NAV_CATEGORIES) {
    const of = dataset.cases.filter((c) => c.category === category);
    if (of.length === 0) issues.push(`${category}: no cases`);
    for (const side of ["INVESTOR", "FOUNDER"] as const) {
      if (!of.some((c) => c.side === side))
        issues.push(`${category}: no ${side} case`);
    }
  }
  const storyboard = dataset.cases
    .filter((c) => c.category === "STORYBOARD")
    .reduce((n, c) => n + c.turns.length, 0);
  if (storyboard !== 10)
    issues.push(`storyboard: ${String(storyboard)} turns, want 10`);
  return issues;
}
