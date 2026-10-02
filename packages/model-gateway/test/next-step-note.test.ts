import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { QOfferedTool } from "@capital-q/q-runtime";

import {
  CAPABILITIES_NOTE,
  ENVIRONMENT_NOTES_MAX_CHARS,
  NEXT_STEP_NOTE,
  environmentNotesFor,
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
  });
});
