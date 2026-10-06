import { describe, expect, it } from "vitest";

import {
  NOT_ON_SCREEN_LINE,
  claimsOnScreen,
  createScreenClaimGuard,
  withoutUnbackedScreenClaims,
} from "../src/q/screen-claims.js";

/**
 * R0 (Zino live 2026-10-06): Q said the certificate had appeared on his
 * screen, and that diligence materials were "now in view", when no tool
 * had opened anything. A screen claim stands only with a UI_INTENT.
 */
describe("screen claims", () => {
  it("recognises the claims Q made live, and not ordinary sentences", () => {
    for (const claim of [
      "The Halyard Security company page could not be opened, but its available diligence materials are now in view.",
      "The Certificate of Incorporation has appeared on your screen.",
      "I've opened the certificate for you.",
      "It's on your screen now.",
      "Opening the certificate of incorporation.",
    ]) {
      expect(claimsOnScreen(claim), claim).toBe(true);
    }
    for (const plain of [
      "Halyard Security is first on your Discover page.",
      "The data room lists the Certificate of Incorporation as open to you.",
      "It is on your screen to approve.",
      "Would you like me to open it?",
    ]) {
      expect(claimsOnScreen(plain), plain).toBe(false);
    }
  });

  it("corrects an unbacked claim once in the finished answer and keeps the rest", () => {
    const { text, removed } = withoutUnbackedScreenClaims(
      "The company page could not be opened, but its materials are now in view. I found the October 2026 seed deck.\n\n- Seed deck\n- Certificate",
      false,
    );
    expect(removed).toBe(1);
    expect(text).toBe(
      `${NOT_ON_SCREEN_LINE} I found the October 2026 seed deck.\n\n- Seed deck\n- Certificate`,
    );
  });

  it("leaves the claim when a tool's UI intent backs it", () => {
    const answer = "Opening the certificate. It's on your screen now.";
    expect(withoutUnbackedScreenClaims(answer, true)).toEqual({
      text: answer,
      removed: 0,
    });
  });

  it("guards a streamed answer sentence by sentence, the correction said once", () => {
    let backed = false;
    const guard = createScreenClaimGuard(() => backed);
    expect(guard.sentence("It has appeared on your screen.")).toBe(
      NOT_ON_SCREEN_LINE,
    );
    expect(guard.sentence("I've opened it.")).toBeNull();
    expect(guard.sentence("The deck has twelve slides.")).toBe(
      "The deck has twelve slides.",
    );
    backed = true;
    expect(guard.sentence("It's on your screen now.")).toBe(
      "It's on your screen now.",
    );
  });
});
