import { describe, expect, it } from "vitest";

import {
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  renderPrompt,
  TURN_READER_V96,
  TURN_READER_V97,
  TurnReaderV96ResultSchema,
} from "../src/index.js";

/**
 * HQ-8 (conversation audit slice 8): TURN_READER v97 keeps v96's words and
 * schema, and sends its fixed text first, byte-identical for every person
 * and turn, so the provider's prompt cache covers it.
 */

/** The reader's budget: its words may not grow past this unnoticed. */
const READER_TEMPLATE_MAX_BYTES = 75_000;
const READER_RULES_MAX_BYTES = 73_500;

const render = (input: {
  readonly environmentNotes: string;
  readonly utterance: string;
  readonly actionGroups: string;
  readonly modality?: "TEXT" | "VOICE";
}) =>
  renderPrompt(createDefaultPromptRegistry(), {
    task: "TURN_READER",
    charter: "Q_SYSTEM",
    operatingMode: "ASSESSMENT",
    communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
    environmentNotes: input.environmentNotes,
    variables: {
      recentTurns: [{ role: "USER", text: input.utterance }],
      utterance: input.utterance,
      modality: input.modality ?? "TEXT",
      actions: [],
      actionGroups: input.actionGroups,
    },
  });

describe("TURN_READER v97 (HQ-8)", () => {
  const registry = createDefaultPromptRegistry();

  it("is active, with v96 deprecated and kept, and the same words and schema", () => {
    const active = registry.getActive("TURN_READER").definition;
    expect(active.version).toBe(97);
    expect(registry.get("TURN_READER", 96)?.definition.status).toBe(
      "DEPRECATED",
    );
    expect(TURN_READER_V97.template).toBe(TURN_READER_V96.template);
    expect(TURN_READER_V97.rulesEndBefore).toBe(TURN_READER_V96.rulesEndBefore);
    expect(active.output.kind === "STRUCTURED" && active.output.schema).toBe(
      TurnReaderV96ResultSchema,
    );
    expect(TURN_READER_V97.sharedInstructions).toBe(true);
  });

  it("stays inside its byte budget", () => {
    const template = TURN_READER_V97.template;
    const rules = template.slice(
      0,
      template.indexOf(TURN_READER_V97.rulesEndBefore ?? ""),
    );
    expect(Buffer.byteLength(template)).toBeLessThanOrEqual(
      READER_TEMPLATE_MAX_BYTES,
    );
    expect(Buffer.byteLength(rules)).toBeLessThanOrEqual(
      READER_RULES_MAX_BYTES,
    );
  });

  it("leads with the same shared prefix for every person, turn and modality", () => {
    const one = render({
      environmentNotes:
        "Asker: Zxqv Personone, an investor. Now: Friday 09:12.",
      utterance: "Who is Silo Credit's CFO?",
      actionGroups: "Records: open_page (open a page)",
    });
    const two = render({
      environmentNotes: "Asker: a founder in London. Now: Monday 17:40.",
      utterance: "Show me fintech companies in Kenya",
      actionGroups: "Relationships: request_intro (ask for an introduction)",
      modality: "VOICE",
    });
    const shared = (rendered: typeof one) =>
      rendered.messages.filter((m) => m.role === "SYSTEM" && m.shared === true);
    expect(shared(one).length).toBe(2);
    expect(shared(one).map((m) => m.content)).toEqual(
      shared(two).map((m) => m.content),
    );
    // The shared messages lead, and none holds anything of the person.
    expect(
      one.messages
        .slice(0, 2)
        .every(
          (m) => m.role === "SYSTEM" && "shared" in m && m.shared === true,
        ),
    ).toBe(true);
    const prefix = shared(one)
      .map((m) => m.content)
      .join("\n");
    for (const personal of [
      "Zxqv",
      "Silo Credit's CFO",
      "open_page (open",
      "Friday 09:12",
    ]) {
      expect(prefix).not.toContain(personal);
    }
    // The rules are the bulk of the shared prefix.
    expect(Buffer.byteLength(prefix)).toBeGreaterThan(70_000);
    // What differs follows: the charter's tail, then the turn.
    expect(one.messages.at(-1)?.role).toBe("USER");
    expect(one.messages.at(-1)?.content).toContain("Who is Silo Credit's CFO?");
  });

  it("sends exactly v96's text, only regrouped", () => {
    const input = {
      environmentNotes: "Asker: an investor. Now: Friday.",
      utterance: "and her CFO?",
      actionGroups: "Records: open_page (open a page)",
    };
    const v97 = render(input);
    const words = (rendered: typeof v97) =>
      rendered.messages
        .map((m) => m.content)
        .join("")
        .replace(/\s+/gu, "");
    // v96 rendered the same input as charter, rules, turn.
    const v96 = renderPrompt(registry, {
      task: "TURN_READER",
      taskVersion: 96,
      charter: "Q_SYSTEM",
      operatingMode: "ASSESSMENT",
      communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
      environmentNotes: input.environmentNotes,
      variables: {
        recentTurns: [{ role: "USER", text: input.utterance }],
        utterance: input.utterance,
        modality: "TEXT",
        actions: [],
        actionGroups: input.actionGroups,
      },
    });
    expect(words(v97).length).toBe(words(v96).length);
    const [head, rules, tail, turn] = v97.messages.map((m) =>
      m.content.replace(/\s+/gu, ""),
    );
    const [charter, rulesBefore, turnBefore] = v96.messages.map((m) =>
      m.content.replace(/\s+/gu, ""),
    );
    // The charter is the same text, split at its first per-person line.
    expect(`${head ?? ""}${tail ?? ""}`).toBe(charter);
    expect(rules).toBe(rulesBefore);
    expect(turn).toBe(turnBefore);
  });
});
