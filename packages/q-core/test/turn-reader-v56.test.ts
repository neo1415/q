import { describe, expect, it } from "vitest";

import {
  TURN_READER_V55,
  TURN_READER_V56,
  TurnReaderV56ResultSchema,
  V55_SCREEN_CONTROLS,
  V56_FIT_EXCLUDE_SHOWN,
  createDefaultPromptRegistry,
  renderPrompt,
  DEFAULT_COMMUNICATION_PROFILE,
} from "../src/index.js";

/**
 * Production 2026-10-17, conversation 4f07dae7: "give me three new
 * companies that fit my mandate" returned two of the three just shown.
 * The reader says by meaning that they want companies other than those.
 */
describe("TURN_READER v56: a FIT question for companies not shown yet", () => {
  it("is v55 kept whole plus the FIT rule; both are now deprecated (v57 is active)", () => {
    const active = createDefaultPromptRegistry().getActive("TURN_READER");
    expect(active.definition.version).toBe(69);
    expect(TURN_READER_V55.status).toBe("DEPRECATED");
    expect(TURN_READER_V56.status).toBe("DEPRECATED");
    expect(TURN_READER_V56.template).toContain(V55_SCREEN_CONTROLS);
    expect(TURN_READER_V56.template.replace(V56_FIT_EXCLUDE_SHOWN, "")).toBe(
      TURN_READER_V55.template,
    );
  });

  it("reads new, other, more and anything else by meaning in any language", () => {
    expect(V56_FIT_EXCLUDE_SHOWN).toMatch(
      /by what it means, in any words and any language/u,
    );
    for (const said of [
      "give me three new companies that fit my mandate",
      "different ones",
      "anything else?",
      "who else fits?",
      "d'autres entreprises ?",
    ]) {
      expect(V56_FIT_EXCLUDE_SHOWN).toContain(said);
    }
    // "Rank them" stays about the companies shown, never excludes them.
    expect(V56_FIT_EXCLUDE_SHOWN).toMatch(
      /false when they ask about the companies already shown/u,
    );
  });

  it("parses excludeShown leniently: absent or malformed is false, never a refusal", () => {
    const question = (extra: Record<string, unknown>) =>
      TurnReaderV56ResultSchema.shape.question.parse({
        kind: "FIT",
        text: "three new companies that fit my mandate",
        count: 3,
        ...extra,
      });
    expect(question({ excludeShown: true })?.excludeShown).toBe(true);
    expect(question({})?.excludeShown).toBe(false);
    expect(question({ excludeShown: "maybe" })?.excludeShown).toBe(false);
    expect(TurnReaderV56ResultSchema.shape.question.parse(undefined)).toBe(
      null,
    );
  });

  it("renders, with excludeShown in the output schema the provider sees", () => {
    const rendered = renderPrompt(createDefaultPromptRegistry(), {
      task: "TURN_READER",
      charter: "Q_SYSTEM",
      operatingMode: "ASSESSMENT",
      communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
      environmentNotes: "test",
      variables: {
        recentTurns: [],
        utterance: "anything else?",
        modality: "TEXT",
        actions: [],
        actionGroups: "",
      },
    });
    expect(rendered.bundle.task).toMatch(/\/v69$/u);
    expect(JSON.stringify(rendered.output)).toContain("excludeShown");
  });
});
