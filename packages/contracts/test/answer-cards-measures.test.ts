import { describe, expect, it } from "vitest";

import { FIT_PARAMETERS, Q_ANSWER_CARD_MEASURES_MAX } from "../src/index.js";

describe("answer card measures", () => {
  it("allow one measure per fit parameter, so a full profile keeps its cards", () => {
    expect(Q_ANSWER_CARD_MEASURES_MAX).toBe(FIT_PARAMETERS.length);
    expect(Q_ANSWER_CARD_MEASURES_MAX).toBe(9);
  });
});
