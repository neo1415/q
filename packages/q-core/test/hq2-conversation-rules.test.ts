import { describe, expect, it } from "vitest";

import {
  COMPANY_ANALYST_V37,
  COMPANY_ANALYST_V38,
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  Q_SYSTEM_V2,
  Q_SYSTEM_V3,
  Q_SYSTEM_VOICE_V3,
  Q_SYSTEM_VOICE_V4,
  renderPrompt,
  SPEAK_FROM_FACTS_V2,
  SPOKEN_REPLY_V1,
  SPOKEN_REPLY_V2,
  SYNTHETIC_COMPANY_FACTS,
  V2_QUESTIONS,
  V3_QUESTIONS,
  V37_CLARIFYING,
  V37_ENDING,
  V37_RULES_END_BEFORE,
  V38_CLARIFYING,
  V38_ASK_BACK,
  V38_CAVEAT,
  V38_PLAIN_WORDS,
  V38_ENDING,
  type CompanyAnalystVariables,
} from "../src/index.js";

/**
 * HQ-2 (conversation audit §2.3): the conversation rules in new versions
 * of the analyst, the charter, the voice charter and the spoken reply. The
 * old versions are deprecated, never edited (the lock pins them).
 */
const registry = createDefaultPromptRegistry();

describe("the conversation rules (HQ-2)", () => {
  it("are active in new versions, the old ones deprecated", () => {
    for (const [id, version] of [
      ["COMPANY_ANALYST", 38],
      ["Q_SYSTEM", 3],
      ["Q_SYSTEM_VOICE", 4],
      ["SPOKEN_REPLY", 2],
    ] as const) {
      expect(registry.getActive(id).definition.version, id).toBe(version);
      expect(registry.get(id, version - 1)?.definition.status, id).toBe(
        "DEPRECATED",
      );
    }
  });

  it("one question a turn: the analyst's contradiction is resolved", () => {
    expect(COMPANY_ANALYST_V37.template).toContain(V37_CLARIFYING);
    expect(COMPANY_ANALYST_V38.template).not.toContain(V37_CLARIFYING);
    expect(COMPANY_ANALYST_V38.template).toContain(V38_CLARIFYING);
    expect(COMPANY_ANALYST_V38.template).not.toMatch(
      /at most three questions/u,
    );
    expect(Q_SYSTEM_V2.template).toContain(V2_QUESTIONS);
    expect(Q_SYSTEM_V3.template).toContain(V3_QUESTIONS);
    expect(Q_SYSTEM_V3.template).not.toContain("one or a few");
  });

  it("no automatic closing offer, in text, voice or the spoken reply", () => {
    expect(COMPANY_ANALYST_V38.template).not.toContain(V37_ENDING);
    expect(COMPANY_ANALYST_V38.template).toContain(V38_ENDING);
    expect(Q_SYSTEM_VOICE_V3.template).toContain("want the detail?");
    expect(Q_SYSTEM_VOICE_V4.template).not.toContain("want the detail?");
    expect(Q_SYSTEM_VOICE_V4.template).not.toContain("I've reached out to");
    expect(SPOKEN_REPLY_V1.template).toContain("Good one,");
    expect(SPOKEN_REPLY_V2.template).not.toContain("Good one,");
    expect(SPEAK_FROM_FACTS_V2).toContain(
      "Without next, end where the answer ends",
    );
  });

  it("reflect then ask, uncertainty by evidence class, three items aloud", () => {
    expect(COMPANY_ANALYST_V38.template).toContain(V38_ASK_BACK);
    expect(COMPANY_ANALYST_V38.template).toContain(V38_CAVEAT);
    expect(COMPANY_ANALYST_V38.template).toContain(V38_PLAIN_WORDS);
    expect(Q_SYSTEM_VOICE_V4.template).toContain("Three items at most");
    expect(Q_SYSTEM_VOICE_V4.template).toContain("say back in a clause");
    expect(Q_SYSTEM_V3.template).toContain("say what you understood");
  });

  it("the analyst's new rules sit in the shared fixed rules; schema and variables are v37's", () => {
    const at = COMPANY_ANALYST_V38.template.indexOf(V38_CAVEAT);
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(
      COMPANY_ANALYST_V38.template.indexOf(V37_RULES_END_BEFORE),
    );
    expect(COMPANY_ANALYST_V38.output).toBe(COMPANY_ANALYST_V37.output);
    expect(COMPANY_ANALYST_V38.variables).toBe(COMPANY_ANALYST_V37.variables);
    expect(COMPANY_ANALYST_V38.rulesEndBefore).toBe(V37_RULES_END_BEFORE);
    expect(COMPANY_ANALYST_V38.sharedInstructions).toBe(true);
  });

  it("keeps every shared instruction byte-identical across people and turns", () => {
    const render = (userMessage: string, turnNotes: string) =>
      renderPrompt<CompanyAnalystVariables & { readonly turnNotes: string }>(
        registry,
        {
          task: "COMPANY_ANALYST",
          operatingMode: "DEBRIEF",
          communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
          environmentNotes: `notes for ${userMessage}`,
          variables: {
            capability: "ANSWER",
            userMessage,
            conversation: [],
            authorisedFacts: [...SYNTHETIC_COMPANY_FACTS],
            subjectDescription: "the person's own company",
            turnNotes,
          },
        },
      );
    const shared = (r: ReturnType<typeof render>) =>
      r.messages
        .filter((m) => "shared" in m && m.shared === true)
        .map((m) => m.content);
    const one = render("How is revenue?", "TURN-NOTE-CANARY");
    const two = render("Who should I call?", "");
    expect(shared(one)).toHaveLength(2);
    expect(shared(one)).toEqual(shared(two));
    expect(shared(one).join("")).toContain(V38_CAVEAT);
    expect(shared(one).join("")).not.toContain("TURN-NOTE-CANARY");
  });
});
