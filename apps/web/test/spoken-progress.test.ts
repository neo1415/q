import { describe, expect, it } from "vitest";

import { nextSpokenPiece } from "../src/features/voice/spoken-progress";

/**
 * Turn latency row 18: a typed answer is said from its first finished
 * sentence, piece by piece as it streams, and never half a sentence.
 */

function speakAll(stream: readonly string[], limit = 2_000): string[] {
  const said: string[] = [];
  let spoken = 0;
  stream.forEach((text, index) => {
    const next = nextSpokenPiece({
      text,
      spoken,
      final: index === stream.length - 1,
      limit,
    });
    if (next !== null) {
      said.push(next.piece);
      spoken = next.spoken;
    }
  });
  return said;
}

describe("speaking a typed answer as it streams", () => {
  it("says the first sentence as soon as it is finished", () => {
    expect(
      nextSpokenPiece({
        text: "Halyard fits best. Clearwater is",
        spoken: 0,
        final: false,
        limit: 2_000,
      }),
    ).toEqual({ piece: "Halyard fits best.", spoken: 18 });
  });

  it("never says half a sentence before the answer is final", () => {
    expect(
      nextSpokenPiece({
        text: "Halyard fits best because",
        spoken: 0,
        final: false,
        limit: 2_000,
      }),
    ).toBeNull();
  });

  it("each word is said once, in order, and the tail when it settles", () => {
    const said = speakAll([
      "Halyard fits",
      "Halyard fits best. Clear",
      "Halyard fits best. Clearwater is next. Tensor",
      "Halyard fits best. Clearwater is next. Tensorgate is third",
    ]);
    expect(said).toEqual([
      "Halyard fits best.",
      "Clearwater is next.",
      "Tensorgate is third",
    ]);
  });

  it("an answer that arrives whole is one piece", () => {
    expect(speakAll(["One. Two. Three."])).toEqual(["One. Two. Three."]);
  });

  it("stops at the speech route's ceiling", () => {
    const said = speakAll(
      ["Alpha one. Beta two. Gamma three.", "Alpha one. Beta two. Gamma three."],
      20,
    );
    expect(said.join(" ").length).toBeLessThanOrEqual(20);
  });
});
