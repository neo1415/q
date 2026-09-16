import { describe, expect, it } from "vitest";

import {
  fillerLine,
  isNonLexical,
  recoveryLine,
  resumeAcknowledgement,
  spokenDestination,
  wantsToEndVoice,
} from "../src/voice/navigation.js";
import { unsaidPartOf } from "../src/voice/turn.js";

describe("spoken navigation, read deterministically", () => {
  it("hears a request to be taken somewhere and names the fixed destination", () => {
    expect(spokenDestination("Take me to the discover page.")).toBe("DISCOVER");
    expect(spokenDestination("can you open my profile")).toBe("PROFILE");
    expect(spokenDestination("Let's go home")).toBe("HOME");
    expect(spokenDestination("show me the capital page")).toBe("CAPITAL");
    expect(spokenDestination("take me back to the interview")).toBe(
      "INTERVIEW",
    );
    expect(spokenDestination("switch to the form please")).toBe("FORM");
  });

  it("does not mistake a question about a page for a request to go there", () => {
    expect(spokenDestination("What is Discover?")).toBeNull();
    expect(spokenDestination("Is my profile public?")).toBeNull();
    expect(spokenDestination("We are raising capital")).toBeNull();
    expect(spokenDestination("take me through the numbers")).toBeNull();
  });

  it("hears the person ending the voice conversation", () => {
    for (const line of [
      "End the chat.",
      "okay, let's stop talking",
      "I'd rather type",
      "Switch to chat please",
      "That's all for now, thanks.",
      "Bye for now",
    ]) {
      expect(wantsToEndVoice(line), line).toBe(true);
    }
    for (const line of [
      "End of the quarter was rough",
      "let's stop at series A",
      "bye-laws are in the data room",
    ]) {
      expect(wantsToEndVoice(line), line).toBe(false);
    }
  });

  it("treats a cough, a laugh or a bare sound as no turn at all", () => {
    for (const sound of [
      "(coughs)",
      "[laughter]",
      "uh",
      "hmm.",
      "um, uh",
      "[continue]",
    ]) {
      expect(isNonLexical(sound), sound).toBe(true);
    }
    expect(isNonLexical("uh, we raised two million")).toBe(false);
    expect(isNonLexical("hmm, tell me more about the fund")).toBe(false);
  });

  it("never says the same apology or the same filler twice in a row", () => {
    const apologies = new Set(
      Array.from({ length: 4 }, () => recoveryLine("EVIDENCE_UNAVAILABLE")),
    );
    expect(apologies.size).toBeGreaterThan(1);
    expect(recoveryLine("SOMETHING_ELSE")).toMatch(/ask me again/i);
    const fillers = new Set(
      Array.from({ length: 5 }, () => fillerLine("THINKING")),
    );
    expect(fillers.size).toBeGreaterThan(2);
    expect(resumeAcknowledgement()).not.toBe(resumeAcknowledgement());
  });
});

describe("what of a held answer is still unsaid", () => {
  it("drops the part already heard when the full text begins with it", () => {
    expect(
      unsaidPartOf({
        text: "Seed rounds run small. Most close fast. Few are priced.",
        spoken: "Seed rounds run small. ",
      }),
    ).toBe("Most close fast. Few are priced.");
  });

  it("drops the sentences already heard when the collected text differs", () => {
    expect(
      unsaidPartOf({
        text: "Most close fast. Seed rounds run small. Few are priced.",
        spoken: "Seed rounds run small.",
      }),
    ).toBe("Most close fast. Few are priced.");
  });

  it("is everything when nothing was heard, and nothing when all was heard", () => {
    expect(unsaidPartOf({ text: "One. Two.", spoken: "" })).toBe("One. Two.");
    expect(unsaidPartOf({ text: "One. Two.", spoken: "One. Two." })).toBe("");
  });
});
