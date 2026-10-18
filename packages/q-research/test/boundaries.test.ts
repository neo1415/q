import { readdirSync, readFileSync, type Dirent } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Package boundaries (CQ-Q-RESEARCH-001 §5, §45): the vendor SDK lives in one
 * adapter file; the package reaches no domain write surface, no database,
 * no company or investor service, and uses only search and extract.
 */
const SRC = join(import.meta.dirname, "..", "src");

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? walk(join(dir, entry.name))
      : entry.name.endsWith(".ts")
        ? [join(dir, entry.name)]
        : [],
  );
}

function walkAny(dir: string): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((entry) =>
    entry.isDirectory()
      ? walkAny(join(dir, entry.name))
      : /\.(ts|tsx|mts|js|mjs)$/.test(entry.name)
        ? [join(dir, entry.name)]
        : [],
  );
}

describe("q-research boundaries", () => {
  const files = walk(SRC);

  it("imports the vendor SDK only in the Tavily adapter", () => {
    const offenders = files.filter(
      (file) =>
        !file.endsWith(join("providers", "tavily.ts")) &&
        /@tavily\//.test(readFileSync(file, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("never reaches a database, a domain service or a model gateway", () => {
    const forbidden = [
      "@capital-q/database",
      "@capital-q/companies",
      "@capital-q/investors",
      "@capital-q/evidence",
      "@capital-q/q-knowledge",
      "@capital-q/model-gateway",
      "@capital-q/onboarding",
      "postgres",
      "node:child_process",
    ];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const dependency of forbidden) {
        expect(text, `${file} imports ${dependency}`).not.toContain(
          `"${dependency}`,
        );
      }
    }
  });

  it("uses only search and extract of the vendor client — no crawl, map or research", () => {
    const adapter = readFileSync(join(SRC, "providers", "tavily.ts"), "utf8");
    expect(adapter).not.toMatch(
      /client\.(crawl|map|research|getResearch|searchQNA|searchContext)\b/,
    );
    expect(adapter).toMatch(/client\.search\(/);
    expect(adapter).toMatch(/client\.extract\(/);
  });

  it("keeps the vendor SDK and the research package out of the web app, q-core, contracts, the domains and onboarding", () => {
    const repo = join(import.meta.dirname, "..", "..", "..");
    const roots = [
      join(repo, "apps", "web", "src"),
      join(repo, "packages", "q-core", "src"),
      join(repo, "packages", "contracts", "src"),
      join(repo, "packages", "companies", "src"),
      join(repo, "packages", "investors", "src"),
      join(repo, "packages", "capital", "src"),
      join(repo, "packages", "network", "src"),
      join(repo, "packages", "evidence", "src"),
      join(repo, "packages", "onboarding", "src"),
      join(repo, "packages", "founder-onboarding", "src"),
      join(repo, "packages", "investor-onboarding", "src"),
      join(repo, "packages", "q-firewall", "src"),
      join(repo, "packages", "q-runtime", "src"),
    ];
    const offenders: string[] = [];
    for (const root of roots) {
      for (const file of walkAny(root)) {
        const text = readFileSync(file, "utf8");
        if (/@tavily\/|"@capital-q\/q-research|\btavily\b/i.test(text)) {
          offenders.push(file);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
