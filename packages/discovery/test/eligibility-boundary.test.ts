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
const adapterFile = join(
  packageRoot,
  "src",
  "infrastructure",
  "domain-port-eligibility-sources.ts",
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
  const files = readdirSync(eligibilityDir)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => join(eligibilityDir, name));
  return [...files, adapterFile].map((path) => ({
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

  it("the package manifest depends on owning contexts only", () => {
    const manifest = JSON.parse(
      readFileSync(join(packageRoot, "package.json"), "utf8"),
    ) as { dependencies: Record<string, string> };
    const names = Object.keys(manifest.dependencies);
    for (const forbidden of FORBIDDEN_IMPORTS) {
      expect(names).not.toContain(forbidden);
    }
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
