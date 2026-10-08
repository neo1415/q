import { describe, expect, it } from "vitest";

import {
  createDefaultPromptRegistry,
  WOO_FEEDBACK,
  WOO_GUIDANCE,
  WOO_PROBLEMS,
  WOO_WORDS_MAX,
  wooProblem,
} from "../src/index.js";
import { WOO_FIXTURES, WOO_NEGATIVES } from "./fixtures/woo-messages.js";

/**
 * Founder 2026-10-07: messages that woo. Code's own check of Q's drafts,
 * over real seeded messages (before) and the rewrites the new prompts aim
 * for (after).
 */
describe("the woo check", () => {
  it.each(WOO_FIXTURES.map((fixture) => [fixture.name, fixture] as const))(
    "%s: the real message is caught, the rewrite passes",
    (_name, fixture) => {
      expect(
        wooProblem({
          body: fixture.before,
          replying: fixture.replying,
          recipientTerms: fixture.recipientTerms,
        }),
      ).toBe(fixture.problem);
      expect(
        wooProblem({
          body: fixture.after,
          replying: fixture.replying,
          recipientTerms: fixture.recipientTerms,
        }),
      ).toBeNull();
      const words = fixture.after.split(/\s+/u).length;
      expect(words).toBeGreaterThanOrEqual(55);
      expect(words).toBeLessThanOrEqual(120);
    },
  );

  it.each(WOO_NEGATIVES.map((entry) => [entry.body, entry.problem] as const))(
    "catches %s",
    (body, problem) => {
      expect(wooProblem({ body, replying: false, recipientTerms: [] })).toBe(
        problem,
      );
    },
  );

  it("a note past the ceiling is too long", () => {
    const body = `Thank you for connecting. ${"We are glad to be here. ".repeat(40)}`;
    expect(body.split(/\s+/u).length).toBeGreaterThan(WOO_WORDS_MAX);
    expect(wooProblem({ body, replying: false, recipientTerms: [] })).toBe(
      "WOO_TOO_LONG",
    );
  });

  it("does not guess specificity when nothing about them is known", () => {
    expect(
      wooProblem({
        body: "Thank you for connecting; we would be glad to share more if useful.",
        replying: true,
        recipientTerms: [],
      }),
    ).toBeNull();
  });

  it("has words for every problem, for the one rewrite", () => {
    for (const problem of WOO_PROBLEMS) {
      expect(WOO_FEEDBACK[problem].length).toBeGreaterThan(20);
    }
  });
});

describe("the prompts carry it", () => {
  const registry = createDefaultPromptRegistry();
  it("INSTRUCTION_PLAN v8 is active, with the guidance and the new length", () => {
    const active = registry.getActive("INSTRUCTION_PLAN").definition;
    expect(active.version).toBe(8);
    expect(active.template).toContain(WOO_GUIDANCE);
    expect(active.template).toContain("60-120 words, in their tone");
    expect(active.template).not.toContain("At most 60 words");
    expect(active.template).toContain("their delegation is on");
    expect(active.template).toContain("BEFORE YOU WRITE");
  });

  it("the redraft, the investor's chat and the founder's stand-in are new versions", () => {
    const redraft = registry.getActive("DRAFT_REDRAFT").definition;
    expect(redraft.version).toBe(2);
    expect(redraft.template).toContain(WOO_GUIDANCE);
    const converse = registry.getActive("WORK_CONVERSE").definition;
    expect(converse.version).toBe(2);
    expect(converse.template).not.toContain("Warm, direct, short.");
    expect(converse.template).toContain("Relationship first");
    const standIn = registry.getActive("WORK_STAND_IN_REPLY").definition;
    expect(standIn.version).toBe(2);
    expect(standIn.template).toContain("company's voice");
    expect(standIn.template).toContain("Relationship first");
  });
});
