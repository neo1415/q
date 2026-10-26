import { describe, expect, it } from "vitest";

import type { PermittedContextPlan } from "@capital-q/contracts";
import type { ModelGateway } from "@capital-q/model-gateway";
import { createLogger } from "@capital-q/observability";
import type { ContextFirewallPort } from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import { createInterviewAgent } from "../src/voice/interview-agent.js";
import { withoutUnbackedCategoryClaims } from "../src/voice/onboarding-flow.js";

import { readerOf, reading } from "./authority-fixtures.js";
import { investorSession, turn } from "./interviewer-fixtures.js";

/**
 * QA F-137 (re-score 26 Oct, Harmattan): "We never invest in crypto or
 * gambling." saved Gambling & Betting only ("crypto" matched no category
 * and the quote left it out), and Q said "The exclusions are now saved as
 * sectors to exclude outright: crypto and gambling". Their words are never
 * dropped, and never claimed as a category they did not match.
 */

const logger = createLogger(
  { serviceName: "q-api-test", environment: "test" },
  { level: "silent" },
);
const actor = ActorContextSchema.parse({
  userId: "b0000000-0000-4000-8000-000000000001",
  tenantId: "c0000000-0000-4000-8000-000000000001",
  actorType: "HUMAN",
});
const firewall: ContextFirewallPort = {
  plan: () =>
    Promise.resolve({
      outcome: "AUTHORISED",
      plan: {
        tenantId: actor.tenantId,
        actor: { userId: actor.userId },
        purpose: { capability: "ANSWER", taskClass: "GENERAL_QUESTION" },
        subjects: [],
        scopes: [
          {
            kind: "OWN_ONBOARDING",
            filter: { tenantId: actor.tenantId, userId: actor.userId },
            sensitivity: "CONFIDENTIAL",
          },
        ],
        maxSensitivity: "CONFIDENTIAL",
      } as unknown as PermittedContextPlan,
    }),
} as unknown as ContextFirewallPort;

const GAMBLING = "a1000000-0000-4000-8000-000000000001";
const CLAIM =
  "The exclusions are now saved as sectors to exclude outright: crypto and gambling. Are you deploying capital right now?";

describe("unmatched words are kept, never claimed as a category (QA F-137)", () => {
  it("keeps 'crypto' beside Gambling, and the reply does not call it excluded", async () => {
    const world = investorSession({
      journey: "investor",
      currentStepKey: "I7.sector_exclusions",
      recorded: { "I0.organisation_name": "Harmattan Ventures" },
      taxonomy: { gambling: GAMBLING },
    });
    let round = 0;
    const agent = createInterviewAgent({
      gateway: {
        execute: () => {
          round += 1;
          return Promise.resolve(
            round === 1
              ? {
                  output: {
                    kind: "TOOL_CALLS",
                    text: "",
                    calls: [
                      {
                        callId: "call_1",
                        name: "record_answers",
                        arguments: {
                          answers: [
                            {
                              stepKey: "I7.sector_exclusions",
                              value: ["crypto", "gambling"],
                              // The model's quote left "crypto" out.
                              quote: "gambling",
                            },
                          ],
                        },
                      },
                    ],
                  },
                }
              : {
                  output: {
                    kind: "TEXT",
                    text: JSON.stringify({ reply: CLAIM, asking: null }),
                  },
                },
          );
        },
      } as unknown as ModelGateway,
      firewall,
      logger,
      delegation: readerOf(reading({ stated: ["I7.sector_exclusions"] })),
    });
    const outcome = await agent.turn({
      ...turn(world, "We never invest in crypto or gambling."),
      actor,
    });
    expect(world.recordedValue("I7.sector_exclusions")).toEqual({
      type: "RESOURCE_REFERENCE",
      resourceType: "TAXONOMY_NODE",
      resourceIds: [GAMBLING],
    });
    expect(world.recordedNote("I7.sector_exclusions")).toBe("crypto");
    expect(outcome.reply).not.toMatch(/exclude outright: crypto/u);
  });
});

describe("withoutUnbackedCategoryClaims", () => {
  it("takes out a claim that their unmatched words were excluded", () => {
    expect(
      withoutUnbackedCategoryClaims(
        "Gambling is excluded. The exclusions are now saved: crypto and gambling. What next?",
        ["crypto"],
      ),
    ).toBe("Gambling is excluded. What next?");
  });
  it("keeps a sentence saying they did not match, and anything asked", () => {
    const honest =
      "I couldn't match crypto to a category, so it's kept as you said it. Is crypto excluded for you?";
    expect(withoutUnbackedCategoryClaims(honest, ["crypto"])).toBe(honest);
  });
});
