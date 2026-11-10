import { describe, expect, it } from "vitest";

import { classifyStoryTrigger } from "../src/story/trigger.js";

const edition = (text: string) => {
  const found = classifyStoryTrigger(text);
  return found?.kind === "STORY" ? found.edition : (found?.kind ?? null);
};

/** Owner, live voice 10 Nov: these went to the model instead of the story. */
describe("the story ask after other words", () => {
  it("takes the ask after a thank-you or a yes", () => {
    expect(edition("Thank you. Pitch yourself to investors")).toBe("INVESTOR");
    expect(edition("Yes, pitch yourself to investors")).toBe("INVESTOR");
    expect(edition("Okay great. Now pitch yourself to founders.")).toBe(
      "FOUNDER",
    );
    expect(edition("Hey Q, pitch")).toBe("FULL");
    expect(edition("Hey Q, pitch yourself.")).toBe("FULL");
  });

  it("takes Q Pitch by name", () => {
    expect(edition("Open Q Pitch")).toBe("FULL");
    expect(edition("Start the Q pitch for investors")).toBe("INVESTOR");
    expect(edition("cue pitch")).toBe("FULL");
  });

  it("still leaves other words alone", () => {
    expect(edition("pitch")).toBeNull();
    expect(
      edition("How should a founder pitch to investors in Lagos?"),
    ).toBeNull();
    expect(edition("I don't want you to pitch yourself")).toBeNull();
    expect(edition("Is the Q pitch working today?")).toBeNull();
    expect(edition("What is Capital Q?")).toBe("BRIEF");
  });
});
