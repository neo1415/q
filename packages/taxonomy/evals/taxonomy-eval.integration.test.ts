import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
} from "@capital-q/database";

import {
  createPostgresTaxonomyReferenceRepository,
  createTaxonomyCandidateFinder,
  createTaxonomyClassifier,
  createPostgresTaxonomyLexicalSearchRepository,
  gradeFixture,
  summarizeEval,
  TAXONOMY_CLASSIFIER_VERSION,
  TAXONOMY_EVAL_FIXTURES,
  TAXONOMY_EVAL_FIXTURES_VERSION,
  type TaxonomyEvalGrade,
} from "../src/index.js";

/**
 * Taxonomy golden eval (doc 24 §297) -- the deterministic lexical baseline.
 *
 * Runs every version-controlled fixture through the real classifier over
 * the local database, writes a machine-readable report and asserts the
 * hard invariants: curated exact language resolves top-1 every time,
 * deliberately ambiguous phrases stay AMBIGUOUS, unsupported language is
 * ABSTAINED. Lexical top-k and multi-label precision/recall are reported
 * as they are; a weak number is information, not something to hide. This
 * eval establishes the lexical baseline only and proves nothing about any
 * future model classifier. `pnpm eval:taxonomy`.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const REPORT_PATH = fileURLToPath(
  new URL(`./reports/${TAXONOMY_CLASSIFIER_VERSION}.json`, import.meta.url),
);

describe("taxonomy golden eval", () => {
  let db: RequestDatabase;

  beforeAll(() => {
    db = createRequestDatabaseClient(
      parseDatabaseConfig({
        NODE_ENV: "test",
        CAPITAL_Q_ENV: "local",
        DATABASE_URL: TEST_DATABASE_URL,
        DATABASE_POOL_MAX: "2",
        DATABASE_CONNECT_TIMEOUT_SECONDS: "5",
      }),
    );
  });

  afterAll(async () => {
    await db.close();
  });

  it("establishes the deterministic baseline and reports it honestly", async () => {
    const reference = createPostgresTaxonomyReferenceRepository();
    const classifier = createTaxonomyClassifier({
      reference,
      lexical: createPostgresTaxonomyLexicalSearchRepository(),
    });
    const finder = createTaxonomyCandidateFinder({ sql: db.sql, classifier });

    const grades: TaxonomyEvalGrade[] = [];
    for (const fixture of TAXONOMY_EVAL_FIXTURES) {
      const result = await finder.findCandidates({
        text: fixture.text,
        vocabularyCodes: fixture.vocabularyCodes,
        strategy: fixture.strategy,
        limit: fixture.limit,
      });
      grades.push(gradeFixture(fixture, result));
    }

    const report = summarizeEval({
      classifierVersion: TAXONOMY_CLASSIFIER_VERSION,
      taxonomyVersionSet: await reference.getVersionSet(db.sql),
      fixtureVersion: TAXONOMY_EVAL_FIXTURES_VERSION,
      grades,
    });
    mkdirSync(new URL("./reports/", import.meta.url), { recursive: true });
    writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

    const { grades: _grades, ...summary } = report;
    console.log(JSON.stringify(summary, null, 2));

    // Hard invariants (regression gate for alias normalisation, scoring and reference data).
    expect(
      report.exact.top1Accuracy,
      "exact curated aliases must resolve top-1",
    ).toBe(1);
    expect(report.ambiguity.correctlyAmbiguous).toBe(report.ambiguity.count);
    expect(report.abstention.correctAbstentions).toBe(report.abstention.count);
    expect(report.abstention.falseAbstentions).toBe(0);
    expect(grades.filter((g) => g.kind === "EXACT" && !g.passed)).toEqual([]);
    // Quality thresholds for the lexical baseline; reported, not inflated.
    expect(report.lexical.topKAccuracy).toBeGreaterThanOrEqual(0.8);
    expect(report.multiLabel.meanRecall).toBeGreaterThanOrEqual(0.5);
  });
});
