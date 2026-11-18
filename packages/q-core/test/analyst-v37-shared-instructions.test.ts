import { describe, expect, it } from "vitest";

import { Q_COMMUNICATION_PROFILES } from "@capital-q/contracts";

import {
  COMPANY_ANALYST_V36,
  COMPANY_ANALYST_V37,
  createDefaultPromptRegistry,
  createPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  PROMPT_DEFINITIONS,
  renderPrompt,
  SYNTHETIC_COMPANY_FACTS,
  type CompanyAnalystVariables,
  type PromptDefinition,
} from "../src/index.js";

/**
 * Model spend, 18 Nov 2026 (ai_ops.model_usage, 7 days): 73% of first
 * answer calls read nothing from the provider's prompt cache. v37 keeps
 * v36's words and moves its fixed parts: the charter's fixed head and the
 * task's fixed rules lead, marked shared; the charter's per-person tail
 * (operating mode, communication profile, environment) follows them; the
 * turn's data stays the fenced user message.
 */

const registry = createDefaultPromptRegistry();

/** A person's private context and words: must never reach a shared part. */
const PRIVATE = "PRIVATE-CANARY-7f3e9";

function render(
  options: {
    readonly version?: number;
    readonly environmentNotes?: string;
    readonly profile?: typeof DEFAULT_COMMUNICATION_PROFILE;
    readonly operatingMode?: "DEBRIEF" | "INVESTOR";
    readonly userMessage?: string;
    readonly subjectDescription?: string;
  } = {},
) {
  return renderPrompt<CompanyAnalystVariables>(registry, {
    task: "COMPANY_ANALYST",
    taskVersion: options.version,
    operatingMode: options.operatingMode ?? "DEBRIEF",
    communicationProfile: options.profile ?? DEFAULT_COMMUNICATION_PROFILE,
    environmentNotes: options.environmentNotes ?? "test environment",
    variables: {
      capability: "ANSWER",
      userMessage: options.userMessage ?? "What's our current raise target?",
      conversation: [],
      authorisedFacts: [...SYNTHETIC_COMPANY_FACTS],
      subjectDescription:
        options.subjectDescription ?? "the person's own company",
    },
  });
}

describe("COMPANY_ANALYST v37: shared instructions first", () => {
  it("is active, on v36's template, schema and variables, with v36 deprecated", () => {
    expect(registry.getActive("COMPANY_ANALYST").definition.version).toBe(37);
    expect(registry.get("COMPANY_ANALYST", 36)?.definition.status).toBe(
      "DEPRECATED",
    );
    expect(COMPANY_ANALYST_V37.template).toBe(COMPANY_ANALYST_V36.template);
    expect(COMPANY_ANALYST_V37.output).toBe(COMPANY_ANALYST_V36.output);
    expect(COMPANY_ANALYST_V37.variables).toBe(COMPANY_ANALYST_V36.variables);
  });

  it("sends v36's words, only reordered: shared head, shared rules, private tail, the turn", () => {
    const v36 = render({ version: 36 });
    const v37 = render();
    expect(v37.messages.map((m) => [m.role, "shared" in m])).toEqual([
      ["SYSTEM", true],
      ["SYSTEM", true],
      ["SYSTEM", false],
      ["USER", false],
    ]);
    const [head, rules, tail, user] = v37.messages.map((m) => m.content);
    const [v36System, v36User] = v36.messages.map((m) => m.content);
    expect(head).toContain("You are Q");
    expect(tail?.startsWith("OPERATING MODE: DEBRIEF")).toBe(true);
    expect(`${head ?? ""}\n\n${tail ?? ""}`).toBe(v36System);
    expect(`${rules ?? ""}\n\n${user ?? ""}`).toBe(v36User);
    expect(user?.startsWith("THIS TURN\nCapability requested:")).toBe(true);
  });

  it("keeps the shared parts byte-identical across people, modes and turns, with nothing private in them", () => {
    const one = render();
    const two = render({
      environmentNotes: `WHO YOU ARE WITH THIS PERSON: ${PRIVATE}`,
      profile: Q_COMMUNICATION_PROFILES.DIRECT,
      operatingMode: "INVESTOR",
      userMessage: `Tell me about ${PRIVATE}`,
      subjectDescription: `${PRIVATE} Ltd`,
    });
    const shared = (r: typeof one) =>
      r.messages.filter((m) => "shared" in m && m.shared === true);
    expect(JSON.stringify(shared(two))).toBe(JSON.stringify(shared(one)));
    expect(JSON.stringify(shared(two))).not.toContain(PRIVATE);
    expect(JSON.stringify(shared(two))).not.toContain("{{");
    // The private context is still sent, after the shared part.
    expect(two.messages[2]?.content).toContain(PRIVATE);
    expect(two.messages[2]?.content).toContain("OPERATING MODE: INVESTOR");
  });

  it("is refused without a rules boundary", () => {
    const broken: PromptDefinition<unknown, unknown> = {
      ...(COMPANY_ANALYST_V37 as unknown as PromptDefinition<unknown, unknown>),
      version: 99,
      status: "DEPRECATED",
      rulesEndBefore: undefined,
    };
    expect(() =>
      createPromptRegistry([
        ...PROMPT_DEFINITIONS.filter(
          (d) => !(d.id === "COMPANY_ANALYST" && d.version === 99),
        ),
        broken,
      ]),
    ).toThrow(/shares its instructions but declares no rulesEndBefore/);
  });
});
