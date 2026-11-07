import {
  sameNavigationPlace,
  sitePlaceToTarget,
  targetToSitePlace,
} from "@capital-q/model-gateway/q";

import { canonicalTarget } from "../../graders/q-nav.js";
import { CaseSet } from "./build.js";
import {
  Q_NAV_CATEGORIES,
  Q_NAV_DATASET_VERSION,
  QNavCaseSchema,
  type QNavCase,
  type QNavSide,
  type QNavTarget,
} from "./contracts.js";
import { coverage } from "./coverage.js";
import { devCurveballs } from "./curveballs.js";
import { heldoutFourth } from "./heldout-fourth.js";
import { heldoutThird } from "./heldout-third.js";
import {
  destinationDef,
  Q_NAV_CONTRACT_PAGES,
  Q_NAV_DESTINATIONS,
  foldedOf,
  Q_NAV_RECORD_PAGES,
  recordPageDef,
  sidesOf,
} from "./vocabulary.js";
import { Q_NAV_COMPANIES, Q_NAV_INVESTORS, Q_NAV_THINGS } from "./world.js";

export * from "./contracts.js";
export * from "./vocabulary.js";
export {
  company as navCompany,
  navId,
  Q_NAV_COMPANIES,
  Q_NAV_DELETED_COMPANY,
  Q_NAV_FOUNDER_COMPANY_KEY,
  Q_NAV_INVESTORS,
  Q_NAV_RECORDS,
  Q_NAV_THINGS,
  type QNavRecords,
} from "./world.js";

export type QNavDataset = {
  readonly version: typeof Q_NAV_DATASET_VERSION;
  readonly synthetic: true;
  readonly cases: readonly QNavCase[];
};

/** Both splits, built from scratch (each with its own banks and curveballs). */
export function buildQNavCases(): QNavCase[] {
  const dev = new CaseSet("dev");
  coverage(dev);
  devCurveballs(dev);
  // The held-out split (owner decision 75): written fresh, by a separate
  // author, from each place's purpose; sealed (heldout-seal.ts). The
  // earlier held-out set was measured once and is retired.
  const heldout = new CaseSet("heldout");
  heldoutThird(heldout);
  // Batch 8: the fourth held-out set, after v10 (sealed in heldout-seal.ts).
  const heldout4 = new CaseSet("heldout4");
  heldoutFourth(heldout4);
  return [...dev.out, ...heldout.out, ...heldout4.out].map((c) =>
    QNavCaseSchema.parse(c),
  );
}

/** The fixed eval. Every case is validated when the module loads. */
export const Q_NAV_DATASET: QNavDataset = {
  version: Q_NAV_DATASET_VERSION,
  synthetic: true,
  cases: buildQNavCases(),
};

/** The plan's floor (W4.4) and the owner's held-out share. */
export const Q_NAV_MIN_TURNS = 400;
export const Q_NAV_MIN_HELDOUT_SHARE = 0.3;

const KNOWN_RECORDS = new Set([
  ...Q_NAV_COMPANIES.map((c) => c.id),
  ...Q_NAV_INVESTORS.map((i) => i.id),
  ...Object.values(Q_NAV_THINGS).map((t) => t.id),
]);

/** Problems with one target against the vocabulary and world; empty means sound. */
export function targetProblems(target: QNavTarget, side: QNavSide): string[] {
  const problems: string[] = [];
  const destination = destinationDef(target.page);
  const record = recordPageDef(target.page);
  if (destination === undefined && record === undefined)
    return [`unknown page ${target.page}`];
  if (!sidesOf(target.page).includes(side))
    problems.push(`${target.page} is closed to ${side}`);
  if (record?.sameAs !== undefined)
    problems.push(
      `${target.page} is an alias of ${record.sameAs.page}: use that`,
    );
  if (target.tab !== undefined && !(record?.tabs ?? []).includes(target.tab))
    problems.push(`${target.page} has no tab ${target.tab}`);
  if (target.sectionId !== undefined) {
    const sections = destination?.sections ?? record?.sections ?? [];
    if (
      !sections.some(
        (s) =>
          s.id === target.sectionId &&
          s.status === "EXISTS" &&
          (s.side === undefined || s.side === side),
      )
    )
      problems.push(
        `${target.page} has no section ${target.sectionId} for ${side}`,
      );
  }
  if (target.recordId !== undefined && !KNOWN_RECORDS.has(target.recordId))
    problems.push(`unknown record ${target.recordId}`);
  if (target.itemId !== undefined && !KNOWN_RECORDS.has(target.itemId))
    problems.push(`unknown item ${target.itemId}`);
  if (target.documentId !== undefined) {
    const owner = Q_NAV_COMPANIES.find((c) => c.id === target.recordId);
    if (
      owner === undefined ||
      !owner.documents.some((d) => d.id === target.documentId)
    )
      problems.push("a document belongs to the company shown");
  }
  if (target.position === "top")
    problems.push("top is the default: leave position out");
  // The site map's own place: said in its words and read back, the same
  // (no leading section, no list tab on a record, a company at its tab).
  if (problems.length === 0) {
    const place = targetToSitePlace(target);
    const back =
      place === null
        ? null
        : sitePlaceToTarget(place, {
            recordId:
              target.page === "BOARD" ? null : (target.recordId ?? null),
            documentId: target.documentId ?? null,
            itemId: target.itemId ?? null,
          });
    // Same-place names (SEARCH and EXPLORE) count as one, as graded.
    if (
      back === null ||
      JSON.stringify(canonicalTarget(back, side)) !==
        JSON.stringify(canonicalTarget(target, side))
    )
      problems.push(
        `not the site map's own place: it reads back as ${JSON.stringify(back)}`,
      );
  }
  return problems;
}

/** Structural problems with the dataset; empty means it is sound. */
export function lintQNavDataset(
  dataset: QNavDataset = Q_NAV_DATASET,
): string[] {
  const issues: string[] = [];
  const ids = new Set<string>();
  let turns = 0;
  let heldout = 0;
  const moved = new Map<string, Set<string>>(); // split -> page:side
  for (const c of dataset.cases) {
    if (ids.has(c.id)) issues.push(`${c.id}: duplicate id`);
    ids.add(c.id);
    c.turns.forEach((t, i) => {
      turns += 1;
      if (c.split === "heldout") heldout += 1;
      const at = `${c.id}#${String(i)}`;
      for (const p of targetProblems(t.context.at, c.side))
        issues.push(`${at} context: ${p}`);
      if (t.context.previous !== null)
        for (const p of targetProblems(t.context.previous, c.side))
          issues.push(`${at} previous: ${p}`);
      for (const [name, target] of [
        ["target", t.expect.target],
        ["remembered", t.expect.remembered],
      ] as const) {
        if (target === null) continue;
        for (const p of targetProblems(target, c.side))
          issues.push(`${at} ${name}: ${p}`);
        if (t.expect.forbiddenPages.includes(target.page))
          issues.push(`${at}: ${name} ${target.page} is also forbidden`);
      }
      if (
        t.expect.target !== null &&
        sameNavigationPlace(t.expect.target, t.context.at)
      )
        issues.push(
          `${at}: a ${t.expect.decision} to where the pane already is`,
        );
      if (t.expect.decision === "MOVE" && t.expect.target !== null) {
        const set = moved.get(c.split) ?? new Set<string>();
        set.add(`${t.expect.target.page}:${c.side}`);
        // A section also covers the destination folded into it.
        if (t.expect.target.sectionId !== undefined)
          set.add(
            `${t.expect.target.page}#${t.expect.target.sectionId}:${c.side}`,
          );
        moved.set(c.split, set);
      }
      if (
        (t.context.dirty || t.context.busy !== null) &&
        t.expect.decision === "MOVE"
      )
        issues.push(`${at}: a MOVE with unsaved work or a busy pane`);
      if (
        t.context.pane === "COLLAPSED" &&
        t.expect.decision === "MOVE" &&
        !t.expect.openPane
      )
        issues.push(`${at}: a MOVE behind a collapsed pane must open it`);
      if (t.context.pane === "OPEN" && t.expect.openPane)
        issues.push(`${at}: the pane is already open`);
    });
  }
  if (turns < Q_NAV_MIN_TURNS)
    issues.push(`${String(turns)} turns, want ${String(Q_NAV_MIN_TURNS)}+`);
  if (heldout / Math.max(1, turns) < Q_NAV_MIN_HELDOUT_SHARE)
    issues.push(
      `held-out ${String(heldout)}/${String(turns)} is under ${String(Q_NAV_MIN_HELDOUT_SHARE)}`,
    );
  // Coverage: every page the contracts know is a MOVE target, for every
  // side that may open it, in both splits (aliases count as their page).
  for (const split of ["dev", "heldout"] as const) {
    const set = moved.get(split) ?? new Set<string>();
    for (const page of [
      ...Q_NAV_CONTRACT_PAGES.destinations,
      ...Q_NAV_CONTRACT_PAGES.recordPages,
    ]) {
      const def = recordPageDef(page);
      const folded = foldedOf(page);
      const canonical =
        folded === undefined
          ? (def?.sameAs?.page ?? page)
          : folded.sectionId === null
            ? folded.page
            : `${folded.page}#${folded.sectionId}`;
      for (const side of sidesOf(page)) {
        if (!set.has(`${canonical}:${side}`))
          issues.push(`${split}: no MOVE to ${page} for ${side}`);
      }
      if (
        sidesOf(page).length === 0 &&
        destinationDef(page) === undefined &&
        def === undefined
      )
        issues.push(`${page}: no access rule in vocabulary.ts`);
    }
  }
  for (const page of Q_NAV_CONTRACT_PAGES.destinations)
    if (destinationDef(page) === undefined)
      issues.push(`destination ${page} is not in vocabulary.ts`);
  for (const page of Q_NAV_CONTRACT_PAGES.recordPages)
    if (recordPageDef(page) === undefined)
      issues.push(`record page ${page} is not in vocabulary.ts`);
  void Q_NAV_DESTINATIONS;
  void Q_NAV_RECORD_PAGES;
  for (const category of Q_NAV_CATEGORIES) {
    for (const split of ["dev", "heldout"] as const) {
      if (
        !dataset.cases.some((c) => c.category === category && c.split === split)
      )
        issues.push(`${category}: no ${split} case`);
    }
    for (const side of ["INVESTOR", "FOUNDER"] as const) {
      if (
        !dataset.cases.some((c) => c.category === category && c.side === side)
      )
        issues.push(`${category}: no ${side} case`);
    }
  }
  return issues;
}
