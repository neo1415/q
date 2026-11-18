import { describe, expect, it } from "vitest";

import { withoutRestatedLines } from "../src/q/action-talk.js";

/**
 * Live 18 Nov 2026 (Halyard Security, run 82921afe): "Undo that" was
 * answered with the withdrawal's line twice -- the model's copy of the
 * tool result, then code's own line. Code's line is said once.
 */
const CODE_LINE =
  "Undone: your active users of 74,000 for November 2026 is withdrawn. It stays in your company's history as withdrawn, with your reason; it is no longer treated as your company's figure.";
const MODEL_COPY =
  "Undone: your active users of 74,000 for November 2026 is withdrawn. It stays in your company’s history as withdrawn, with your reason; it is no longer treated as Halyard Security’s figure.";

describe("code's action line is said once", () => {
  it("the live undo answer: the model's restatement goes, so the composed reply holds the line once", () => {
    const answer = withoutRestatedLines(MODEL_COPY, [CODE_LINE]);
    expect(answer).toEqual({ text: "", removed: 2 });
    const composed = [answer.text, CODE_LINE]
      .filter((part) => part.trim().length > 0)
      .join("\n\n");
    expect(composed).toBe(CODE_LINE);
    expect(composed.match(/Undone:/gu)).toHaveLength(1);
  });

  it("the model's own analysis beside the line stays", () => {
    const analysis =
      "Licensed seats rose from 71,000 in September to 74,000 in November 2026. That is about 4.2% over two months.";
    const recorded =
      "Recorded your licensed seats of 74,000 for November 2026, as your own statement (self-reported), private to your company: investors don't see it.";
    expect(withoutRestatedLines(analysis, [recorded])).toEqual({
      text: analysis,
      removed: 0,
    });
  });

  it("no code line: nothing changes", () => {
    expect(withoutRestatedLines(MODEL_COPY, [])).toEqual({
      text: MODEL_COPY,
      removed: 0,
    });
  });
});
