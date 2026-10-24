import { describe, expect, it } from "vitest";

import { workTitle } from "../src/answer-document.js";
import { workSubjectInAsk } from "../src/answer.js";

/**
 * F-95 (QA 24 Oct 2026): "Write me an IC memo on Ledgerfold I can share
 * with my partners." was filed as a document titled "Memo".
 */
describe("an IC memo is titled as one, with who it is about", () => {
  it("names the kind and the company the ask names", () => {
    const question =
      "Write me an IC memo on Ledgerfold I can share with my partners.";
    expect(workSubjectInAsk(question)).toBe("Ledgerfold");
    expect(
      workTitle({
        heading: null,
        question,
        subject: workSubjectInAsk(question),
      }),
    ).toBe("IC memo: Ledgerfold");
  });

  it("an investment committee memo is an IC memo; a plain memo stays a memo", () => {
    expect(
      workTitle({
        heading: null,
        question: "draft an investment committee memo",
        subject: "Anchor",
      }),
    ).toBe("IC memo: Anchor");
    expect(
      workTitle({ heading: null, question: "a short memo", subject: null }),
    ).toBe("Memo");
  });

  it("reads no subject from a day or an ask that names no one", () => {
    expect(workSubjectInAsk("Prep for my call on Friday")).toBeNull();
    expect(workSubjectInAsk("write me a memo")).toBeNull();
  });
});
