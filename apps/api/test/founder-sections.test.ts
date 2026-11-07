import { describe, expect, it } from "vitest";

import {
  FOUNDER_SECTION_STEPS,
  founderSectionsFor,
} from "../src/founder-sections.js";

/**
 * Owner 2026-11-07: the founder's F9 answers fill the Overview's sections
 * the deck and pitch leave empty. Only F9 section steps, only text, and
 * never "I don't know" or "None": unknown stays unknown.
 */
const AT = new Date("2026-11-07T10:00:00.000Z");

describe("the founder's F9 answers, as the Overview receives them", () => {
  it("files each F9 step under its profile section", () => {
    expect(FOUNDER_SECTION_STEPS.get("F9.problem")).toBe("problem");
    expect(FOUNDER_SECTION_STEPS.get("F9.why_us_why_now")).toBeDefined();
    // Our Team and Our Ask are other steps' (F4, F6): never read here.
    expect(
      [...FOUNDER_SECTION_STEPS.keys()].every((key) => key.startsWith("F9.")),
    ).toBe(true);
  });

  it("sends their words as their claim, from a jsonb object or its text", () => {
    const out = founderSectionsFor([
      {
        stepKey: "F9.problem",
        value: {
          type: "TEXT",
          text: "  Clinics lose a fifth of what they are owed.  ",
        },
        answeredAt: AT,
      },
      {
        stepKey: "F9.solution",
        value: JSON.stringify({ type: "TEXT", text: "We advance the claim." }),
        answeredAt: "2026-11-07T11:00:00.000Z",
      },
    ]);
    expect(out).toEqual([
      {
        sectionKey: "problem",
        text: "Clinics lose a fifth of what they are owed.",
        answeredAt: "2026-11-07T10:00:00.000Z",
        truthClass: "USER_CLAIM",
        evidenceStatus: "SELF_REPORTED",
        source: "FOUNDER_ANSWER",
      },
      {
        sectionKey: FOUNDER_SECTION_STEPS.get("F9.solution"),
        text: "We advance the claim.",
        answeredAt: "2026-11-07T11:00:00.000Z",
        truthClass: "USER_CLAIM",
        evidenceStatus: "SELF_REPORTED",
        source: "FOUNDER_ANSWER",
      },
    ]);
  });

  it("drops 'I don't know', 'None', other steps and anything that is not text", () => {
    expect(
      founderSectionsFor([
        {
          stepKey: "F9.problem",
          value: { type: "TEXT", text: "I don't know" },
          answeredAt: AT,
        },
        {
          stepKey: "F9.moats",
          value: { type: "TEXT", text: "none." },
          answeredAt: AT,
        },
        {
          stepKey: "F1.website",
          value: { type: "TEXT", text: "https://example.com" },
          answeredAt: AT,
        },
        {
          stepKey: "F9.vision",
          value: { type: "SINGLE_SELECT", optionKey: "x" },
          answeredAt: AT,
        },
        { stepKey: "F9.roadmap", value: "not json", answeredAt: AT },
      ]),
    ).toEqual([]);
  });
});
