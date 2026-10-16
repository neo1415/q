import { describe, expect, it } from "vitest";

import type { QTurn } from "@/features/q/conversation";
import { viewerQuestions } from "@/features/q-pitch/live-question";

const person = (id: string, text: string, unconfirmed = false): QTurn => ({
  kind: "PERSON",
  id,
  text,
  unconfirmed,
});

describe("viewerQuestions (a live question pauses the tour)", () => {
  it("counts a question typed here: first unconfirmed, then confirmed", () => {
    const seen = new Set<string>();
    const asked = new Set<string>();
    expect(
      viewerQuestions(
        [person("local-1", "What cheque range?", true)],
        seen,
        asked,
      ),
    ).toEqual([]);
    expect(
      viewerQuestions([person("srv-1", "What cheque range?")], seen, asked),
    ).toEqual(["srv-1"]);
    // Once only.
    expect(
      viewerQuestions([person("srv-1", "What cheque range?")], seen, asked),
    ).toEqual([]);
  });

  it("never counts history a conversation loads when the page's subject changes", () => {
    // Run 4, 16 Oct: the previous run's question arrived confirmed with the
    // Harbourline conversation and paused the tour.
    const seen = new Set<string>();
    const asked = new Set<string>();
    expect(
      viewerQuestions(
        [person("old-1", "What cheque range does my mandate allow?")],
        seen,
        asked,
      ),
    ).toEqual([]);
  });
});
