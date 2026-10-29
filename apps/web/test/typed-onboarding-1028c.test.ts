import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { isNoPicture } from "../src/features/entity/entity-avatar";
import { readinessItems } from "../src/features/home/briefing";
import {
  canOfferFinish,
  chipsBelongTo,
  questionOnReturn,
} from "../src/features/onboarding-conversation/conversation";

/**
 * Typed onboarding, production re-test #3 (2026-10-28, deployed
 * f87847eac): the screen's side of defects 5-8.
 */

const field = (state: string, required = true, savePending = false) => ({
  applicable: true,
  required,
  state,
  savePending,
});

describe("defect 5: the Finish control", () => {
  it("is offered once every essential fact is in, though the reviews (not coverage fields) are still open", () => {
    // canComplete is false until the reviews are confirmed: live, neither
    // side ever saw Finish.
    expect(
      canOfferFinish({
        summary: { canComplete: false, contradictory: 0 },
        fields: [
          field("CONFIRMED_SAVED"),
          field("KNOWN"),
          field("MISSING", false),
        ],
      }),
    ).toBe(true);
  });

  it("is not offered while an essential is missing or two answers disagree", () => {
    expect(
      canOfferFinish({
        summary: { canComplete: false, contradictory: 0 },
        fields: [field("CONFIRMED_SAVED"), field("MISSING")],
      }),
    ).toBe(false);
    expect(
      canOfferFinish({
        summary: { canComplete: false, contradictory: 1 },
        fields: [field("CONFIRMED_SAVED")],
      }),
    ).toBe(false);
  });

  it('pressing it says their "that\'s all" to Q (read back, then their yes), never confirms the review directly', () => {
    const source = readFileSync(
      resolve(
        import.meta.dirname,
        "../src/features/onboarding-conversation/q-onboarding-workspace.tsx",
      ),
      "utf8",
    );
    const offer = source.slice(
      source.indexOf("data-q-finish-offer"),
      source.indexOf("data-q-finish\n"),
    );
    expect(offer).toContain("void say(words)");
    expect(offer).toContain("voiceSendText(words)");
    expect(offer).not.toContain("onClick={onFinish}");
    expect(source).toContain(
      't("That\'s everything for now. Please finish my setup.")',
    );
  });
});

describe("defect 6: chips belong to the question Q is asking", () => {
  it("the investor-type chips go once Q asks about something else", () => {
    expect(chipsBelongTo("I0.investor_type", null)).toBe(true);
    expect(chipsBelongTo("I0.investor_type", ["I0.investor_type"])).toBe(true);
    expect(chipsBelongTo("I0.investor_type", ["I2.currency"])).toBe(false);
    expect(chipsBelongTo("I0.investor_type", [])).toBe(false);
  });
});

describe('defect 7: coming back after "I\'ll continue this later"', () => {
  const pause = {
    role: "Q" as const,
    text: "Of course. 16 things you've told me are saved, and still open: full-time and team size. Pick this up whenever you like; I'll carry on from here, and your home page is ready.",
    createdAt: "2026-10-28T22:27:40.000Z",
  };
  const now = Date.parse("2026-10-28T22:28:10.000Z");

  it("from Home, the pause line is history and Q asks the open question again", () => {
    expect(
      questionOnReturn([pause], "2026-10-28T22:27:39.000Z", now, true),
    ).toBeNull();
  });

  it("a reload on the spot keeps it (the pause is honoured), and a real question stays the question", () => {
    expect(questionOnReturn([pause], "2026-10-28T22:27:39.000Z", now)).toBe(
      pause.text,
    );
    expect(
      questionOnReturn(
        [{ ...pause, text: "Are the founders all full-time on it?" }],
        "2026-10-28T22:27:39.000Z",
        now,
        true,
      ),
    ).toBe("Are the founders all full-time on it?");
  });

  it("Home offers the way back into an open setup even when readiness has not answered yet", () => {
    expect(readinessItems(undefined, true)).toEqual([
      expect.objectContaining({
        href: "/onboarding/founder?from=home",
        cta: "Finish setup with Q",
      }),
    ]);
    expect(readinessItems(undefined, false)).toEqual([]);
  });
});

describe("defect 8: a picture route's 'no' is a placeholder, never a 404", () => {
  it("the avatar reads the 1x1 placeholder as no picture", () => {
    expect(isNoPicture(1, 1)).toBe(true);
    expect(isNoPicture(0, 0)).toBe(false);
    expect(isNoPicture(64, 64)).toBe(false);
  });
});
