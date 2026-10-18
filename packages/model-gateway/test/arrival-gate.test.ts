import { describe, expect, it } from "vitest";

import { pointsAtArrival } from "../src/q/arrival-answer.js";

// K2 regression: the second mandate ask ("... Remind me.") passed the cheap
// arrival gate on the capital R, so TURN_SKIM ran as an extra model call.
describe("pointsAtArrival", () => {
  it("does not fire on a mandate recall, even with a later capitalised sentence", () => {
    expect(pointsAtArrival("What is my mandate?")).toBe(false);
    expect(pointsAtArrival("What is my mandate? Remind me.")).toBe(false);
    expect(pointsAtArrival("Show my sectors. Remind me")).toBe(false);
  });
  it("does not fire on a question about their own profile or raise", () => {
    expect(pointsAtArrival("what is my company profile")).toBe(false);
    expect(pointsAtArrival("is my raise on track")).toBe(false);
    expect(pointsAtArrival("what are my sectors and stages")).toBe(false);
  });
  it("still fires on pointing words and mid-sentence proper nouns", () => {
    expect(pointsAtArrival("what did they say")).toBe(true);
    expect(pointsAtArrival("did Amara reply")).toBe(true);
  });
});
