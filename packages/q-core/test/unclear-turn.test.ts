import { describe, expect, it } from "vitest";

import { isUnclearTurn, unclearTurnReply } from "../src/index.js";

/**
 * Words Q could not make out: one brief prompt, then silence (lead
 * 2026-09-25). Properties over every kind and transcript quality.
 */

const KINDS = [
  "ANSWER",
  "CORRECTION",
  "QUESTION_TO_Q",
  "RESEARCH_REQUEST",
  "TOOL_REQUEST",
  "UNCLEAR_TRANSCRIPT",
  "SMALL_TALK",
] as const;
const QUALITIES = ["CLEAR", "NOISY", "FRAGMENT"] as const;

describe("the reply to an unclear turn", () => {
  it("is unclear exactly for an unreadable reading or a fragment", () => {
    for (const kind of KINDS) {
      for (const transcript of QUALITIES) {
        expect(
          isUnclearTurn({ kind, transcript }),
          `${kind}/${transcript}`,
        ).toBe(kind === "UNCLEAR_TRANSCRIPT" || transcript === "FRAGMENT");
      }
    }
  });

  it("prompts once, briefly, and is silent on every unclear turn after it", () => {
    for (const kind of KINDS) {
      for (const transcript of QUALITIES) {
        if (!isUnclearTurn({ kind, transcript })) continue;
        const first = unclearTurnReply({ kind, transcript }, 0);
        expect(first.kind).toBe("PROMPT");
        if (first.kind === "PROMPT") {
          expect(first.line.split(/\s+/).length).toBeLessThanOrEqual(5);
        }
        for (let before = 1; before < 5; before += 1) {
          expect(unclearTurnReply({ kind, transcript }, before)).toEqual({
            kind: "SILENT",
          });
        }
      }
    }
  });
});
