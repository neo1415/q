import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { createPromptRegistry, PROMPT_DEFINITIONS } from "../src/index.js";

/**
 * Rewrite `prompts.lock.json` from the registry.
 *
 * The lock exists so that changing a published prompt's text without
 * publishing a new version fails the build. Regenerating it is therefore
 * a deliberate act, not something a test run does on its own: this is
 * skipped unless CQ_REGENERATE_PROMPT_LOCK is set, and the reviewer sees
 * the resulting diff beside the new version that caused it.
 */
describe("the prompt lock", () => {
  it.skipIf(process.env["CQ_REGENERATE_PROMPT_LOCK"] !== "1")(
    "is rewritten from the registry when asked",
    () => {
      const registry = createPromptRegistry(PROMPT_DEFINITIONS);
      const entries = Object.fromEntries(
        registry
          .list()
          .map((record) => [record.versionId, record.contentHash])
          .sort(([a], [b]) => String(a).localeCompare(String(b))),
      );
      const path = resolve(import.meta.dirname, "..", "prompts.lock.json");
      const existing: unknown = JSON.parse(readFileSync(path, "utf8"));
      const next = {
        ...(typeof existing === "object" && existing !== null ? existing : {}),
        entries,
      };
      writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
      expect(Object.keys(entries).length).toBeGreaterThan(0);
    },
  );
});
