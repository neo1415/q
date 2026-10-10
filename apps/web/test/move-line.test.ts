import { describe, expect, it } from "vitest";

import type { QResultBlock } from "@capital-q/contracts";

import { moveLineOf, routeOfBlocks } from "@/features/q/move-line";
import type { NavigationState } from "@/features/q/control/navigation-lifecycle";

const COMPANY = "bf55d6e1-567a-470b-954d-054ae05990e2";

function state(phase: NavigationState["phase"], extra = {}): NavigationState {
  return { intentId: "nav-x-1", expected: "/capital", phase, ...extra };
}

describe("R3: the typed row says opened only on the browser's VERIFIED", () => {
  it("stays pending while the move is on its way in this tab", () => {
    expect(moveLineOf("Opening Capital…", state("EXECUTING"))).toBe(
      "Opening Capital…",
    );
  });

  it("no receipt in this tab (a reload): opened if the tab is there, else neutral past", () => {
    expect(moveLineOf("Opening Capital…", null, true)).toBe("Opened Capital.");
    expect(moveLineOf("Opening Capital…", null, false)).toBe(
      "Asked to open Capital.",
    );
    expect(moveLineOf("Heading home…", null)).toBe("Asked to go home.");
    expect(
      moveLineOf("Opening Tensorgate… Want me to run through them?", null),
    ).toBe("Asked to open Tensorgate. Want me to run through them?");
    // Never left pending without a lifecycle to resolve it.
    expect(moveLineOf("Opening Capital…", null)).not.toContain("…");
  });

  it("confirms on VERIFIED, keeping what followed", () => {
    expect(moveLineOf("Opening Capital…", state("VERIFIED"))).toBe(
      "Opened Capital.",
    );
    expect(
      moveLineOf(
        "Opening Tensorgate… Want me to run through them?",
        state("VERIFIED"),
      ),
    ).toBe("Opened Tensorgate. Want me to run through them?");
    expect(moveLineOf("Heading home…", state("VERIFIED"))).toBe("You're home.");
  });

  it("says plainly it didn't open on FAILED, with the lifecycle's reason", () => {
    const line = moveLineOf(
      "Opening Capital…",
      state("FAILED", { reason: "UNAUTHORIZED" }),
    );
    expect(line).toMatch(/^Capital didn't open\. /u);
    expect(line).toContain("isn't available to your account");
    expect(line).not.toMatch(/\bOpened\b/u);
  });

  it("leaves any other answer alone", () => {
    expect(moveLineOf("Clearwater leads on fit.", state("VERIFIED"))).toBe(
      "Clearwater leads on fit.",
    );
  });

  it("finds the route a turn moves to (page and record)", () => {
    const navigate: QResultBlock = {
      kind: "UI_INTENT",
      intent: { kind: "NAVIGATE", destination: "CAPITAL" },
    };
    expect(routeOfBlocks([navigate])).toBe("/capital");
    const record = {
      kind: "UI_INTENT",
      intent: { kind: "OPEN_RECORD_PAGE", page: "COMPANY", id: COMPANY },
    } as const satisfies QResultBlock;
    expect(routeOfBlocks([record])).toBe(`/company/${COMPANY}`);
    expect(routeOfBlocks([])).toBeNull();
  });
});
