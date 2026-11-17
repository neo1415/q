import { describe, expect, it } from "vitest";

import {
  createDefaultPromptRegistry,
  TURN_READER_V90,
  TURN_READER_V91,
  TurnQuestionV91Schema,
  TurnReaderV91ResultSchema,
  V90_FIT_REASONS,
  V91_REFINES_SHOWN_LIST,
} from "../src/index.js";

/**
 * TURN_READER v91 (owner live 17 Nov 2026, conversation 9995dcca): the
 * conditions of the list just shown were carried into a new list ("outside
 * my preferred sectors, keep them separate" kept "pre-revenue"). The
 * reading says whether a list ask refines the list just shown
 * (`question.refinesShownList`); code carries conditions only then.
 */
describe("TURN_READER v91", () => {
  it("is active: v90 with one REFINES THE LIST paragraph after WHY THEY FIT, on v91's schema", () => {
    const registry = createDefaultPromptRegistry();
    const active = registry.getActive("TURN_READER").definition;
    expect(active.version).toBe(91);
    expect(registry.get("TURN_READER", 90)?.definition.status).toBe(
      "DEPRECATED",
    );
    expect(active.output.kind === "STRUCTURED" && active.output.schema).toBe(
      TurnReaderV91ResultSchema,
    );
    expect(TURN_READER_V91.variables).toEqual(TURN_READER_V90.variables);
    expect(
      TURN_READER_V91.template.replace(`\n${V91_REFINES_SHOWN_LIST}`, ""),
    ).toBe(TURN_READER_V90.template);
    expect(TURN_READER_V91.template).toContain(
      `${V90_FIT_REASONS}\n${V91_REFINES_SHOWN_LIST}`,
    );
  });

  it("names the live refinement and the live new list, by meaning", () => {
    for (const said of [
      "by meaning, in any words and any language",
      "leave out the ones we're already in contact with",
      "keep them separate from my normal matches",
      "null when there was no list just before or you cannot tell",
    ]) {
      expect(V91_REFINES_SHOWN_LIST).toContain(said);
    }
  });

  it("parses leniently: absent or malformed is not stated (null); fitReasons is kept", () => {
    const question = { kind: "FIT", text: "leave them out" };
    expect(TurnQuestionV91Schema.parse(question).refinesShownList).toBeNull();
    expect(
      TurnQuestionV91Schema.parse({ ...question, refinesShownList: "yes" })
        .refinesShownList,
    ).toBeNull();
    const parsed = TurnQuestionV91Schema.parse({
      ...question,
      refinesShownList: true,
      fitReasons: true,
    });
    expect(parsed.refinesShownList).toBe(true);
    expect(parsed.fitReasons).toBe(true);
  });
});
