import { describe, expect, it } from "vitest";

import { withoutRepeatedReceipt } from "../src/voice/onboarding-flow.js";

/**
 * QA 24 Oct (investor.qa-onboard-1024g): code's receipt said the firm was
 * saved, and the model's reply after it said so again.
 */
describe("the reply after code's receipt", () => {
  it("drops a sentence that says again what the receipt saved", () => {
    expect(
      withoutRepeatedReceipt(
        "Haddad Gulf Partners is noted. I couldn’t save the USD currency yet, but it’s held. How do you invest?",
        ["Haddad Gulf Partners"],
      ),
    ).toBe(
      "I couldn’t save the USD currency yet, but it’s held. How do you invest?",
    );
    expect(
      withoutRepeatedReceipt(
        "Venture capital fund is saved as how you invest. Are you deploying capital right now?",
        ["Venture capital fund"],
      ),
    ).toBe("Are you deploying capital right now?");
  });

  it("keeps questions, other facts, and sentences that claim nothing", () => {
    const reply =
      "Is Haddad Gulf Partners saved under the right name? Seed is saved too. Haddad Gulf Partners sounds like a Gulf fund.";
    expect(withoutRepeatedReceipt(reply, ["Haddad Gulf Partners"])).toBe(reply);
    expect(withoutRepeatedReceipt(reply, [])).toBe(reply);
  });
});
