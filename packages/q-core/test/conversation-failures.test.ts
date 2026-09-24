import { describe, expect, it } from "vitest";

import {
  clearFailure,
  composeRepair,
  EMPTY_FAILURES,
  isExhausted,
  nextRepair,
  noteFailure,
  recordRepair,
  shouldNotify,
  subsystemNotice,
  type RepairStrategy,
} from "../src/index.js";

/**
 * Loop protection and the repair ladder (CQ-QX-005 §6, §7, §8).
 *
 * One degraded subsystem must not make Q unusable, and no repair line may
 * come back twice. Both are properties of values, so both are asserted on
 * values.
 */

describe("the failure ledger", () => {
  it("counts per operation, and one operation's count never touches another", () => {
    let ledger = noteFailure(EMPTY_FAILURES, "RESEARCH");
    ledger = noteFailure(ledger, "RESEARCH");
    expect(isExhausted(ledger, "RESEARCH")).toBe(true);
    expect(isExhausted(ledger, "MODEL")).toBe(false);
    expect(isExhausted(ledger, "PARSE")).toBe(false);
    ledger = clearFailure(ledger, "RESEARCH");
    expect(isExhausted(ledger, "RESEARCH")).toBe(false);
  });

  it("is worth a sentence on the first failure and on the one that stops the retries, not in between or after", () => {
    let ledger = EMPTY_FAILURES;
    const said: boolean[] = [];
    for (let i = 0; i < 5; i += 1) {
      ledger = noteFailure(ledger, "MODEL");
      said.push(shouldNotify(ledger, "MODEL"));
    }
    expect(said).toEqual([true, true, false, false, false]);
  });

  it("never describes a reasoning failure as a hearing problem, or the reverse", () => {
    expect(subsystemNotice("PARSE", false)).toMatch(/heard the words/i);
    expect(subsystemNotice("PARSE", false)).not.toMatch(/say it again/i);
    expect(subsystemNotice("TRANSCRIPT", false)).toMatch(/say it once more/i);
    expect(subsystemNotice("MODEL", false)).toMatch(/reasoning service/i);
    expect(subsystemNotice("RESEARCH", true)).toMatch(/live research/i);
    expect(subsystemNotice("RESEARCH", true)).toMatch(
      /what you've told me and what I already know/i,
    );
  });
});

describe("the repair ladder", () => {
  const slots = {
    label: "founding-team capabilities",
    question: "Which capabilities in a founding team matter to you?",
    options: ["Technical", "Repeat founders", "Domain expertise"],
    optional: true,
  };

  it("changes strategy every time, and never repeats the one it just used", () => {
    let history = null;
    const used: RepairStrategy[] = [];
    for (let i = 0; i < 6; i += 1) {
      const strategy = nextRepair(history, "I5", { hasInterpretation: false });
      if (used.length > 0) {
        expect(strategy).not.toBe(used[used.length - 1]);
      }
      used.push(strategy);
      history = recordRepair(history, "I5", strategy);
    }
    // Up the ladder, then alternating at the floor rather than standing
    // on the same rung: the fallback is offered, and the gap is named
    // again between offers, so no two turns say the same thing.
    expect(used.slice(0, 3)).toEqual([
      "REPHRASE",
      "NAME_THE_GAP",
      "OFFER_FALLBACK",
    ]);
    expect(used).toContain("OFFER_FALLBACK");
    const lines = used.map((s) => composeRepair(s, slots));
    for (let i = 1; i < lines.length; i += 1) {
      expect(lines[i]).not.toBe(lines[i - 1]);
    }
  });

  it("offers a concrete interpretation first when it has one", () => {
    const strategy = nextRepair(null, "I5", { hasInterpretation: true });
    expect(strategy).toBe("OFFER_INTERPRETATION");
    expect(
      composeRepair(strategy, {
        ...slots,
        interpretation:
          "you want an example of a real aviation-focused investor similar to the profile we're building",
      }),
    ).toMatch(
      /^Do you mean you want an example of a real aviation-focused investor/,
    );
  });

  it("starts over on a new topic", () => {
    const history = recordRepair(null, "I5", "OFFER_FALLBACK");
    expect(nextRepair(history, "I6", { hasInterpretation: false })).toBe(
      "REPHRASE",
    );
  });

  it("names what it holds and what it can take when it names the gap", () => {
    const line = composeRepair("NAME_THE_GAP", {
      ...slots,
      held: ["Pound sterling"],
    });
    expect(line).toContain("still missing founding-team capabilities");
    expect(line).toContain("Pound sterling");
    expect(line).toContain("Technical, Repeat founders or Domain expertise");
  });

  it("does not offer to set aside a required question", () => {
    expect(
      composeRepair("OFFER_FALLBACK", { ...slots, optional: false }),
    ).toMatch(/do need it to finish/);
  });
});
