import { describe, expect, it } from "vitest";

import {
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  renderPrompt,
  TURN_READER_V92,
  TURN_READER_V93,
  TurnReaderV93ResultSchema,
  V91_REFINES_SHOWN_LIST,
  V92_RULES_END_BEFORE,
  V93_OTHERS_ACTIVITY,
  type TurnReaderV76Variables,
} from "../src/index.js";

/**
 * TURN_READER v93 (audit 2026-11-13 item 17, privacy): whether a turn asks
 * about other parties' interest or activity on a company is read by
 * meaning (`othersActivity`), beside the word rule that alone decided it.
 */

type Variables = Omit<
  TurnReaderV76Variables,
  | "operatingMode"
  | "communicationProfile"
  | "communicationGuidance"
  | "environmentNotes"
>;

const variables = (utterance: string): Variables => ({
  recentTurns: [
    { role: "USER", text: "Is anybody else circling Kazikit?" },
    { role: "Q", text: "I can't share other investors' interest." },
  ],
  utterance,
  modality: "VOICE",
  conversationState: "(nothing yet)",
  actions: [],
  actionGroups: "Relationships: save_company (Save a company)",
  screenControls: "(none)",
  shown: "(nothing yet)",
});

const render = (version: number, vars: Variables) =>
  renderPrompt<TurnReaderV76Variables>(createDefaultPromptRegistry(), {
    task: "TURN_READER",
    taskVersion: version,
    charter: "Q_SYSTEM",
    operatingMode: "ASSESSMENT",
    communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
    environmentNotes:
      "You classify one turn and nothing else; Capital Q decides what follows from it.",
    variables: vars,
  });

describe("TURN_READER v93", () => {
  it("is on its own schema; v92 and v93 are deprecated and kept for rollback (v94 is active)", () => {
    const registry = createDefaultPromptRegistry();
    expect(registry.getActive("TURN_READER").definition.version).toBe(94);
    const v93 = registry.get("TURN_READER", 93)?.definition;
    expect(v93?.status).toBe("DEPRECATED");
    expect(registry.get("TURN_READER", 92)?.definition.status).toBe(
      "DEPRECATED",
    );
    expect(v93?.output.kind === "STRUCTURED" && v93.output.schema).toBe(
      TurnReaderV93ResultSchema,
    );
    expect(TURN_READER_V93.variables).toEqual(TURN_READER_V92.variables);
    expect(TURN_READER_V93.rulesEndBefore).toBe(V92_RULES_END_BEFORE);
  });

  it("is v92 plus one paragraph right after REFINES THE LIST, and nothing else", () => {
    expect(TURN_READER_V93.template).toBe(
      TURN_READER_V92.template.replace(
        V91_REFINES_SHOWN_LIST,
        `${V91_REFINES_SHOWN_LIST}\n${V93_OTHERS_ACTIVITY}`,
      ),
    );
    expect(TURN_READER_V93.template.split(V93_OTHERS_ACTIVITY)).toHaveLength(2);
  });

  it("puts the paragraph in the cacheable fixed rules, never in the turn's data", () => {
    const rendered = render(93, variables("and how many of them?"));
    expect(rendered.messages.map((m) => m.role)).toEqual([
      "SYSTEM",
      "SYSTEM",
      "USER",
    ]);
    expect(rendered.messages[1]?.content).toContain(V93_OTHERS_ACTIVITY);
    expect(rendered.messages[2]?.content).not.toContain("OTHERS' ACTIVITY");
    expect(rendered.messages[2]?.content).toContain("and how many of them?");
    // The instructions are byte-identical whatever was said.
    expect(rendered.messages[1]?.content).toBe(
      render(93, variables("hi")).messages[1]?.content,
    );
    expect(rendered.bundle.task).toMatch(/\/v93$/u);
  });

  it("reads by meaning across languages, follow-ups and voice, and names its negatives", () => {
    for (const said of [
      "by meaning",
      "any language",
      "spoken or typed",
      "RECENT TURNS",
      "in diligence with",
      "passing on",
      "¿alguien más está mirando Kazikit?",
      "est-ce que d'autres fonds regardent Kazikit ?",
      "and how many of them?",
      "what's my interest in Kazikit?",
      "which investors are interested in us?",
    ]) {
      expect(V93_OTHERS_ACTIVITY).toContain(said);
    }
  });

  it("reads othersActivity leniently: absent or malformed is false, never a refused reading", () => {
    const base = {
      kind: "QUESTION_TO_Q",
      confidence: "HIGH",
      transcript: "CLEAR",
      question: null,
      aboutNamedOther: false,
    };
    expect(
      TurnReaderV93ResultSchema.parse({ ...base, othersActivity: true })
        .othersActivity,
    ).toBe(true);
    expect(TurnReaderV93ResultSchema.parse(base).othersActivity).toBe(false);
    const malformed = TurnReaderV93ResultSchema.safeParse({
      ...base,
      othersActivity: "yes",
    });
    expect(malformed.success).toBe(true);
    expect(malformed.success && malformed.data.othersActivity).toBe(false);
  });
});
