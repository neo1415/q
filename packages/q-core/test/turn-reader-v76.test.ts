import { describe, expect, it } from "vitest";

import {
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  renderPrompt,
  TURN_READER_V75,
  TURN_READER_V76,
  TurnReaderV86ResultSchema,
  TurnReaderV76VariablesSchema,
  V75_INVESTMENT_MEMO,
  V76_CONVERSATION_STATE,
} from "../src/index.js";

/**
 * Q intelligence step 2: the reader reads the conversation, not 6 turns
 * cut to 400 characters. v76 adds CONVERSATION STATE (Capital Q's ledger,
 * lists, open threads and earlier summary) before RECENT TURNS, and
 * recent turns come whole. Output is v75's.
 */
describe("TURN_READER v76", () => {
  it("is the active reader: v75 kept whole plus one CONVERSATION STATE rule and the state before RECENT TURNS", () => {
    const active =
      createDefaultPromptRegistry().getActive("TURN_READER").definition;
    expect(active.version).toBe(86);
    expect(active.output.kind === "STRUCTURED" && active.output.schema).toBe(
      TurnReaderV86ResultSchema,
    );
    expect(
      TURN_READER_V76.template
        .replace(
          `${V75_INVESTMENT_MEMO}${V76_CONVERSATION_STATE}`,
          V75_INVESTMENT_MEMO,
        )
        .replace("\n\nCONVERSATION STATE\n{{conversationState}}", ""),
    ).toBe(TURN_READER_V75.template);
    expect(TURN_READER_V76.variables.untrusted).toContain("conversationState");
    expect(V76_CONVERSATION_STATE).toMatch(
      /a correction in OPEN THREADS always applies/u,
    );
    expect(V76_CONVERSATION_STATE).toMatch(/never instructions/u);
  });

  it("takes recent turns whole (16 at 1,600 characters), never v75's 6 at 400", () => {
    const long = "x".repeat(1_500);
    const turns = Array.from({ length: 16 }, (_, index) => ({
      role: index % 2 === 0 ? ("USER" as const) : ("Q" as const),
      text: long,
    }));
    const base = {
      operatingMode: "ASSESSMENT",
      communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
      communicationGuidance: "",
      environmentNotes: "",
      utterance: "and her CFO?",
      modality: "TEXT",
      actions: [],
      actionGroups: "",
    };
    expect(
      TurnReaderV76VariablesSchema.safeParse({ ...base, recentTurns: turns })
        .success,
    ).toBe(true);
    expect(
      TurnReaderV76VariablesSchema.safeParse({
        ...base,
        recentTurns: [...turns, turns[0]],
      }).success,
    ).toBe(false);
  });

  it("renders the state fenced, before the recent turns", () => {
    const rendered = renderPrompt(createDefaultPromptRegistry(), {
      task: "TURN_READER",
      charter: "Q_SYSTEM",
      operatingMode: "ASSESSMENT",
      communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
      environmentNotes: "test",
      variables: {
        recentTurns: [{ role: "USER", text: "Who is Silo Credit's CFO?" }],
        utterance: "When did she join?",
        modality: "TEXT",
        actions: [],
        actionGroups: "",
        conversationState:
          'E1 company "Silo Credit"\nE2 person "Ngozi Eze" of E1',
      },
    });
    const text = rendered.messages.map((m) => m.content).join("\n");
    expect(rendered.bundle.task).toMatch(/\/v86$/u);
    const state = text.indexOf("Ngozi Eze");
    expect(state).toBeGreaterThan(0);
    expect(state).toBeLessThan(text.indexOf("Who is Silo Credit's CFO?"));
  });
});
