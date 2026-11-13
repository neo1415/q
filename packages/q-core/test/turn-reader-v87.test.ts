import { describe, expect, it } from "vitest";

import {
  createDefaultPromptRegistry,
  TURN_READER_V86,
  TURN_READER_V87,
  TurnNavigationIntentV87Schema,
  TurnReaderV87ResultSchema,
  V86_COMPANY_MEDIA,
  V87_NAVIGATION_TAB,
} from "../src/index.js";

/**
 * TURN_READER v87 (live 13 Nov 2026 on a37e844d5): "Can I see Clinicrest's
 * data room?" opened the bare profile. The reading names the part of the
 * record page they mean (`navigation.tab`) by meaning, never by a word list.
 */
describe("TURN_READER v87", () => {
  it("is active: v86 with one NAVIGATION TAB paragraph after COMPANY MEDIA, on v87's schema", () => {
    const registry = createDefaultPromptRegistry();
    const active = registry.getActive("TURN_READER").definition;
    expect(active.version).toBe(87);
    expect(active.status).toBe("ACTIVE");
    expect(registry.get("TURN_READER", 86)?.definition.status).toBe(
      "DEPRECATED",
    );
    expect(active.output.kind === "STRUCTURED" && active.output.schema).toBe(
      TurnReaderV87ResultSchema,
    );
    expect(TURN_READER_V87.variables).toEqual(TURN_READER_V86.variables);
    expect(
      TURN_READER_V87.template.replace(`\n${V87_NAVIGATION_TAB}`, ""),
    ).toBe(TURN_READER_V86.template);
    expect(TURN_READER_V87.template).toContain(
      `${V86_COMPANY_MEDIA}\n${V87_NAVIGATION_TAB}`,
    );
    expect(TURN_READER_V87.template.split(V87_NAVIGATION_TAB)).toHaveLength(2);
  });

  it("names every record tab by meaning, in any language, with null for the whole record and when unsure", () => {
    for (const said of [
      "navigation.mode GO or CONTEXT",
      "by meaning and in any language",
      "dataroom",
      "deck",
      "elevator",
      "team",
      "diligence",
      "messages",
      "calls",
      "deal",
      "overview",
      "Write null for the record as a whole, and whenever unsure",
      `"Can I see Clinicrest's data room?" is GO with tab dataroom`,
      '"tell me about Ledgerline" is tab null',
    ]) {
      expect(V87_NAVIGATION_TAB).toContain(said);
    }
  });

  it("parses the tab leniently: a malformed or unknown tab is null, never a lost reading", () => {
    const base = {
      kind: "TOOL_REQUEST",
      transcript: "CLEAR",
      confidence: "HIGH",
    };
    expect(
      TurnReaderV87ResultSchema.parse({
        ...base,
        navigation: { mode: "GO", tab: "dataroom" },
      }).navigation,
    ).toEqual({
      mode: "GO",
      negated: false,
      destination: null,
      tab: "dataroom",
    });
    expect(
      TurnReaderV87ResultSchema.parse({ ...base, navigation: { mode: "GO" } })
        .navigation?.tab,
    ).toBeNull();
    expect(
      TurnReaderV87ResultSchema.parse({
        ...base,
        navigation: { mode: "GO", tab: "the documents" },
      }).navigation,
    ).toMatchObject({ mode: "GO", tab: null });
    expect(
      TurnNavigationIntentV87Schema.parse({ mode: "CONTEXT", tab: 7 }).tab,
    ).toBeNull();
    expect(TurnReaderV87ResultSchema.parse(base).navigation).toBeNull();
  });
});
