import { describe, expect, it } from "vitest";

import {
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  renderPrompt,
  TURN_READER_V93,
  TURN_READER_V94,
  TurnReaderV94ResultSchema,
  V92_RULES_END_BEFORE,
  V93_OTHERS_ACTIVITY,
  V94_CONTACT_STATUS,
  type TurnReaderV76Variables,
  TurnReaderV95ResultSchema,
} from "../src/index.js";

/**
 * TURN_READER v94 (live 18 Nov 2026, fictional Savanna, run cce59657):
 * whether the turn asks about the person's own contact or relationship
 * with particular companies is read by meaning (`contactStatus`).
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
    {
      role: "USER",
      text: "Apart from the companies I'm already in contact with, which three match my mandate the most?",
    },
    {
      role: "Q",
      text: "Top three for your mandate: Ledgerline at 8.7; then Brancheon Works at 6.3; then Baridi at 6.2.",
    },
  ],
  utterance,
  modality: "TEXT",
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

describe("TURN_READER v94", () => {
  it("is active on its own schema; v93 is deprecated and kept for rollback", () => {
    const registry = createDefaultPromptRegistry();
    const active = registry.getActive("TURN_READER").definition;
    expect(active.version).toBe(95);
    expect(registry.get("TURN_READER", 93)?.definition.status).toBe(
      "DEPRECATED",
    );
    expect(active.output.kind === "STRUCTURED" && active.output.schema).toBe(
      TurnReaderV95ResultSchema,
    );
    expect(TURN_READER_V94.variables).toEqual(TURN_READER_V93.variables);
    expect(TURN_READER_V94.rulesEndBefore).toBe(V92_RULES_END_BEFORE);
  });

  it("is v93 plus one paragraph right after OTHERS' ACTIVITY, and nothing else", () => {
    expect(TURN_READER_V94.template).toBe(
      TURN_READER_V93.template.replace(
        V93_OTHERS_ACTIVITY,
        `${V93_OTHERS_ACTIVITY}\n${V94_CONTACT_STATUS}`,
      ),
    );
    expect(TURN_READER_V94.template.split(V94_CONTACT_STATUS)).toHaveLength(2);
  });

  it("puts the paragraph in the cacheable fixed rules, never in the turn's data", () => {
    const rendered = render(
      94,
      variables("Am I in contact with any of those?"),
    );
    expect(rendered.messages.map((m) => m.role)).toEqual([
      "SYSTEM",
      "SYSTEM",
      "USER",
    ]);
    expect(rendered.messages[1]?.content).toContain(V94_CONTACT_STATUS);
    expect(rendered.messages[2]?.content).not.toContain("CONTACT STATUS:");
    expect(rendered.messages[2]?.content).toContain(
      "Am I in contact with any of those?",
    );
    expect(rendered.messages[1]?.content).toBe(
      render(94, variables("hi")).messages[1]?.content,
    );
    expect(rendered.bundle.task).toMatch(/\/v94$/u);
  });

  it("reads by meaning across languages and follow-ups, and names its negatives", () => {
    for (const said of [
      "by meaning",
      "any language",
      "RECENT TURNS",
      "am I in contact with any of those?",
      "have I spoken to any of them?",
      "are any of these already in my pipeline?",
      "¿ya estoy en contacto con alguna de ellas?",
      "how do those compare?",
      "excludeRelationships and listConditions",
      "othersActivity",
    ]) {
      expect(V94_CONTACT_STATUS).toContain(said);
    }
  });

  it("reads contactStatus leniently: absent or malformed is false, never a refused reading", () => {
    const base = {
      kind: "QUESTION_TO_Q",
      confidence: "HIGH",
      transcript: "CLEAR",
      question: null,
      aboutNamedOther: false,
    };
    expect(
      TurnReaderV94ResultSchema.parse({ ...base, contactStatus: true })
        .contactStatus,
    ).toBe(true);
    expect(TurnReaderV94ResultSchema.parse(base).contactStatus).toBe(false);
    const malformed = TurnReaderV94ResultSchema.safeParse({
      ...base,
      contactStatus: "yes",
    });
    expect(malformed.success).toBe(true);
    expect(malformed.success && malformed.data.contactStatus).toBe(false);
  });
});
