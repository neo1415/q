import { describe, expect, it } from "vitest";

import { toolFocusOf, type FocusReading } from "../src/tool-focus.js";

/** Lead 2026-10-02: what a turn is about, decided by code from its reading. */
describe("toolFocusOf", () => {
  const areaOf = (tool: string) =>
    ({
      propose_meeting: "Relationships",
      set_deck_audience: "Documents",
      set_investor_visibility: "Visibility",
    })[tool] ?? null;
  const reading = (over: Partial<FocusReading>): FocusReading => ({
    kind: "QUESTION_TO_Q",
    questionKind: null,
    namedTools: [],
    hand: null,
    handOver: false,
    ...over,
  });
  const focus = (
    read: FocusReading | null,
    subjectKinds: readonly string[] = [],
    previous: { areas: string[]; tools: string[] } | null = null,
  ) => toolFocusOf({ reading: read, subjectKinds, areaOf, previous });

  it("a named action is its tool and its area, plus the subjects' areas", () => {
    expect(
      focus(
        reading({ kind: "TOOL_REQUEST", namedTools: ["set_deck_audience"] }),
        ["COMPANY"],
      ),
    ).toEqual({
      areas: ["Documents", "Records"],
      tools: ["set_deck_audience"],
    });
  });

  it("a question by its kind; research; a hand; a hand-over", () => {
    expect(focus(reading({ questionKind: "ADVICE" }))?.areas).toEqual([
      "Research",
    ]);
    expect(focus(reading({ kind: "RESEARCH_REQUEST" }))?.areas).toEqual([
      "Research",
    ]);
    expect(
      focus(reading({ kind: "TOOL_REQUEST", hand: "SET_VISIBILITY" }))?.areas,
    ).toEqual(["Visibility"]);
    expect(
      focus(reading({ kind: "TOOL_REQUEST", handOver: true }))?.areas,
    ).toEqual(["Relationships"]);
  });

  it("small talk and control are the core only", () => {
    for (const kind of [
      "SMALL_TALK",
      "CONTROL",
      "OFF_TOPIC",
      "UNCLEAR_TRANSCRIPT",
    ]) {
      expect(focus(reading({ kind }))).toEqual({
        areas: ["Screens"],
        tools: [],
      });
    }
  });

  it("'yes' to Q's offer keeps the previous turn's focus", () => {
    expect(
      focus(reading({ kind: "ANSWER" }), [], {
        areas: ["Relationships"],
        tools: ["propose_meeting"],
      }),
    ).toEqual({ areas: ["Relationships"], tools: ["propose_meeting"] });
  });

  it("nothing in the reading, or no reading: the purpose's list as before", () => {
    expect(focus(null)).toBeNull();
    expect(focus(reading({ kind: "ANSWER" }))).toBeNull();
    // A request to act about a company widens to its area (run d396af2f).
    expect(focus(reading({ kind: "TOOL_REQUEST" }), ["COMPANY"])).toEqual({
      areas: ["Records"],
      tools: [],
      widen: true,
    });
  });

  it("run d396af2f: a request to act that names no tool keeps the purpose's list and adds its subjects' areas", () => {
    expect(
      focus(reading({ kind: "TOOL_REQUEST" }), ["INVESTOR_ORGANISATION"]),
    ).toEqual({ areas: ["Relationships"], tools: [], widen: true });
    // Nothing to act on and nothing it is about: the purpose's list.
    expect(focus(reading({ kind: "TOOL_REQUEST" }), [])).toBeNull();
    // A question that names nothing is unchanged.
    expect(focus(reading({}), ["INVESTOR_ORGANISATION"])).toBeNull();
  });
});
