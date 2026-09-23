import { describe, expect, it } from "vitest";

import {
  createDefaultPromptRegistry,
  INTERVIEW_CONDUCTOR_V6,
} from "@capital-q/q-core";

/**
 * The active conductor is v7, and v6 is retired unchanged (Workstream A).
 *
 * A published prompt version is immutable: a run recorded against
 * `interview-conductor/v6` has to stay explainable by exactly the text it
 * ran under. v7 is built by rewriting v6's template, which is the
 * repository's convention and also the thing most likely to go wrong
 * quietly — a missed anchor leaves the old instruction in place and the
 * new behaviour simply never happens, with nothing failing.
 *
 * So this asserts the four replacements actually landed, and that what
 * they replaced is gone.
 */

describe("INTERVIEW_CONDUCTOR v7 is what the interview runs", () => {
  const registry = createDefaultPromptRegistry();
  const active = registry.getActive("INTERVIEW_CONDUCTOR");

  it("is the single active version", () => {
    expect(active.definition.version).toBe(7);
    expect(INTERVIEW_CONDUCTOR_V6.status).toBe("DEPRECATED");
  });

  it("asks for every open step to be read, not just the current one", () => {
    const template = active.definition.template;
    expect(template).toContain("read what they said against EVERY step");
    expect(template).toContain("Answer a step whether or not the journey");
    // v1's one-line version, which was the whole turn model, is gone.
    expect(template).not.toContain(
      "One sentence may answer several steps: take all of them.",
    );
  });

  it("carries the platform's held readings, and says they are not saved", () => {
    const template = active.definition.template;
    expect(template).toContain("CARRIED (trusted");
    expect(template).toContain("{{carried}}");
    expect(template).toContain("never say they are saved");
  });

  it("names no restriction and unsettled scale as readings of their own", () => {
    const template = active.definition.template;
    expect(template).toContain("No restriction is an answer");
    expect(template).toContain("SCALE_UNCLEAR");
    expect(template).toContain("never resolve a scale yourself");
  });

  it("stops asking for confirmation, and stops speaking like a database", () => {
    const template = active.definition.template;
    expect(template).toContain("Do not ask them to confirm things");
    expect(template).toContain("NEVER write a bare stored figure");
    expect(template).toContain("Plain words only");
    expect(template).toContain("mandate context");
    // v1's confirm-nearly-everything rule is gone.
    expect(template).not.toContain(
      "are always read back in reply and the person asked if that is right",
    );
  });
});
