import { describe, expect, it } from "vitest";

import {
  createFakeModelProvider,
  createInMemoryModelUsageRepository,
  createModelGateway,
  createModelProviderRegistry,
  createStaticModelCatalog,
} from "../src/index.js";
import { reasoningUnderPolicy } from "../src/policy/eligibility.js";
import {
  ANSWER_REASONING_V1,
  answerReasoning,
  answerReasoningKey,
} from "../src/q/index.js";
import { IDS, request, testCatalog } from "./fixtures.js";

/**
 * Q Intelligence step 7 (adaptive reasoning): the reader's answerKind sets
 * how hard the answer thinks, the routing policy's versioned
 * `reasoning_levels` has the last word, and the level reaches the provider
 * request. Deterministic: the fake provider, the synthetic catalog, no
 * network.
 */

const ANSWER = { capability: "ANSWER" as const };

/** The routing config the step 7 migration writes (20261231260000). */
const POLICY_LEVELS = {
  ANSWER_CHAT: "NONE",
  ANSWER_LOOKUP: "NONE",
  ANSWER_FOLLOW_UP: "LOW",
  ANSWER_COMPARISON: "MEDIUM",
  ANSWER_ANALYSIS: "MEDIUM",
  ANSWER_DOCUMENT: "MEDIUM",
} as const;

describe("the answer's reasoning level (step 7: the reader's answerKind only)", () => {
  it.each([
    ["CHAT", "NONE"],
    ["LOOKUP", "NONE"],
    ["FOLLOW_UP", "LOW"],
    ["COMPARISON", "MEDIUM"],
    ["ANALYSIS", "MEDIUM"],
    ["DOCUMENT", "MEDIUM"],
  ] as const)("answerKind %s thinks at %s", (answerKind, level) => {
    expect(answerReasoning({ ...ANSWER, answerKind })).toEqual({
      reasoning: level,
      reasoningKey: `ANSWER_${answerKind}`,
    });
  });

  it("keeps follow-ups and lookups at NONE/LOW, so they stay fast", () => {
    for (const kind of ["CHAT", "LOOKUP", "FOLLOW_UP"] as const) {
      expect(["NONE", "LOW"]).toContain(ANSWER_REASONING_V1[kind]);
    }
  });

  it("a compound ask thinks at its heaviest part", () => {
    expect(
      answerReasoning({
        ...ANSWER,
        answerKind: "LOOKUP",
        askParts: [
          { ask: "What's Silo Credit's runway?", kind: "LOOKUP" },
          { ask: "How does it compare with Ledgerfold's?", kind: "COMPARISON" },
        ],
      }),
    ).toEqual({ reasoning: "MEDIUM", reasoningKey: "ANSWER_COMPARISON" });
    // A tie in level is broken by a fixed order, so the key is stable.
    expect(
      answerReasoning({
        ...ANSWER,
        answerKind: "DOCUMENT",
        askParts: [
          { ask: "Draft the memo", kind: "DOCUMENT" },
          { ask: "and assess the risks", kind: "ANALYSIS" },
        ],
      }).reasoningKey,
    ).toBe("ANSWER_ANALYSIS");
  });

  it("no reading (FAKE or scripted mode, a failed reader) is NONE with no key", () => {
    expect(answerReasoning(ANSWER)).toEqual({ reasoning: "NONE" });
    // An unknown kind is no kind; nothing reads their words.
    expect(answerReasoning({ ...ANSWER, answerKind: "DEEP_THOUGHT" })).toEqual({
      reasoning: "NONE",
    });
    expect(answerReasoning.length).toBe(1);
  });

  it("another capability keeps the gateway's default", () => {
    expect(
      answerReasoning({ capability: "INVESTIGATE", answerKind: "ANALYSIS" }),
    ).toEqual({ reasoning: "NONE" });
  });

  it("every key is a valid routing-policy key", () => {
    for (const kind of Object.keys(ANSWER_REASONING_V1) as Array<
      keyof typeof ANSWER_REASONING_V1
    >) {
      expect(answerReasoningKey(kind)).toMatch(/^[A-Z][A-Z0-9_]{0,47}$/);
    }
  });
});

describe("the routing policy has the last word on the level", () => {
  it("uses the policy's level for the named kind", () => {
    const policy = { reasoningLevels: { ANSWER_COMPARISON: "HIGH" as const } };
    expect(
      reasoningUnderPolicy(policy, {
        reasoning: "MEDIUM",
        reasoningKey: "ANSWER_COMPARISON",
      }),
    ).toBe("HIGH");
  });

  it("keeps the request's level with no key, no map, or a key the map lacks", () => {
    const policy = { reasoningLevels: { ANSWER_COMPARISON: "HIGH" as const } };
    expect(reasoningUnderPolicy(policy, { reasoning: "LOW" })).toBe("LOW");
    expect(
      reasoningUnderPolicy(
        { reasoningLevels: null },
        { reasoning: "LOW", reasoningKey: "ANSWER_COMPARISON" },
      ),
    ).toBe("LOW");
    expect(
      reasoningUnderPolicy({}, { reasoning: "MEDIUM", reasoningKey: "X" }),
    ).toBe("MEDIUM");
    expect(
      reasoningUnderPolicy(policy, {
        reasoning: "NONE",
        reasoningKey: "ANSWER_FOLLOW_UP",
      }),
    ).toBe("NONE");
    // An inherited property is not a configured level.
    expect(
      reasoningUnderPolicy(policy, {
        reasoning: "NONE",
        reasoningKey: "CONSTRUCTOR",
      }),
    ).toBe("NONE");
  });
});

describe("the level reaches the provider request", () => {
  function build(options: {
    readonly supportsReasoning: boolean;
    readonly levels: Readonly<
      Record<string, "NONE" | "LOW" | "MEDIUM" | "HIGH">
    > | null;
  }) {
    const snapshot = testCatalog();
    const catalog = {
      ...snapshot,
      models: snapshot.models.map((model) =>
        model.id === IDS.alphaStandard
          ? { ...model, supportsReasoning: options.supportsReasoning }
          : model,
      ),
      routingPolicies: snapshot.routingPolicies.map((policy) =>
        policy.code === "normal_dialogue.v1"
          ? { ...policy, reasoningLevels: options.levels }
          : policy,
      ),
    };
    const alpha = createFakeModelProvider({
      code: "alpha",
      script: [{ kind: "TEXT", text: "alpha says hello" }],
    });
    const beta = createFakeModelProvider({
      code: "beta",
      script: [{ kind: "TEXT", text: "beta says hello" }],
    });
    const gateway = createModelGateway({
      catalog: createStaticModelCatalog(catalog),
      registry: createModelProviderRegistry([alpha, beta]),
      usage: createInMemoryModelUsageRepository(),
      sleep: () => Promise.resolve(),
      random: () => 0.5,
    });
    return { gateway, alpha };
  }

  it.each([
    ["CHAT", "NONE"],
    ["LOOKUP", "NONE"],
    ["FOLLOW_UP", "LOW"],
    ["COMPARISON", "MEDIUM"],
    ["ANALYSIS", "MEDIUM"],
    ["DOCUMENT", "MEDIUM"],
  ] as const)(
    "an answer read as %s asks the provider for %s (code default, no policy map)",
    async (answerKind, level) => {
      const { gateway, alpha } = build({
        supportsReasoning: true,
        levels: null,
      });
      await gateway.execute(
        request({
          taskClass: "NORMAL_DIALOGUE",
          ...answerReasoning({ ...ANSWER, answerKind }),
        }),
      );
      expect(alpha.calls.at(-1)?.request.reasoning).toBe(level);
    },
  );

  it("the policy's map decides when present", async () => {
    const { gateway, alpha } = build({
      supportsReasoning: true,
      levels: { ...POLICY_LEVELS, ANSWER_FOLLOW_UP: "NONE" },
    });
    await gateway.execute(
      request({
        taskClass: "NORMAL_DIALOGUE",
        ...answerReasoning({ ...ANSWER, answerKind: "FOLLOW_UP" }),
      }),
    );
    expect(alpha.calls.at(-1)?.request.reasoning).toBe("NONE");
    await gateway.execute(
      request({
        taskClass: "NORMAL_DIALOGUE",
        ...answerReasoning({ ...ANSWER, answerKind: "COMPARISON" }),
      }),
    );
    expect(alpha.calls.at(-1)?.request.reasoning).toBe("MEDIUM");
  });

  it("a model the catalogue does not mark as reasoning is asked for none", async () => {
    const { gateway, alpha } = build({
      supportsReasoning: false,
      levels: POLICY_LEVELS,
    });
    await gateway.execute(
      request({
        taskClass: "NORMAL_DIALOGUE",
        ...answerReasoning({ ...ANSWER, answerKind: "ANALYSIS" }),
      }),
    );
    expect(alpha.calls.at(-1)?.request.reasoning).toBe("NONE");
  });
});
