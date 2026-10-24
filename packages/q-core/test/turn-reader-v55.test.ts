import { describe, expect, it } from "vitest";

import {
  TURN_READER_V54,
  TURN_READER_V55,
  TurnReaderV55ResultSchema,
  V54_FROM_SHOWN,
  V55_SCREEN_CONTROLS,
  createDefaultPromptRegistry,
  renderPrompt,
  DEFAULT_COMMUNICATION_PROFILE,
} from "../src/index.js";

/**
 * Owner 2026-10-17: a tab of the page on screen is chosen by the reader from
 * the page's own registered controls, by meaning -- never by matching words.
 */
describe("TURN_READER v55: the page's controls, chosen by meaning", () => {
  it("sits on top of v54 (SHOWN and fromShown kept) under the active v56; v54 is deprecated", () => {
    const active = createDefaultPromptRegistry().getActive("TURN_READER");
    expect(active.definition.version).toBe(63);
    expect(TURN_READER_V54.status).toBe("DEPRECATED");
    expect(TURN_READER_V55.template).toContain(V54_FROM_SHOWN);
    expect(TURN_READER_V55.template.replace(V55_SCREEN_CONTROLS, "")).toBe(
      TURN_READER_V54.template,
    );
  });

  it("reads by meaning in any language, and is not a question or another record", () => {
    expect(V55_SCREEN_CONTROLS).toMatch(
      /by what it means, in any words and any language/u,
    );
    expect(V55_SCREEN_CONTROLS).toMatch(/ouvre la salle de données/u);
    expect(V55_SCREEN_CONTROLS).toMatch(/is a question/u);
    expect(V55_SCREEN_CONTROLS).toMatch(/another company or person/u);
    // Production AT, run 5553724c: a tab named alone is opened, never made.
    expect(V55_SCREEN_CONTROLS).toMatch(
      /"now the pitch deck" on a company's page opens its pitch deck tab; it never asks to make a deck/u,
    );
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
    expect(TurnReaderV55ResultSchema.shape.control.parse("tab.dataroom")).toBe(
      "tab.dataroom",
    );
    expect(TurnReaderV55ResultSchema.shape.control.parse(undefined)).toBe(null);
    expect(
      TurnReaderV55ResultSchema.shape.control.safeParse("open the data room")
        .success,
    ).toBe(false);
  });
});
