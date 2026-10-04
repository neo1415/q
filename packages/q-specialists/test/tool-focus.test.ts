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

  describe("research and web reading are guaranteed (run 13955ca2)", () => {
    const RESEARCH = [
      "extract_public_web",
      "lookup_public_profile",
      "research_public_web",
    ];

    it("the exact reading of run 13955ca2: RESEARCH_REQUEST, research EXPLICIT, on their own company", () => {
      const got = focus(
        reading({
          kind: "RESEARCH_REQUEST",
          questionKind: null,
          research: "EXPLICIT",
          text: "read my website zinoaviation.com and tell me what's missing from my profile",
        }),
        ["COMPANY"],
      );
      expect(got?.areas).toEqual(["Records", "Research"]);
      expect(got?.tools).toEqual(RESEARCH);
    });

    it("research EXPLICIT or OFFERED on any kind of turn", () => {
      for (const research of ["EXPLICIT", "OFFERED"]) {
        expect(
          focus(reading({ questionKind: "THEIR_OWN_RECORDS", research }))
            ?.tools,
        ).toEqual(RESEARCH);
      }
      for (const research of ["NEVER", "ONLY_IF_EMPTY", null]) {
        expect(
          focus(reading({ questionKind: "THEIR_OWN_RECORDS", research }))
            ?.tools,
        ).toEqual([]);
      }
    });

    it("a URL or a bare domain in their words, whatever the reading", () => {
      for (const text of [
        "can you read https://zinoaviation.com/about",
        "read my website: zinoaviation.com",
        "check WWW.Example.org please",
        "our site is acme.co.uk",
        "look at http://10.0.0.1",
      ]) {
        expect(focus(reading({ text }))?.tools, text).toEqual(RESEARCH);
      }
      for (const text of [
        "summarise deck.pdf for me",
        "we moved to v1.5 last week",
        "what is my runway?",
        "e.g. the board pack",
      ]) {
        expect(focus(reading({ text }))?.tools ?? [], text).toEqual([]);
      }
    });

    it("small talk stays the core even with a domain in it", () => {
      expect(
        focus(reading({ kind: "SMALL_TALK", text: "thanks, see acme.com" })),
      ).toEqual({ areas: ["Screens"], tools: [] });
    });
  });
});
