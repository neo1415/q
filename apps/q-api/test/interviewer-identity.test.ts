import { describe, expect, it } from "vitest";

import { withKnownName } from "../src/voice/interviewer.js";

/**
 * Q does not write people's names (QX-004 core gate §7).
 *
 * Live, an investor whose firm is Zino Aviation was greeted with "Hi
 * there, Zino, glad to be working on the Zinoevation mandate with you
 * today." Nobody is called Zino and nothing is called Zinoevation. The
 * prompt had asked the model to open by the firm's name, and a model
 * writing prose will occasionally write a name that is nearly right —
 * which, for a name, is wrong. It is the first thing somebody reads.
 *
 * So a name is not the model's to write. It writes a placeholder and the
 * value Capital Q actually holds is put in here.
 */

describe("the name in a reply is the one Capital Q holds", () => {
  it("substitutes the recorded name wherever the model left the placeholder", () => {
    expect(
      withKnownName(
        "Glad to be working on the <them> mandate with you. How do you invest?",
        "Zino Aviation",
      ),
    ).toBe(
      "Glad to be working on the Zino Aviation mandate with you. How do you invest?",
    );
  });

  it("substitutes every occurrence, not just the first", () => {
    expect(
      withKnownName("<them> — tell me about <them>'s stage.", "Northstar"),
    ).toBe("Northstar — tell me about Northstar's stage.");
  });

  it("says something true when nothing has been recorded yet", () => {
    const said = withKnownName(
      "Glad to be working on the <them> mandate with you.",
      null,
    );
    expect(said).not.toContain("<them>");
    expect(said).toContain("your organisation");
  });

  it("leaves a reply with no placeholder exactly as it was", () => {
    const plain = "Seed, got it. What does the company do?";
    expect(withKnownName(plain, "Zino Aviation")).toBe(plain);
    expect(withKnownName(plain, null)).toBe(plain);
  });
});
