import { describe, expect, it } from "vitest";

import {
  TURN_READER_V53,
  TURN_READER_V54,
  TurnReaderV54ResultSchema,
  V53_Q_PITCH,
  V54_SCREEN_CONTROLS,
  createDefaultPromptRegistry,
  renderPrompt,
  DEFAULT_COMMUNICATION_PROFILE,
} from "../src/index.js";

/**
 * Owner 2026-10-17: a tab of the page on screen is chosen by the reader from
 * the page's own registered controls, by meaning -- never by matching words.
 */
describe("TURN_READER v54: the page's controls, chosen by meaning", () => {
  it("is the active reader, on top of v53 (Q Pitch kept); v53 is deprecated", () => {
    const active = createDefaultPromptRegistry().getActive("TURN_READER");
    expect(active.definition.version).toBe(54);
    expect(TURN_READER_V53.status).toBe("DEPRECATED");
    expect(TURN_READER_V54.template).toContain(V53_Q_PITCH);
    expect(TURN_READER_V54.template.replace(V54_SCREEN_CONTROLS, "")).toBe(
      TURN_READER_V53.template,
    );
  });

  it("reads by meaning in any language, and is not a question or another record", () => {
    expect(V54_SCREEN_CONTROLS).toMatch(
      /by what it means, in any words and any language/u,
    );
    expect(V54_SCREEN_CONTROLS).toMatch(/ouvre la salle de données/u);
    expect(V54_SCREEN_CONTROLS).toMatch(/is a question/u);
    expect(V54_SCREEN_CONTROLS).toMatch(/another company or person/u);
  });

  it("fences the page's controls (a tab's name is page text) and defaults to none", () => {
    const registry = createDefaultPromptRegistry();
    const render = (screenControls?: string) =>
      renderPrompt(registry, {
        task: "TURN_READER",
        charter: "Q_SYSTEM",
        operatingMode: "ASSESSMENT",
        communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
        environmentNotes: "test",
        variables: {
          recentTurns: [],
          utterance: "open the data room",
          modality: "TEXT",
          actions: [],
          actionGroups: "",
          ...(screenControls === undefined ? {} : { screenControls }),
        },
      })
        .messages.map((message) => message.content)
        .join("\n");
    const listed = render("tab.dataroom (TAB, Data room)");
    expect(listed).toMatch(
      /source="screenControls">>>\ntab\.dataroom \(TAB, Data room\)/u,
    );
    expect(render()).toMatch(/source="screenControls">>>\n\(none\)/u);
  });

  it("control is a control id or null; a malformed one is refused", () => {
    expect(TurnReaderV54ResultSchema.shape.control.parse("tab.dataroom")).toBe(
      "tab.dataroom",
    );
    expect(TurnReaderV54ResultSchema.shape.control.parse(undefined)).toBe(null);
    expect(
      TurnReaderV54ResultSchema.shape.control.safeParse("open the data room")
        .success,
    ).toBe(false);
  });
});
