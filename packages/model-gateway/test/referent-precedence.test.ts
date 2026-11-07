import { describe, expect, it } from "vitest";

import { onScreenCompanyFact } from "../src/q/company-fact.js";
import { POINTING_LINE, screenSubjectNote } from "../src/q/index.js";

/**
 * Owner live test, 7 Nov 2026 (R2): "i meant me, what can you find about me
 * online" was answered "You mean Clearwater Assurance" (the company on the
 * screen), and pointing words were bound to the screen even when the
 * conversation was about another company. Every rule the answer is given
 * about pointing now says the same precedence as the situation: first
 * person is always the person; a pointing word follows the conversation,
 * then the screen.
 */
describe("the answer's pointing rules (R2)", () => {
  it("POINTING_LINE: the conversation first, then the screen; first person is never the screen", () => {
    expect(POINTING_LINE).toMatch(
      /they mean what the conversation is about, and when it names nothing, what their screen shows/u,
    );
    expect(POINTING_LINE).toMatch(
      /Me, my, I and myself always mean themselves, never what is on their screen/u,
    );
  });

  it("the on-screen company fact is 'this company' only when the conversation names no other, never 'me'", () => {
    const fact = onScreenCompanyFact({ canonicalName: "Clearwater Assurance" });
    expect(fact?.statement).toMatch(/when the conversation names no other/u);
    expect(fact?.statement).toMatch(/never what they mean by me or my/u);
  });

  it("asked who they mean, the screen answers pointing words, never first person", () => {
    const note = screenSubjectNote({
      route: "COMPANY",
      companyId: "3f1d2c4b-5a6e-4f70-8a91-0b2c3d4e5f61",
    });
    expect(note?.content).toMatch(
      /unless the conversation names another; me, my, I and myself are always themselves/u,
    );
  });
});

/**
 * Owner live test, 7 Nov 2026 (R6): replies said "The previous screen
 * action opened …", "… was opened on screen". The receipts the answer is
 * given are records about the person's screen; the note that carries them
 * now says they are never words to repeat, and how to say them.
 */
describe("the screen receipts note (R6)", () => {
  it("records, not words: speak to them as you, never narrate the receipt", async () => {
    const { screenActsNote } = await import("../src/q/index.js");
    const note = screenActsNote(["Opened /company/x on their screen (DONE)."]);
    expect(note?.content).toMatch(
      /records for you, never words to repeat: say it to them as you \(I opened it for you\)/u,
    );
    expect(note?.content).toMatch(
      /never the user, the person, on screen or the previous screen action/u,
    );
  });
});
