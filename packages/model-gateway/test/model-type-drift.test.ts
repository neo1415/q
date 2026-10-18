import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ModelTypeSchema } from "@capital-q/contracts";
import { describe, expect, it } from "vitest";

/**
 * The catalog snapshot is parsed whole: one ai_ops.models row whose type
 * the contract does not know fails every Q model call. Live 2026-10-01 the
 * DOCS migration added IMAGE_GENERATION models and Q stopped answering.
 * Every type the latest check constraint allows must parse.
 */
describe("ai_ops.models types and the contract", () => {
  it("knows every model_type the database allows", () => {
    const dir = join(import.meta.dirname, "../../../supabase/migrations");
    let latest: string | null = null;
    for (const file of readdirSync(dir).sort()) {
      if (!file.endsWith(".sql")) continue;
      const text = readFileSync(join(dir, file), "utf8");
      const found = [
        ...text.matchAll(
          /models_model_type_check\s+check\s*\(\s*model_type\s+in\s*\(([^)]*)\)/gi,
        ),
      ];
      const last = found.at(-1);
      if (last?.[1] !== undefined) latest = last[1];
    }
    expect(latest).not.toBeNull();
    const allowed = [...(latest ?? "").matchAll(/'([A-Z_]+)'/g)].map(
      (m) => m[1],
    );
    expect(allowed).toContain("IMAGE_GENERATION");
    for (const type of allowed) {
      expect(ModelTypeSchema.safeParse(type).success, type).toBe(true);
    }
  });
});
