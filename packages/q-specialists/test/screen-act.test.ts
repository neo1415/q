import { describe, expect, it } from "vitest";
import { screenActOf } from "../src/answer.js";
describe("bare screen commands", () => {
  it("does the command and nothing else", () => {
    expect(screenActOf("Scroll down.")?.act).toBe("PAGE_DOWN");
    expect(screenActOf("Scroll down on the relationships page")).toBeNull();
    expect(screenActOf("Can you scroll down please?")?.act).toBe("PAGE_DOWN");
    expect(screenActOf("Hey Q, scroll up")?.act).toBe("PAGE_UP");
    expect(screenActOf("go to the top")?.act).toBe("SCROLL_TOP");
    expect(screenActOf("Go back")?.act).toBe("GO_BACK");
    expect(screenActOf("What are the top three companies?")).toBeNull();
    expect(screenActOf("scroll down and tell me who is connected")).toBeNull();
  });
});
