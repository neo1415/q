import { describe, expect, it } from "vitest";

import type { PermittedContextPlan } from "@capital-q/contracts";
import type { ModelGateway } from "@capital-q/model-gateway";
import { createLogger } from "@capital-q/observability";
import type { ContextFirewallPort } from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import { createInterviewAgent } from "../src/voice/interview-agent.js";

import { readerOf, reading } from "./authority-fixtures.js";
import { investorSession, turn } from "./interviewer-fixtures.js";

/**
 * Free text that names no category (ACC 2026-09-25, P8: "helps smallholder
 * farmers grow more food" -> "couldn't record that as a sector category";
 * "our employer's venture arm, a big telco" -> nothing recorded). The port
 * no longer refuses: it returns the choices the step records, the model
 * picks the one that means what they said, and that is recorded by name.
 * Lexical matching stays the platform's; meaning is the model's (ADR 0011).
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
function firewall(): ContextFirewallPort {
  const plan = {
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
  } as unknown as PermittedContextPlan;
  return { plan: () => Promise.resolve({ outcome: "AUTHORISED", plan }) };
}

const AGRICULTURE = "a0000000-0000-4000-8000-0000000000a1";
const ROOTS = {
  Agriculture: AGRICULTURE,
  "Financial services": "a0000000-0000-4000-8000-0000000000a2",
  Healthcare: "a0000000-0000-4000-8000-0000000000a3",
};

/** Records `first`; then, seeing the result, records `second` (if any); then replies. */
function twoTries(
  stepKey: string,
  quote: string,
  first: string | readonly string[],
  second: string | readonly string[] | null,
) {
  const seen: string[] = [];
  let round = 0;
  const record = (value: string | readonly string[]) => ({
    output: {
      kind: "TOOL_CALLS",
      text: "",
      calls: [
        {
          callId: `c${String(round)}`,
          name: "record_answers",
          arguments: { answers: [{ stepKey, value, quote }] },
        },
      ],
    },
  });
  const gateway = {
    execute: (request: {
      readonly messages: readonly { readonly content: string }[];
    }) => {
      seen.push(request.messages.map((m) => m.content).join("\n"));
      round += 1;
      if (round === 1) return Promise.resolve(record(first));
      if (round === 2 && second !== null) {
        return Promise.resolve(record(second));
      }
      return Promise.resolve({
        output: {
          kind: "TEXT",
          text: JSON.stringify({ reply: "Noted.", asking: null }),
        },
      });
    },
  } as unknown as ModelGateway;
  return { gateway, seen };
}

function worldFor(stepKey: string) {
  return investorSession({
    currentStepKey: stepKey,
    recorded: {
      "I0.investor_type": "angel",
      "I1.deployment_status": "actively_investing",
    },
    taxonomy: { agriculture: AGRICULTURE },
    taxonomyRoots: ROOTS,
  });
}

describe("words that name no category are saved as they said them (owner 2026-10-16)", () => {
  it("saves their words at once, and a category named later supersedes them", async () => {
    const said =
      "we back companies that help smallholder farmers grow more food";
    const world = worldFor("I3.sectors");
    const { gateway, seen } = twoTries("I3.sectors", said, said, [
      "Agriculture",
    ]);
    await createInterviewAgent({
      gateway,
      firewall: firewall(),
      logger,
      recommendations: world.recommendations,
      delegation: readerOf(reading({ stated: ["I3.sectors"] })),
    }).turn({ ...turn(world, said), actor });

    const afterFirst = seen[1] ?? "";
    expect(afterFirst).toContain('"outcome":"COMMITTED"');
    expect(afterFirst).not.toContain('"outcome":"UNMATCHED"');
    expect(world.recordedValue("I3.sectors")).toEqual({
      type: "RESOURCE_REFERENCE",
      resourceType: "TAXONOMY_NODE",
      resourceIds: [AGRICULTURE],
    });
  });

  it("any phrasing without a named category is saved in their words, never refused or dropped", async () => {
    for (const said of [
      "helps smallholder farmers grow more food",
      "stuff that feeds people in rural areas",
      "tools for people who run small farms",
    ]) {
      const world = worldFor("I3.sectors");
      const { gateway, seen } = twoTries("I3.sectors", said, said, null);
      await createInterviewAgent({
        gateway,
        firewall: firewall(),
        logger,
        recommendations: world.recommendations,
        delegation: readerOf(reading({ stated: ["I3.sectors"] })),
      }).turn({ ...turn(world, said), actor });

      const after = seen[1] ?? "";
      expect(after, said).not.toContain('"outcome":"REJECTED"');
      expect(world.recordedValue("I3.sectors"), said).toEqual({
        type: "TEXT",
        text: said,
      });
    }
  });
});

describe("words that name no option are kept as 'Other: their words'", () => {
  it("a near-miss is the step's own Other with their words; a named option later supersedes it", async () => {
    const said =
      "we invest through our employer's venture arm, it's a big telco";
    const world = investorSession({ currentStepKey: "I0.investor_type" });
    const { gateway, seen } = twoTries("I0.investor_type", said, said, "cvc");
    await createInterviewAgent({
      gateway,
      firewall: firewall(),
      logger,
      recommendations: world.recommendations,
      delegation: readerOf(reading({ stated: ["I0.investor_type"] })),
    }).turn({ ...turn(world, said), actor });

    const afterFirst = seen[1] ?? "";
    expect(afterFirst).toContain('"outcome":"COMMITTED"');
    expect(world.recordedValue("I0.investor_type")).toEqual({
      type: "SINGLE_SELECT",
      optionKey: "cvc",
    });
  });

  it("their words are saved as Other, never as an option they did not name", async () => {
    for (const said of [
      "we invest through our employer's venture arm, it's a big telco",
      "a mix of my own money and a small club of friends",
    ]) {
      const world = investorSession({ currentStepKey: "I0.investor_type" });
      const { gateway } = twoTries("I0.investor_type", said, said, null);
      await createInterviewAgent({
        gateway,
        firewall: firewall(),
        logger,
        recommendations: world.recommendations,
        delegation: readerOf(reading({ stated: ["I0.investor_type"] })),
      }).turn({ ...turn(world, said), actor });
      expect(world.recordedValue("I0.investor_type"), said).toEqual({
        type: "SINGLE_SELECT",
        optionKey: "other",
      });
      expect(world.recordedNote("I0.investor_type"), said).toBe(said);
    }
  });
});
