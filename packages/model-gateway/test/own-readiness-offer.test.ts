import { describe, expect, it } from "vitest";

import { ownReadinessFact } from "../src/q/own-readiness.js";
import { carriesScreenMove } from "../src/q/unasked-moves.js";

const READ = {
  status: "FOUND",
  data: {
    state: "not_ready",
    verificationAvailable: true,
    requirements: [
      {
        requirement: "FOUNDER_IDENTITY_VERIFIED",
        outcome: "OUTSTANDING",
        description: "A founder's identity has not been verified yet.",
      },
    ],
  },
};

/**
 * Live 2026-10-30 (run 2): the answer to "What should I do today?" offered
 * both a move ("Want me to take you to it?") and code's plan, and the yes
 * started the plan. One offer per answer: when code closes with its own,
 * the model is told to make none.
 */
describe("one offer per answer", () => {
  it("tells the model to offer nothing when code closes the answer with its offer", () => {
    const closing = ownReadinessFact(READ, {
      lead: true,
      alreadySaid: true,
      closingOffer: true,
    });
    expect(closing?.statement).toContain("Offer nothing and ask no question");
    expect(closing?.statement).not.toContain("offer, as a question");
    const open = ownReadinessFact(READ, { lead: true, alreadySaid: true });
    expect(open?.statement).toContain("offer, as a question, to do it now");
  });

  it("knows a screen move by its client action, and nothing else", () => {
    expect(
      carriesScreenMove({
        clientAction: { kind: "OPEN_SETTINGS", section: "account" },
      }),
    ).toBe(true);
    expect(
      carriesScreenMove({
        clientAction: { kind: "NAVIGATE", destination: "WORK_NEEDS" },
      }),
    ).toBe(true);
    expect(
      carriesScreenMove({ clientAction: { kind: "SET_THEME", theme: "dark" } }),
    ).toBe(false);
    expect(carriesScreenMove({ status: "FOUND" })).toBe(false);
    expect(carriesScreenMove(null)).toBe(false);
  });
});
