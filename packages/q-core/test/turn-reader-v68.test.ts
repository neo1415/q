import { describe, expect, it } from "vitest";

import {
  DEFAULT_COMMUNICATION_PROFILE,
  TURN_READER_V67,
  TURN_READER_V68,
  TurnReaderV65ResultSchema,
  V68_CONTROLS_BLOCK,
  V68_CONTROLS_LISTED_BELOW,
  V68_ONLY_WHAT_APPLIES,
  createDefaultPromptRegistry,
  renderPrompt,
} from "../src/index.js";

/**
 * Coordinator 2026-10-26 (the reader's fixed cost): the reader's latency
 * tracked its output tokens (~10 ms each), ~150 of a reading's ~270 being
 * fields written at their defaults. v68 writes only what differs from the
 * defaults, read back the same, and lists the page's controls with the
 * other per-turn inputs at the end.
 */
const registry = createDefaultPromptRegistry();
const render = () =>
  renderPrompt(registry, {
    task: "TURN_READER",
    charter: "Q_SYSTEM",
    operatingMode: "ASSESSMENT",
    communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
    environmentNotes: "You classify one turn.",
    variables: {
      recentTurns: [],
      utterance: "How do the top two stack up?",
      modality: "TEXT",
      actions: [],
      actionGroups: "",
      screenControls: "tab-overview (TAB, Overview, selected)",
      shown: "",
    },
  });

describe("TURN_READER v68: only what applies is written", () => {
  it("is the active reader, v67's rules kept whole and v67 kept for rollback", () => {
    expect(registry.getActive("TURN_READER").definition.version).toBe(70);
    expect(TURN_READER_V67.status).toBe("DEPRECATED");
    expect(registry.get("TURN_READER", 67)).toBeDefined();
    // Undo the rearrangement and the one line: v67 exactly.
    const undone = TURN_READER_V68.template
      .replace(` ${V68_ONLY_WHAT_APPLIES}`, "")
      .replace(V68_CONTROLS_BLOCK, "")
      .replace(
        V68_CONTROLS_LISTED_BELOW,
        "PAGE CONTROLS: the tabs and sections of the page on their screen now, one per line as id (kind, its visible name, state), listed by Capital Q from the page itself:\n{{screenControls}}\n",
      );
    expect(undone).toBe(TURN_READER_V67.template);
  });

  it("puts every per-turn input after the rules", () => {
    const user = render().messages.at(-1)?.content ?? "";
    const controls = user.indexOf("tab-overview (TAB, Overview, selected)");
    expect(controls).toBeGreaterThan(user.length * 0.9);
    expect(user.indexOf("How do the top two stack up?")).toBeGreaterThan(
      controls,
    );
  });

  it("requires only kind, confidence and transcript of the provider", () => {
    const output = render().output;
    expect(output.kind).toBe("STRUCTURED");
    const schema = (output as { jsonSchema: { required?: string[] } })
      .jsonSchema;
    expect(schema.required).toEqual(["kind", "confidence", "transcript"]);
    expect(V68_ONLY_WHAT_APPLIES).toMatch(
      /addressedToQ false is always written/u,
    );
  });
});

/** Every field of a reading, and of its question, at its default is left out. */
function withoutDefaults(
  read: Record<string, unknown>,
): Record<string, unknown> {
  const defaults = TurnReaderV65ResultSchema.parse({
    kind: read["kind"],
    confidence: read["confidence"],
    transcript: read["transcript"],
  }) as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(read).filter(
      ([key, value]) =>
        ["kind", "confidence", "transcript"].includes(key) ||
        JSON.stringify(value) !== JSON.stringify(defaults[key]),
    ),
  );
}

/**
 * Readings of the kinds the reader eval covers: compare, ADVICE, public
 * facts, a request to act, an outward draft, an onboarding reply, and one
 * not addressed to Q.
 */
const READINGS: readonly Record<string, unknown>[] = [
  {
    kind: "QUESTION_TO_Q",
    confidence: "HIGH",
    transcript: "CLEAR",
    compare: { count: 2, names: [] },
  },
  {
    kind: "QUESTION_TO_Q",
    confidence: "HIGH",
    transcript: "CLEAR",
    question: { kind: "ADVICE", text: "What should I do next?" },
    nextSteps: true,
  },
  {
    kind: "QUESTION_TO_Q",
    confidence: "MEDIUM",
    transcript: "CLEAR",
    question: { kind: "PUBLIC_FACTS", text: "Who is the founder of Paystack?" },
  },
  {
    kind: "TOOL_REQUEST",
    confidence: "HIGH",
    transcript: "CLEAR",
    askedAction: "propose_email",
    aboutNamedOther: true,
    replyTo: { kind: "NEW" },
  },
  {
    kind: "TOOL_REQUEST",
    confidence: "HIGH",
    transcript: "CLEAR",
    appAction: {
      tool: "propose_chat_message",
      arguments: { counterpartName: "Savanna Seed Partners", body: "Soon." },
    },
  },
  {
    kind: "ANSWER",
    confidence: "HIGH",
    transcript: "CLEAR",
    replyTo: { kind: "Q_QUESTION" },
  },
  {
    kind: "QUESTION_TO_Q",
    confidence: "HIGH",
    transcript: "CLEAR",
    question: {
      kind: "DISCOVER_COMPANIES",
      text: "only verified fintechs in Kenya",
      discover: { sectors: ["fintech"], countries: ["KE"], verifiedOnly: true },
    },
    discoverWhom: "COMPANIES",
  },
  {
    kind: "OFF_TOPIC",
    confidence: "HIGH",
    transcript: "CLEAR",
    addressedToQ: false,
  },
];

describe("a reading with its defaults left out reads the same", () => {
  it.each(READINGS.map((read, index) => [index, read] as const))(
    "reading %i",
    (_index, read) => {
      const written = TurnReaderV65ResultSchema.parse(read) as Record<
        string,
        unknown
      >;
      const left = withoutDefaults(written);
      expect(Object.keys(left).length).toBeLessThan(
        Object.keys(written).length,
      );
      expect(TurnReaderV65ResultSchema.parse(left)).toEqual(written);
    },
  );

  it("never leaves out addressedToQ false", () => {
    const written = TurnReaderV65ResultSchema.parse(READINGS.at(-1)) as {
      addressedToQ: boolean;
    };
    expect(written.addressedToQ).toBe(false);
    expect(withoutDefaults(written)).toHaveProperty("addressedToQ", false);
  });
});
