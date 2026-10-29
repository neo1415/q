import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { liveQuestionShown } from "@/features/onboarding-conversation/conversation";
import { panelSwipeMoves } from "@/features/discover/stage/pitch-stage";

/**
 * Live e11 (2026-10-29), two small defects:
 * - c7: the investor corrected their cheque and Q seemed to answer with
 *   the same words as before: the question just answered stayed as the
 *   live line under the thread until Q's reply landed;
 * - Discover: a swipe that began on the company's text panel did not move
 *   the feed.
 */

describe("the question just answered is not shown again while Q replies", () => {
  const asked = { stepKey: "I2.cheque_min", text: "Should I use Harmattan?" };

  it("hidden while its reply is pending, shown once a new question binds", () => {
    const answered = { text: asked.text, question: asked };
    expect(liveQuestionShown(asked.text, answered, asked)).toBeNull();
    // Q's reply binds a new question (even in the same words): shown.
    const next = { ...asked };
    expect(liveQuestionShown(asked.text, answered, next)).toBe(asked.text);
    expect(liveQuestionShown("Which sectors?", answered, next)).toBe(
      "Which sectors?",
    );
    // Nothing answered yet: as before.
    expect(liveQuestionShown(asked.text, null, asked)).toBe(asked.text);
    expect(liveQuestionShown(null, answered, asked)).toBeNull();
  });
});

describe("the whole card is swipeable", () => {
  it("a swipe on the text panel moves the feed unless it scrolled the panel or selected text", () => {
    expect(panelSwipeMoves({ panelScrolledPx: 0, selecting: false })).toBe(
      true,
    );
    expect(panelSwipeMoves({ panelScrolledPx: 3, selecting: false })).toBe(
      true,
    );
    // Reading further down the panel is not a move.
    expect(panelSwipeMoves({ panelScrolledPx: 120, selecting: false })).toBe(
      false,
    );
    expect(panelSwipeMoves({ panelScrolledPx: -40, selecting: false })).toBe(
      false,
    );
    // Selecting text is not a move.
    expect(panelSwipeMoves({ panelScrolledPx: 0, selecting: true })).toBe(
      false,
    );
  });
});

describe("desktop Home: Talk to Q stays above the composer with the briefing shown", () => {
  it("the resting room is two thirds the size while the welcome carries the briefing", () => {
    const css = readFileSync(
      fileURLToPath(new URL("../app/globals.css", import.meta.url)),
      "utf8",
    ).replace(/\s+/gu, " ");
    expect(css).toContain(
      ".cq-arrival:has([data-q-welcome-line] [data-q-briefing]) .cq-room-presence { width: calc(var(--cq-room-box) * 2 / 3); height: calc(var(--cq-room-box) * 2 / 3); }",
    );
    expect(css).toContain(
      ".cq-arrival:has([data-q-welcome-line] [data-q-briefing]) .cq-room-presence:not(.is-gathered) > * { scale: 0.667; }",
    );
    const tsx = readFileSync(
      fileURLToPath(
        new URL("../src/features/q/q-conversation.tsx", import.meta.url),
      ),
      "utf8",
    );
    expect(tsx).toContain('"cq-arrival mx-auto flex');
  });
});
