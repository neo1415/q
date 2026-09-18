import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The firewall as a build-time fact. The eligibility subtree must not be
 * able to reach Q memory, conversations, documents, evidence text, public
 * research, embeddings, models or observed behaviour — not through an
 * import, not through a table name, not through a port field. If a later
 * change adds one, this test names it.
 */

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, "..");
const eligibilityDir = join(packageRoot, "src", "eligibility");
const candidatesDir = join(packageRoot, "src", "candidates");
/** CQ-REC-004: the feature layer is held to the strictest list, like eligibility. */
const featuresDir = join(packageRoot, "src", "features");
const adapterFiles = [
  join(
    packageRoot,
    "src",
    "infrastructure",
    "domain-port-eligibility-sources.ts",
  ),
  join(
    packageRoot,
    "src",
    "infrastructure",
    "domain-port-candidate-sources.ts",
  ),
  join(packageRoot, "src", "infrastructure", "domain-port-feature-sources.ts"),
];
/** The feature snapshot store: SQL allowed, over its own table only. */
const featureStoreFile = join(
  packageRoot,
  "src",
  "infrastructure",
  "postgres-feature-snapshot-store.ts",
);

const FORBIDDEN_IMPORTS = [
  "@capital-q/q-knowledge",
  "@capital-q/q-core",
  "@capital-q/q-runtime",
  "@capital-q/q-research",
  "@capital-q/q-embeddings",
  "@capital-q/q-tools",
  "@capital-q/q-orchestrator",
  "@capital-q/q-specialists",
  "@capital-q/model-gateway",
  "@capital-q/evidence",
  "@capital-q/media",
  "@capital-q/onboarding",
  "@capital-q/founder-onboarding",
  "@capital-q/investor-onboarding",
  "@capital-q/q-presence",
];

/**
 * The semantic subtree (CQ-REC-003) may reach the embedding boundary and
 * name its own store — that is its job — but nothing else on the list.
 */
const semanticDir = join(packageRoot, "src", "semantic");
const hybridDir = join(packageRoot, "src", "hybrid");
const semanticAdapterFiles = [
  join(packageRoot, "src", "infrastructure", "domain-port-semantic-sources.ts"),
  join(packageRoot, "src", "infrastructure", "postgres-semantic-store.ts"),
];
const SEMANTIC_ALLOWED_IMPORTS = ["@capital-q/q-embeddings"];
const SEMANTIC_ALLOWED_TOKENS = ["embedding", "pgvector", "qwen"];

const FORBIDDEN_TOKENS = [
  "memory_items",
  "q_knowledge",
  "q_runtime",
  "conversations",
  "evidence.",
  "documents",
  "chunks",
  "embedding",
  "pgvector",
  "tavily",
  "research",
  "transcript",
  "openai",
  "anthropic",
  "groq",
  "gemini",
  "qwen",
  "elevenlabs",
  "presence.signal",
  "watch_time",
  "impression",
];

function sourceFiles(): readonly {
  readonly path: string;
  readonly text: string;
}[] {
  const files = [eligibilityDir, candidatesDir, featuresDir].flatMap((dir) =>
    readdirSync(dir)
      .filter((name) => name.endsWith(".ts"))
      .map((name) => join(dir, name)),
  );
  return [...files, ...adapterFiles].map((path) => ({
    path,
    text: readFileSync(path, "utf8"),
  }));
}

function semanticSourceFiles(): readonly {
  readonly path: string;
  readonly text: string;
}[] {
  const files = [semanticDir, hybridDir].flatMap((dir) =>
    readdirSync(dir)
      .filter((name) => name.endsWith(".ts"))
      .map((name) => join(dir, name)),
  );
  return [...files, ...semanticAdapterFiles].map((path) => ({
    path,
    text: readFileSync(path, "utf8"),
  }));
}

describe("eligibility boundary", () => {
  it("imports nothing from Q, evidence, media, onboarding or model packages", () => {
    for (const { path, text } of sourceFiles()) {
      for (const forbidden of FORBIDDEN_IMPORTS) {
        expect(text, `${path} imports ${forbidden}`).not.toContain(
          `"${forbidden}`,
        );
      }
    }
  });

  it("names no private store, provider or behavioural signal anywhere in its source", () => {
    for (const { path, text } of sourceFiles()) {
      // Comments explain what is excluded and may name it; code may not.
      const code = text
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "")
        .toLowerCase();
      for (const token of FORBIDDEN_TOKENS) {
        expect(code, `${path} mentions ${token}`).not.toContain(token);
      }
    }
  });

  it("contains no SQL: every read goes through an owning context's port", () => {
    for (const { path, text } of sourceFiles()) {
      const code = text
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      expect(code, path).not.toMatch(/\bsql`/);
      expect(code, path).not.toMatch(/\bselect\s+[\w.*]+\s+from\b/i);
    }
  });

  it("the package manifest depends on owning contexts and the embedding boundary only", () => {
    const manifest = JSON.parse(
      readFileSync(join(packageRoot, "package.json"), "utf8"),
    ) as { dependencies: Record<string, string> };
    const names = Object.keys(manifest.dependencies);
    for (const forbidden of FORBIDDEN_IMPORTS) {
      if (SEMANTIC_ALLOWED_IMPORTS.includes(forbidden)) continue;
      expect(names).not.toContain(forbidden);
    }
    // The one Q-side package the semantic generator may use: the local
    // embedding provider boundary, which holds no knowledge, memory,
    // documents or conversations.
    expect(names).toContain("@capital-q/q-embeddings");
    expect(names).toEqual(
      expect.arrayContaining([
        "@capital-q/companies",
        "@capital-q/investors",
        "@capital-q/taxonomy",
        "@capital-q/network",
        "@capital-q/permissions",
      ]),
    );
  });
});

describe("semantic boundary (CQ-REC-003)", () => {
  it("reaches the embedding boundary and nothing else private", () => {
    for (const { path, text } of semanticSourceFiles()) {
      for (const forbidden of FORBIDDEN_IMPORTS) {
        if (SEMANTIC_ALLOWED_IMPORTS.includes(forbidden)) continue;
        expect(text, `${path} imports ${forbidden}`).not.toContain(
          `"${forbidden}`,
        );
      }
    }
  });

  it("names no private store, generation provider, research tool or behavioural signal in code", () => {
    for (const { path, text } of semanticSourceFiles()) {
      const code = text
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "")
        // The embedding port's own method name, not a document store.
        .replace(/embedDocuments/g, "")
        .toLowerCase();
      for (const token of FORBIDDEN_TOKENS) {
        if (SEMANTIC_ALLOWED_TOKENS.includes(token)) continue;
        expect(code, `${path} mentions ${token}`).not.toContain(token);
      }
    }
  });

  it("only the recommendation store adapter contains SQL, and it reads only its own schema and core.companies", () => {
    for (const { path, text } of semanticSourceFiles()) {
      const code = text
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      if (path.endsWith("postgres-semantic-store.ts")) {
        // Every table named after FROM / JOIN / INTO / UPDATE in the file.
        const tokens = code.replace(/[`(),;]/g, " ").split(/\s+/);
        const tables: string[] = [];
        for (const [index, token] of tokens.entries()) {
          const next = tokens[index + 1];
          if (
            /^(?:from|join|into|update)$/i.test(token) &&
            next !== undefined &&
            /^[a-z_]+\.[a-z_]+$/i.test(next)
          ) {
            tables.push(next.toLowerCase());
          }
        }
        expect(new Set(tables)).toEqual(
          new Set([
            "recommendation.company_representations",
            "recommendation.company_embeddings",
            "recommendation.mandate_representations",
            "recommendation.mandate_embeddings",
            "core.companies",
          ]),
        );
        continue;
      }
      expect(code, path).not.toMatch(/\bsql`/);
      expect(code, path).not.toMatch(/\bselect\s+[\w.*]+\s+from\b/i);
    }
  });
});

describe("feature store boundary (CQ-REC-004)", () => {
  it("imports nothing private and names no private store, provider or signal", () => {
    const text = readFileSync(featureStoreFile, "utf8");
    for (const forbidden of FORBIDDEN_IMPORTS) {
      expect(text, `imports ${forbidden}`).not.toContain(`"${forbidden}`);
    }
    const code = text
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "")
      .toLowerCase();
    for (const token of FORBIDDEN_TOKENS) {
      expect(code, `mentions ${token}`).not.toContain(token);
    }
  });

  it("reads and writes recommendation.feature_snapshots and nothing else", () => {
    const code = readFileSync(featureStoreFile, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    const tokens = code.replace(/[`(),;]/g, " ").split(/\s+/);
    const tables = new Set<string>();
    for (const [index, token] of tokens.entries()) {
      const next = tokens[index + 1];
      if (
        /^(?:from|join|into|update)$/i.test(token) &&
        next !== undefined &&
        /^[a-z_]+\.[a-z_]+$/i.test(next)
      ) {
        tables.add(next.toLowerCase());
      }
    }
    expect(tables).toEqual(new Set(["recommendation.feature_snapshots"]));
  });
});
