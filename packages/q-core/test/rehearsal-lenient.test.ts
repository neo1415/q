import { describe, expect, it } from "vitest";

import {
  CounterpartPersonaLenientSchema,
  CounterpartPersonaResultSchema,
  CounterpartPersonaStoredSchema,
  CounterpartPersonaV4LenientSchema,
  normaliseCounterpartPersonaV4,
  createDefaultPromptRegistry,
  PresenceReadingSchema,
  renderPrompt,
  DEFAULT_COMMUNICATION_PROFILE,
  type CounterpartPersonaV5Variables,
  normaliseCounterpartPersona,
  normaliseRehearsalReview,
  RehearsalReviewLenientSchema,
  RehearsalReviewResultSchema,
} from "../src/index.js";

/**
 * REHEARSE audit (live 2026-10-01): v2 persona readings were refused whole
 * for "priorities:too_big" and "style:too_big", so no rehearsal could
 * start. The model answers a lenient shape and code trims it.
 */
describe("lenient rehearsal readings", () => {
  const long = (n: number) => "word ".repeat(n).trim();

  it("keeps a persona whose lists and lines run long", () => {
    const loose = CounterpartPersonaLenientSchema.parse({
      summary: long(150),
      style: long(120),
      temperament: {
        baseline: "SKEPTICAL",
        warmsTo: Array.from({ length: 9 }, () => "clear numbers"),
        coolsOn: Array.from({ length: 9 }, () => "vague answers"),
      },
      priorities: Array.from({ length: 9 }, (_, i) => `priority ${String(i)}`),
      likelyQuestions: [{ question: "What is your churn?", why: "Retention" }],
      likelyAnswers: [],
      pushbacks: Array.from({ length: 8 }, () => "asks for proof"),
      howToWin: Array.from({ length: 8 }, () => "bring cohorts"),
      dealbreakers: Array.from({ length: 8 }, () => "no traction"),
      grounding: "SOME",
    });
    const stored = normaliseCounterpartPersona(loose);
    expect(CounterpartPersonaResultSchema.safeParse(stored).success).toBe(true);
    expect(stored.priorities).toHaveLength(6);
    expect(stored.style.length).toBeLessThanOrEqual(300);
    expect(stored.style.endsWith("…")).toBe(true);
  });

  it("keeps a review whose notes run long, one rating per dimension", () => {
    const loose = RehearsalReviewLenientSchema.parse({
      overall: long(200),
      dimensions: [
        { name: "CLARITY", rating: "STRONG", note: long(100) },
        { name: "CLARITY", rating: "SOLID", note: "again" },
        { name: "EVIDENCE", rating: "NEEDS_WORK", note: "No numbers given." },
      ],
      wentRight: [],
      wentWrong: [],
      tips: Array.from({ length: 9 }, () => "Lead with retention."),
    });
    const stored = normaliseRehearsalReview(loose);
    expect(RehearsalReviewResultSchema.safeParse(stored).success).toBe(true);
    expect(stored.dimensions.map((d) => d.name)).toEqual([
      "CLARITY",
      "EVIDENCE",
    ]);
    expect(stored.tips).toHaveLength(6);
  });

  it("is what the active persona and review prompts ask for", () => {
    const registry = createDefaultPromptRegistry();
    expect(registry.getActive("INVESTOR_PERSONA").definition.version).toBe(5);
    expect(registry.getActive("REHEARSAL_SCORE").definition.version).toBe(4);
    expect(registry.getActive("INVESTOR_TWIN_TURN").definition.version).toBe(6);
  });

  it("tells the played person who holds the leverage, and reads how forward they are", () => {
    const registry = createDefaultPromptRegistry();
    const turn = registry.getActive("INVESTOR_TWIN_TURN").definition.template;
    expect(turn).toContain("{{stance}}");
    expect(turn).toContain("you came to win this investor's money");
    expect(turn).toContain("goodbye in that emotion");
    expect(turn).not.toContain(
      "ask the investor your own questions about the fund, process and terms.",
    );
    const persona = registry.getActive("INVESTOR_PERSONA").definition.template;
    expect(persona).toContain("forwardness:");
    expect(persona).toContain("knownTraits:");
    expect(persona).toContain("\nRULES\n");
  });

  it("keeps the v4 reading's stance and traits, trimmed", () => {
    const loose = CounterpartPersonaV4LenientSchema.parse({
      summary: "A founder.",
      style: "Fast.",
      temperament: { baseline: "WARM", warmsTo: [], coolsOn: [] },
      priorities: [],
      likelyQuestions: [{ question: "How big is the fund?", why: "terms" }],
      likelyAnswers: [],
      pushbacks: [],
      howToWin: [],
      dealbreakers: [],
      grounding: "SOME",
      forwardness: "FORWARD",
      forwardnessWhy: long(200),
      knownTraits: Array.from({ length: 12 }, () => ({
        trait: "Quotes customer numbers unprompted",
        source: "CALLS",
      })),
    });
    const stored = CounterpartPersonaStoredSchema.parse(
      normaliseCounterpartPersonaV4(loose),
    );
    expect(stored.forwardness).toBe("FORWARD");
    expect(stored.knownTraits).toHaveLength(8);
    expect(stored.forwardnessWhy?.length).toBeLessThanOrEqual(300);
    // A v2 reading stored before v4 still parses.
    const {
      forwardness: _f,
      forwardnessWhy: _w,
      knownTraits: _k,
      ...v2
    } = stored;
    expect(CounterpartPersonaStoredSchema.safeParse(v2).success).toBe(true);
  });
});

describe("the persona reading names the person Q plays (live re-run 2026-10-01)", () => {
  const registry = createDefaultPromptRegistry();
  const render = (
    variables: Omit<
      CounterpartPersonaV5Variables,
      | "operatingMode"
      | "communicationProfile"
      | "communicationGuidance"
      | "environmentNotes"
    >,
  ) =>
    renderPrompt<CounterpartPersonaV5Variables>(registry, {
      task: "INVESTOR_PERSONA",
      operatingMode: "ASSESSMENT",
      communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
      environmentNotes: "test",
      variables,
    })
      .messages.map((m) => m.content)
      .join("\n");
  const base = {
    theirMessages: "(none)",
    theirWordsInCalls: "(none)",
    publicPresence: "(none)",
    pitchMaterial: "Cold rooms in Benue.",
    previousProfile: "(none)",
  };

  it("an investor rehearsing: the reading is of the founder, labelled as theirs", () => {
    const text = render({
      ...base,
      viewerRole: "INVESTOR",
      viewerOrganisation: "Chidi Angels",
      counterpartRole: "FOUNDER",
      counterpartName: "Yamfield Agro",
      counterpartProfile: "Name: Yamfield Agro",
    });
    expect(text).toContain("WHO YOU ARE READING: the FOUNDER named below.");
    expect(text.indexOf("Yamfield Agro")).toBeGreaterThan(
      text.indexOf("Their name:"),
    );
    expect(text).toContain(
      "WHO IS REHEARSING: the INVESTOR, from Chidi Angels.",
    );
    expect(text).toContain(
      "Never describe the INVESTOR, their fund or their company",
    );
    expect(text).toContain("THE FOUNDER'S PROFILE (the FOUNDER Q plays)");
    expect(text).toContain(
      "Every field below is about the FOUNDER, never the INVESTOR.",
    );
    expect(text).toContain(
      "never a reason to write about the INVESTOR instead",
    );
  });

  it("a founder rehearsing: the reading is of the investor, labelled as theirs", () => {
    const text = render({
      ...base,
      viewerRole: "FOUNDER",
      viewerOrganisation: "Nixo",
      counterpartRole: "INVESTOR",
      counterpartName: "Ventures Fund",
      counterpartProfile: "Name: Ventures Fund",
    });
    expect(text).toContain("WHO YOU ARE READING: the INVESTOR named below.");
    expect(text.indexOf("Ventures Fund")).toBeGreaterThan(
      text.indexOf("Their name:"),
    );
    expect(text).toContain("WHO IS REHEARSING: the FOUNDER, from Nixo.");
    expect(text).toContain(
      "Never describe the FOUNDER, their fund or their company",
    );
    expect(text).toContain("THE INVESTOR'S PROFILE (the INVESTOR Q plays)");
    expect(text).toContain(
      "Every field below is about the INVESTOR, never the FOUNDER.",
    );
    expect(text).toContain("never a reason to write about the FOUNDER instead");
  });
});

describe("camera guardrails in the turn prompt (founder ask 2026-10-01)", () => {
  const turn =
    createDefaultPromptRegistry().getActive("INVESTOR_TWIN_TURN").definition
      .template;

  it("comments only on meeting behaviour and setup, never on the person", () => {
    expect(turn).toContain("{{presence}}");
    expect(turn).toContain("cameraOn {{cameraOn}}");
    expect(turn).toContain("Only meeting behaviour and setup, ever");
    for (const never of [
      "appearance",
      "face",
      "body",
      "clothing",
      "age",
      "race",
      "gender",
      "disability",
      "health",
      "religion",
    ]) {
      expect(turn).toContain(never);
    }
    expect(turn).toContain("no guessing who anyone is");
    expect(turn).toContain("no reading emotions from a face");
    expect(turn).toContain('at most say "looks like you have company"');
    expect(turn).toContain("unknown stays unknown");
    expect(turn).toContain(
      "Never mention a thing the line above does not name",
    );
  });

  it("reads presence only as typed, bounded values", () => {
    expect(
      PresenceReadingSchema.safeParse({
        gaze: "AT_CAMERA",
        distracted: false,
        framing: "GOOD",
        lighting: "GOOD",
        background: "CALM",
        company: false,
        confident: true,
        mood: "nervous",
      }).success,
    ).toBe(false);
  });
});
