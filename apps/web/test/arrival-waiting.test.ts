import { describe, expect, it } from "vitest";

import { waitingWords } from "../src/features/briefing/arrival";

/** Live 2026-10-08 as Marcus: one name said three times. */
describe("what waits on them, in the arrival briefing", () => {
  it("says each name once, and 'they' after the lowdown named them", () => {
    expect(
      waitingWords(
        [
          "Zino Aviation is waiting for a reply",
          "Zino Aviation sent you a message",
        ],
        "Zino Aviation wrote back.",
      ),
    ).toBe("They're waiting for your reply.");
    expect(
      waitingWords(
        ["Zino Aviation sent you a message", "Spheros is waiting for a reply"],
        "",
      ),
    ).toBe("Zino Aviation and Spheros are waiting for replies.");
  });

  it("says a notice that names no one as written, and nothing for none", () => {
    expect(waitingWords(["A data room request needs you"], "")).toBe(
      "A data room request needs you.",
    );
    expect(waitingWords([], "All quiet.")).toBeNull();
  });
});
