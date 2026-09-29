import { describe, expect, it } from "vitest";

import { scoutQuery } from "../src/composition/scout.js";
import { composeReturningOpener } from "../src/voice/returning-opener.js";

/** Q's scout (founder direction 2026-09-29): the query and the opener. */
describe("the scout", () => {
  it("searches for the company's own name, pinned by its own site", () => {
    expect(
      scoutQuery("Zino Aviation", "https://www.zinoaviation.com/about"),
    ).toBe('"Zino Aviation" OR zinoaviation.com news');
    expect(scoutQuery(" Yamfield Agro ", null)).toBe('"Yamfield Agro" news');
    expect(scoutQuery("Kazikit", "not a url")).toBe('"Kazikit" news');
  });

  it("opens with what it found when there is no call or notes first", () => {
    expect(
      composeReturningOpener(
        "Zino",
        {
          nextCall: null,
          remindersDue: 0,
          firstReminder: null,
          notesReady: 0,
          unreadNotices: 1,
          scoutFinding: "Zino Aviation opens a Lagos hangar",
        },
        new Date("2026-09-30T08:00:00Z"),
      ),
    ).toBe(
      'Hi Zino. I spotted something new about your company: "Zino Aviation opens a Lagos hangar". Want the gist?',
    );
  });
});
