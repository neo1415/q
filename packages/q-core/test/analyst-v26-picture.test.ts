import { describe, expect, it } from "vitest";

import {
  COMPANY_ANALYST_V25,
  COMPANY_ANALYST_V26,
  CompanyAnalystV26ResultSchema,
  createDefaultPromptRegistry,
  V22_VISUAL_LINE,
  V26_ALLOWED_ROOT_KEYS,
  V26_TRIMS,
  V26_VISUAL_LINE,
} from "../src/index.js";

/**
 * L-13 (owner ask 2026-10-20): COMPANY_ANALYST v26 lets the model ask for a
 * picture with a few search words. The words are a proposal: what leaves
 * Capital Q is composed from the person's own words downstream.
 */

const answer = {
  answer: "A baobab is a broad, short tree with a thick trunk.",
  responseShape: "CONCISE",
  insufficientEvidence: false,
  recommendation: null,
};

describe("COMPANY_ANALYST v26", () => {
  it("is active, keeps v25 for its runs, and changes two lines plus listed trims", () => {
    const registry = createDefaultPromptRegistry();
    expect(registry.getActive("COMPANY_ANALYST").definition.version).toBe(27);
    expect(registry.get("COMPANY_ANALYST", 25)?.definition.status).toBe(
      "DEPRECATED",
    );
    const template = COMPANY_ANALYST_V26.template;
    expect(template).toContain(V26_VISUAL_LINE);
    expect(template).not.toContain(`${V22_VISUAL_LINE}\n`);
    expect(template).toContain(V26_ALLOWED_ROOT_KEYS.join(", "));
    // Every other difference is a listed trim, each applied exactly once.
    const untrimmed = V26_TRIMS.reduce((text, [from, to]) => {
      expect(text.split(to)).toHaveLength(2);
      return text.replace(to, from);
    }, template);
    expect(
      untrimmed
        .replace(V26_VISUAL_LINE, V22_VISUAL_LINE)
        .replace(", pictureQuery", ""),
    ).toBe(COMPANY_ANALYST_V25.template);
    expect(template.length).toBeLessThan(COMPANY_ANALYST_V25.template.length);
    expect(COMPANY_ANALYST_V26.output.kind === "STRUCTURED").toBe(true);
  });

  it("takes PICTURE with a short query, and both stay optional", () => {
    const parsed = CompanyAnalystV26ResultSchema.parse({
      ...answer,
      visual: "PICTURE",
      pictureQuery: "baobab tree",
    });
    expect(parsed.visual).toBe("PICTURE");
    expect(parsed.pictureQuery).toBe("baobab tree");

    const plain = CompanyAnalystV26ResultSchema.parse(answer);
    expect(plain.visual).toBeNull();
    expect(plain.pictureQuery).toBeNull();
    // The v22 kinds are still accepted.
    expect(
      CompanyAnalystV26ResultSchema.parse({ ...answer, visual: "MAP" }).visual,
    ).toBe("MAP");
    expect(
      CompanyAnalystV26ResultSchema.safeParse({ ...answer, visual: "VIDEO" })
        .success,
    ).toBe(false);
    expect(
      CompanyAnalystV26ResultSchema.safeParse({
        ...answer,
        pictureQuery: "x".repeat(121),
      }).success,
    ).toBe(false);
  });
});
