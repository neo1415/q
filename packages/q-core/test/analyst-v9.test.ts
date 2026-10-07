import { describe, expect, it } from "vitest";

import {
  COMPANY_ANALYST_V8,
  COMPANY_ANALYST_V9,
  COMPANY_ANALYST_V10,
  COMPANY_ANALYST_V11,
  COMPANY_ANALYST_V15,
  COMPANY_ANALYST_V16,
  COMPANY_ANALYST_V16_TURN,
  createPromptRegistry,
  PROMPT_DEFINITIONS,
} from "../src/index.js";

/**
 * Fit is not interest (acceptance directive E). The active analyst may
 * name likely candidates by fit; it may still produce no fit SCORE, and
 * interest stays something only a source can show.
 */
describe("COMPANY_ANALYST v9", () => {
  it("no longer bans saying who fits, only a fit score, and keeps interest to sources", () => {
    const template = COMPANY_ANALYST_V9.template;
    expect(COMPANY_ANALYST_V8.template).toContain(
      "investor fit or peer benchmark",
    );
    expect(template).not.toContain("investor fit or peer benchmark");
    expect(template).toContain("fit score or peer benchmark");
    expect(template).toContain("LIKELY INVESTORS");
    // Nothing else of v8 was lost.
    expect(template).toContain("ACTING, CORRECTIONS, MANDATES");
  });
});

/**
 * v10 states the same rule as a concept. v9 keyed it to one question's
 * wording, which is a phrase list written in prose; the concept has to hold
 * for any wording and for any kind of counterpart, not only investors.
 */
describe("COMPANY_ANALYST v10", () => {
  it("is retired by v11, as v9 was by it, and both stay resolvable", () => {
    const registry = createPromptRegistry(PROMPT_DEFINITIONS);
    expect(COMPANY_ANALYST_V10.status).toBe("DEPRECATED");
    expect(registry.get("COMPANY_ANALYST", 10)?.definition.version).toBe(10);
    expect(COMPANY_ANALYST_V9.status).toBe("DEPRECATED");
    expect(registry.get("COMPANY_ANALYST", 9)?.definition.version).toBe(9);
  });

  it("separates already-involved (evidence) from would-suit (labelled inference) without keying on a question's wording", () => {
    const template = COMPANY_ANALYST_V10.template;
    expect(template).toContain("INVOLVED VERSUS SUITED");
    expect(template).toContain("Already involved is evidence");
    expect(template).toContain("labelled a likely fit to be checked");
    expect(template).not.toContain("LIKELY INVESTORS");
    expect(template).not.toContain("which investors would likely invest");
    expect(template).toContain("fit score or peer benchmark");
    expect(template).toContain("ACTING, CORRECTIONS, MANDATES");
  });
});

/**
 * v11 tells the model the answer may be simple Markdown structure (founder
 * direction D): the Home thread renders it, voice strips it. Presentation
 * only -- every rule of v10 is still there, and structure never upgrades a
 * claim.
 */
describe("COMPANY_ANALYST v11", () => {
  it("was the active analyst version until v12 took over", () => {
    const registry = createPromptRegistry(PROMPT_DEFINITIONS);
    expect(registry.getActive("COMPANY_ANALYST").definition.version).toBe(20);
    expect(COMPANY_ANALYST_V11.status).toBe("DEPRECATED");
  });

  it("allows lists, tables and callouts for structure, keeps unknowns empty and forbids HTML", () => {
    const template = COMPANY_ANALYST_V11.template;
    expect(template).toContain("ANSWER FORMAT");
    expect(template).toContain("a table (header row, then |---|)");
    expect(template).toContain("a cell left empty when not known");
    expect(template).toContain("> [!RISK]");
    expect(template).toContain("No HTML");
    expect(template).toContain("an inference stays worded as one");
    // Nothing of v10 was lost.
    expect(template).toContain("INVOLVED VERSUS SUITED");
    expect(template).toContain("ACTING, CORRECTIONS, MANDATES");
    expect(template.replace(/ANSWER FORMAT[\s\S]*?\n\n/, "")).toBe(
      COMPANY_ANALYST_V10.template,
    );
  });
});

describe("COMPANY_ANALYST v12 (founder design 2026-09-28)", () => {
  it("keeps every v11 rule and adds comparison cards under the evidence rules", async () => {
    const { COMPANY_ANALYST_V12, CompanyAnalystV12ResultSchema } =
      await import("../src/index.js");
    expect(COMPANY_ANALYST_V12.status).toBe("DEPRECATED");
    const template = COMPANY_ANALYST_V12.template;
    expect(template).toContain("ANSWER FORMAT");
    expect(template).toContain("also fill comparisonCards");
    expect(template).toContain('unknown is "Not known"');
    expect(template).toContain("no order or verdict");
    const read = CompanyAnalystV12ResultSchema.safeParse({
      answer: "Ledgerfold leads on traction.",
      responseShape: "ANALYTICAL",
      insufficientEvidence: false,
      recommendation: null,
      comparisonCards: {
        items: [
          { name: "Ledgerfold", points: ["USD 40k monthly revenue"] },
          { name: "Kivu Freight", points: ["Not known"] },
        ],
      },
    });
    expect(read.success ? [] : read.error.issues).toEqual([]);
    // One item is not a comparison.
    expect(
      CompanyAnalystV12ResultSchema.safeParse({
        answer: "x",
        responseShape: "CONCISE",
        insufficientEvidence: false,
        recommendation: null,
        comparisonCards: { items: [{ name: "A", points: ["b"] }] },
      }).success,
    ).toBe(false);
  });
});

describe("COMPANY_ANALYST v13 (founder live 2026-09-29)", () => {
  it("defines stated facts, knows it makes and revises documents, and resolves misheard names", async () => {
    const { COMPANY_ANALYST_V12, COMPANY_ANALYST_V13 } =
      await import("../src/index.js");
    // Superseded by v14 (PRESENCE gestures), which keeps all of this.
    expect(COMPANY_ANALYST_V13.status).toBe("DEPRECATED");
    const template = COMPANY_ANALYST_V13.template;
    expect(template).toContain(
      "userStatements: only a fact they state in THIS message",
    );
    expect(template).toContain("never a request, question or unclear words");
    expect(template).toContain(
      "Capital Q makes and revises decks and PDFs: never say it cannot.",
    );
    expect(template).toContain("the whole change in instruction, specific");
    expect(template).toContain("Speech mishears names");
    // The compact sections keep their rules.
    expect(template).toContain("comparisonCards (no order or verdict");
    expect(template).toContain("Structure never upgrades a claim.");
    expect(template).toContain("labelled a likely fit to check");
    // Everything else is v12's, unchanged.
    for (const section of [
      "WHAT CAPITAL Q REMEMBERS ABOUT THIS PERSON",
      "ACTING, CORRECTIONS, MANDATES",
      "Produce no score, rating, ranking",
    ]) {
      expect(template).toContain(section);
      expect(COMPANY_ANALYST_V12.template).toContain(section);
    }
  });
});

/**
 * v16 (prompt-cache order, 2026-10-02): the same words as v15, with every
 * per-turn value moved into one THIS TURN block at the end, so everything
 * before it is identical across turns and the provider can cache it.
 */
describe("COMPANY_ANALYST v16", () => {
  it("is active, keeps v15's instructions, and puts every variable at the end", () => {
    const registry = createPromptRegistry(PROMPT_DEFINITIONS);
    expect(registry.getActive("COMPANY_ANALYST").definition.version).toBe(20);
    expect(COMPANY_ANALYST_V15.status).toBe("DEPRECATED");
    const template = COMPANY_ANALYST_V16.template;
    const turn = template.indexOf(COMPANY_ANALYST_V16_TURN);
    expect(turn).toBeGreaterThan(0);
    expect(template.slice(0, turn)).not.toMatch(/\{\{\w+\}\}/);
    for (const name of [
      "capability",
      "subjectDescription",
      "turnNotes",
      "institutionalNotes",
      "memory",
      "authorisedFacts",
    ]) {
      expect(template.slice(turn)).toContain(`{{${name}}}`);
    }
  });
});
