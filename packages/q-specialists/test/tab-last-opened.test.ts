import { describe, expect, it } from "vitest";

import { lastOpenedScreen, screenTabTarget } from "../src/tab-request.js";

const TENSORGATE = "bf55d6e1-567a-470b-954d-054ae05990e2";
const INVESTOR = "b0075742-0000-4000-8000-0000000000c1";

const opened = (page: string, id: string) => ({
  role: "Q",
  blocks: [
    {
      kind: "UI_INTENT",
      intent: { kind: "OPEN_RECORD_PAGE", page, id, tab: "deck" },
    },
  ],
});

describe("a tab ask with no screen uses what Q last opened (live 2026-10-10)", () => {
  it('"open their team tab" after Q opened a deck means that company', () => {
    const screen = lastOpenedScreen([
      { role: "USER" },
      opened("COMPANY_DECK", TENSORGATE),
      { role: "USER" },
    ] as never);
    expect(screen).toEqual({ route: "COMPANY", companyId: TENSORGATE });
    expect(screenTabTarget(screen, { tab: "team" })).toEqual({
      page: "COMPANY_TEAM",
      id: TENSORGATE,
    });
  });

  it("the most recent opening wins, and a relationship gives its calls", () => {
    const screen = lastOpenedScreen([
      opened("COMPANY_DECK", TENSORGATE),
      opened("RELATIONSHIP_INVESTOR", INVESTOR),
    ] as never);
    expect(screenTabTarget(screen, { tab: "calls" })).toEqual({
      page: "RELATIONSHIP_INVESTOR",
      id: INVESTOR,
    });
  });

  it("nothing opened means nothing assumed", () => {
    expect(lastOpenedScreen([{ role: "USER" }, { role: "Q" }] as never)).toBe(
      undefined,
    );
  });
});
