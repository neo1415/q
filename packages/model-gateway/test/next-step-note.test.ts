import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { QOfferedTool } from "@capital-q/q-runtime";

import {
  CAPABILITIES_NOTE,
  ENVIRONMENT_NOTES_MAX_CHARS,
  NEXT_STEP_NOTE,
  REMEMBER_FIRST_NOTE,
  VIEWING_NOT_DISCLOSED_NOTE,
  environmentNotesFor,
  nextStepTurn,
} from "../src/q/index.js";

/**
 * Every Home Q / dock / chat reply ends with what was done, the next step
 * and an offer to do it; an acceptance is done with the matching tool
 * (founder direction 2026-10-01; harden spec §4). Trusted guidance near the
 * head of the notes, so the bound never cuts it.
 */

function tool(name: string): QOfferedTool {
  return {
    toolName: `fixture.${name}`,
    toolVersion: 1,
    classification: "READ_ONLY",
    definition: {
      name,
      description: "Fixture.",
      inputJsonSchema: { type: "object", properties: {} },
    },
    visibleStage: "REVIEWING_COMPANY",
  };
}

// About as many tools as a production Home Q run is offered.
const TOOLS = [
  "research_public_web",
  ...Array.from({ length: 24 }, (_, i) => `prepare_action_${String(i)}`),
].map(tool);

describe("how a reply ends", () => {
  it("is in every ordinary turn's notes, near the head, within the bound", () => {
    const notes = environmentNotesFor(
      [],
      TOOLS,
      [{ kind: "COMPANY", companyId: randomUUID() }],
      {
        personality: "Warm and quick, with a sense of humour.".repeat(4),
        asker: "Ada Obi, founder of Fictional Co (fictional.example).",
      },
    );
    expect(notes).toContain(NEXT_STEP_NOTE);
    // Prompt-cache order (2026-10-02): steady guidance, then this person,
    // then this turn -- where it leads, before the facts and tools notes.
    expect(notes.indexOf(NEXT_STEP_NOTE)).toBeLessThan(
      notes.indexOf("No facts were supplied"),
    );
    expect(notes.length).toBeLessThanOrEqual(ENVIRONMENT_NOTES_MAX_CHARS);
  });

  it("is absent while a requested series of questions is being asked, and on an unread turn", () => {
    for (const kind of ["ASK", "REASK"] as const) {
      expect(
        environmentNotesFor([], [], [], {
          questionSequence: { kind, topic: "my mandate", number: 1, total: 3 },
        }),
      ).not.toContain(NEXT_STEP_NOTE);
    }
    expect(
      environmentNotesFor([], [], [], {
        questionSequence: { kind: "FINISHED", topic: "my mandate", total: 3 },
      }),
    ).toContain(NEXT_STEP_NOTE);
    expect(environmentNotesFor([], [], [], { turnUnread: true })).not.toContain(
      NEXT_STEP_NOTE,
    );
  });

  it("offers one step, only what Capital Q can do, and acts on an acceptance through a tool", () => {
    expect(NEXT_STEP_NOTE).toContain("one offer, never a list");
    expect(NEXT_STEP_NOTE).toContain(
      "Offer only what your tools or Capital Q can do",
    );
    expect(NEXT_STEP_NOTE).toContain(
      "do exactly that now with the matching tool",
    );
    expect(NEXT_STEP_NOTE).toContain("one-tap approval");
  });

  it("leaves room for what Q can do on a production-sized run (it was cut on nearly every run at 4,000)", () => {
    const notes = environmentNotesFor(
      [],
      TOOLS,
      [{ kind: "COMPANY", companyId: randomUUID() }],
      {
        personality: "Warm and quick, with a sense of humour.".repeat(4),
        asker: "Ada Obi, founder of Fictional Co (fictional.example).",
      },
    );
    expect(notes).toContain(CAPABILITIES_NOTE);
    expect(notes).toContain(NEXT_STEP_NOTE);
    // Viewing is not interest: always said, never keyword-triggered.
    expect(notes).toContain(VIEWING_NOT_DISCLOSED_NOTE);
    // QA QO-35: a "remember" turn confirms the memory first, no tool, and
    // never rewrites the declared mandate on its own.
    expect(notes).toContain(REMEMBER_FIRST_NOTE);
    expect(REMEMBER_FIRST_NOTE).toMatch(
      /say first, in one short sentence, that you will remember it/u,
    );
    expect(REMEMBER_FIRST_NOTE).toMatch(
      /declared mandate is separate: change it only when they ask/u,
    );
  });
});

/**
 * C1 (owner, 13 Nov): "Not every question needs a Capital Q feature
 * recommendation." A remark, a lookup of their own records, a plain fact or
 * a progress check is answered and left there: no closing offer and no
 * "be proactive" guidance. Doing or advising keeps both.
 */
describe("which turns end with an offer", () => {
  it("not a remark, a control word, a record lookup or a plain fact", () => {
    expect(nextStepTurn({ turnKind: "SMALL_TALK" })).toBe(false);
    expect(nextStepTurn({ turnKind: "OFF_TOPIC" })).toBe(false);
    expect(nextStepTurn({ turnKind: "CONTROL" })).toBe(false);
    expect(
      nextStepTurn({
        turnKind: "QUESTION_TO_Q",
        questionKind: "THEIR_OWN_RECORDS",
      }),
    ).toBe(false);
    expect(
      nextStepTurn({ turnKind: "QUESTION_TO_Q", questionKind: "PUBLIC_FACTS" }),
    ).toBe(false);
    expect(nextStepTurn({ questionKind: "PROGRESS" })).toBe(false);
  });

  it("advice, options, fit, discovery, an action, an acceptance, or an unread turn", () => {
    expect(
      nextStepTurn({ turnKind: "QUESTION_TO_Q", questionKind: "ADVICE" }),
    ).toBe(true);
    expect(nextStepTurn({ questionKind: "FIT" })).toBe(true);
    expect(nextStepTurn({ questionKind: "DISCOVER_COMPANIES" })).toBe(true);
    expect(nextStepTurn({ turnKind: "TOOL_REQUEST" })).toBe(true);
    // Acting on their own records is doing, not a lookup.
    expect(
      nextStepTurn({
        turnKind: "TOOL_REQUEST",
        questionKind: "THEIR_OWN_RECORDS",
      }),
    ).toBe(true);
    expect(nextStepTurn({ turnKind: "ANSWER" })).toBe(true);
    expect(nextStepTurn({})).toBe(true);
  });

  it("a lookup turn's notes carry neither the offer nor the proactive guidance", () => {
    const notes = environmentNotesFor([], TOOLS, [], { noNextStep: true });
    expect(notes).not.toContain(NEXT_STEP_NOTE);
    expect(notes).not.toContain(CAPABILITIES_NOTE);
    const doing = environmentNotesFor([], TOOLS, [], {});
    expect(doing).toContain(NEXT_STEP_NOTE);
  });
});
