import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * W1-A (enterprise audit 21 Nov 2026, findings 3 and 4): two rules that stop
 * new debt without asking anyone to fix the old at once.
 *
 *   1. No new inline SQL in apps/*: SQL belongs in a package's repository
 *      (`packages/<context>/src/infrastructure`). A file in apps/*\/src that
 *      has none today may not gain any; one that has some may not gain more.
 *   2. A new source file is at most NEW_FILE_MAX_LINES lines. Files already
 *      longer are baselined (they are the god files the audit plans to
 *      split); a file not in the baseline may not cross the line.
 *
 * Existing violations are the baseline (debt-baseline.json, next to this
 * test). It only ever shrinks: a file that improves can be lowered with
 *   CQ_WRITE_DEBT_BASELINE=1 npx vitest run apps/api/test/debt-guard.test.ts
 * which rewrites it from the tree as it is. Raising it by hand is the one
 * thing a reviewer must refuse.
 */
const NEW_FILE_MAX_LINES = 1_500;

const ROOT = join(import.meta.dirname, "..", "..", "..");
const BASELINE = join(import.meta.dirname, "debt-baseline.json");

type Baseline = {
  readonly inlineSql: Record<string, number>;
  readonly longFiles: Record<string, number>;
};

function sources(dir: string): string[] {
  let out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === ".next")
      continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out = out.concat(sources(path));
    else if (/\.(?:ts|tsx|mts)$/u.test(name) && !/\.d\.ts$/u.test(name))
      out.push(path);
  }
  return out;
}

/** Tagged SQL templates: sql`…`, tx.sql`…`, sql<Row[]>`…`. */
const INLINE_SQL = /\bsql\s*(?:<[^`;]{0,200}?>)?\s*`/gu;

/**
 * W2-A and W2-B (finding 8): the own-conversation and own-onboarding
 * checks live in one place. A copy of either (a local ownConversation, or
 * code reading the OWN_Q_CONVERSATION or OWN_ONBOARDING scope itself,
 * through actorWideScope or a `.kind ===` test) is refused anywhere else;
 * there is no baseline: zero.
 */
const OWN_CONVERSATION_HOME = "packages/q-runtime/src/domain/own-scopes.ts";
const OWN_CONVERSATION_COPY =
  /\bfunction\s+own(?:Conversation|Onboarding)s?\b|actorWideScope\(\s*[\w.]+\s*,\s*"OWN_(?:Q_CONVERSATION|ONBOARDING)"\s*\)|\.kind\s*===\s*"OWN_(?:Q_CONVERSATION|ONBOARDING)"/gu;
const ownConversationCopies: string[] = [];

function scan(): Baseline {
  const inlineSql: Record<string, number> = {};
  const longFiles: Record<string, number> = {};
  const roots = [
    ...readdirSync(join(ROOT, "apps")).map((app) =>
      join(ROOT, "apps", app, "src"),
    ),
    ...readdirSync(join(ROOT, "packages")).map((pkg) =>
      join(ROOT, "packages", pkg, "src"),
    ),
  ];
  for (const root of roots) {
    let files: string[];
    try {
      files = sources(root);
    } catch {
      continue;
    }
    for (const file of files) {
      const path = relative(ROOT, file);
      const text = readFileSync(file, "utf8");
      const lines = text.split("\n").length;
      if (lines > NEW_FILE_MAX_LINES) longFiles[path] = lines;
      if (
        path !== OWN_CONVERSATION_HOME &&
        (text.match(OWN_CONVERSATION_COPY) ?? []).length > 0
      ) {
        ownConversationCopies.push(path);
      }
      if (path.startsWith("apps/")) {
        const count = (text.match(INLINE_SQL) ?? []).length;
        if (count > 0) inlineSql[path] = count;
      }
    }
  }
  const sorted = (record: Record<string, number>) =>
    Object.fromEntries(
      Object.entries(record).sort(([a], [b]) => a.localeCompare(b)),
    );
  return { inlineSql: sorted(inlineSql), longFiles: sorted(longFiles) };
}

const now = scan();
if (process.env["CQ_WRITE_DEBT_BASELINE"] === "1") {
  writeFileSync(BASELINE, `${JSON.stringify(now, null, 2)}\n`);
}
const baseline = JSON.parse(readFileSync(BASELINE, "utf8")) as Baseline;

describe("no new debt (W1-A)", () => {
  it("no new inline SQL in apps/*, and none added where some is baselined", () => {
    const grown = Object.entries(now.inlineSql)
      .filter(([file, count]) => count > (baseline.inlineSql[file] ?? 0))
      .map(
        ([file, count]) =>
          `${file}: ${String(count)} (baseline ${String(baseline.inlineSql[file] ?? 0)})`,
      );
    expect(grown, "move the SQL into the owning package's repository").toEqual(
      [],
    );
  });

  it(`a source file not in the baseline is at most ${String(NEW_FILE_MAX_LINES)} lines`, () => {
    const over = Object.entries(now.longFiles)
      .filter(([file]) => baseline.longFiles[file] === undefined)
      .map(([file, lines]) => `${file}: ${String(lines)} lines`);
    expect(over, "split the file rather than raise its baseline").toEqual([]);
  });

  it("W3-A: a baselined long file may only shrink (the god files being split)", () => {
    const grown = Object.entries(now.longFiles)
      .filter(
        ([file, lines]) =>
          baseline.longFiles[file] !== undefined &&
          lines > (baseline.longFiles[file] ?? 0) &&
          // Generated from the message catalogue; its size follows the UI.
          !file.endsWith(".generated.ts"),
      )
      .map(
        ([file, lines]) =>
          `${file}: ${String(lines)} lines (baseline ${String(baseline.longFiles[file] ?? 0)})`,
      );
    expect(grown, "move code out of the file rather than add to it").toEqual(
      [],
    );
  });

  it("W2-A/B: no copy of the own-conversation or own-onboarding check outside its home", () => {
    expect(
      ownConversationCopies,
      `use ownsConversation or ownsOnboarding from @capital-q/q-runtime (${OWN_CONVERSATION_HOME})`,
    ).toEqual([]);
    const copies = [
      "function ownConversation(actor, plan) {",
      'const scope = actorWideScope(context.plan, "OWN_Q_CONVERSATION");',
      'const scope = actorWideScope(context.plan, "OWN_ONBOARDING");',
      'plan.scopes.some((scope) => scope.kind === "OWN_ONBOARDING");',
      'if (!ownsConversation({ actor, plan })) return deny("NOT_AVAILABLE");',
      'if (!ownsOnboarding(context)) return deny("NOT_AVAILABLE");',
    ].join("\n");
    expect(copies.match(OWN_CONVERSATION_COPY)?.length).toBe(4);
  });

  it("the rules catch what they are meant to", () => {
    const sample = [
      "const rows = await sql<{ id: string }[]>`select 1`;",
      "await tx.sql`insert into x values (1)`;",
      "await database.sql`select 1`;",
      "const label = 'sql'; // not a query",
    ].join("\n");
    expect(sample.match(INLINE_SQL)?.length).toBe(3);
  });
});
