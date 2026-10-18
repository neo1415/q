import { describe, expect, it } from "vitest";

import type { PermittedContextPlan } from "@capital-q/contracts";
import type { ModelGateway } from "@capital-q/model-gateway";
import { createLogger } from "@capital-q/observability";
import type { ContextFirewallPort } from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import {
  createInMemoryRaisedChecks,
  createInterviewAgent,
} from "../src/voice/interview-agent.js";

import { readerOf, reading } from "./authority-fixtures.js";
import { investorSession, turn } from "./interviewer-fixtures.js";

/**
 * Consistency checks in the loop (founder live test, 2026-09-25: "angel,
 * pre-seed, €50,000–€100 million, typical €3 million" passed without a
 * word). Code finds them and hands them to Q in the state as facts; Q
 * raises each once; the person's decision settles it; nothing is
 * corrected by anyone but them.
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

const FOUNDER_EXAMPLE = {
  "I0.investor_type": "angel",
  "I1.deployment_status": "actively_investing",
  "I2.stages": "pre_seed",
  "I2.currency": "eur",
  "I2.cheque_min": "50000",
  "I2.cheque_max": "100000000",
  "I2.cheque_typical": "3000000",
};

type Step =
  | { readonly calls: readonly { name: string; arguments: unknown }[] }
  | { readonly reply: string; readonly raised?: readonly string[] };

function scripted(script: readonly Step[]) {
  const seen: string[] = [];
  let index = 0;
  const gateway = {
    execute: (request: {
      readonly messages: readonly { readonly content: string }[];
    }) => {
      seen.push(request.messages.map((m) => m.content).join("\n"));
      const step = script[Math.min(index, script.length - 1)];
      index += 1;
      if (step !== undefined && "calls" in step) {
        return Promise.resolve({
          output: {
            kind: "TOOL_CALLS",
            text: "",
            calls: step.calls.map((c, i) => ({
              callId: `c${String(index)}_${String(i)}`,
              name: c.name,
              arguments: c.arguments,
            })),
          },
        });
      }
      return Promise.resolve({
        output: {
          kind: "TEXT",
          text: JSON.stringify({
            reply: step?.reply ?? "",
            asking: null,
            raised: step !== undefined && "raised" in step ? step.raised : [],
          }),
        },
      });
    },
  } as unknown as ModelGateway;
  return { gateway, seen };
}

/** The checks listed in a rendered prompt's state. */
function checksIn(prompt: string): { checkId: string; raised: boolean }[] {
  const start = prompt.indexOf('"checks":[');
  if (start === -1) return [];
  const from = start + '"checks":'.length;
  let depth = 0;
  for (let i = from; i < prompt.length; i += 1) {
    if (prompt[i] === "[") depth += 1;
    if (prompt[i] === "]") depth -= 1;
    if (depth === 0) {
      return JSON.parse(prompt.slice(from, i + 1)) as {
        checkId: string;
        raised: boolean;
      }[];
    }
  }
  return [];
}

describe("consistency checks reach Q as facts, and are raised once", () => {
  it("lists the checks, remembers the ones Q raised, and never lists them as unraised again", async () => {
    const world = investorSession({
      currentStepKey: "I9.discovery_mode",
      recorded: FOUNDER_EXAMPLE,
    });
    const raised = createInMemoryRaisedChecks();

    const first = scripted([{ reply: "placeholder" }]);
    await createInterviewAgent({
      gateway: first.gateway,
      firewall: firewall(),
      logger,
      recommendations: world.recommendations,
      raisedChecks: raised,
    }).turn({ ...turn(world, "Balanced, I think."), actor });
    const listed = checksIn(first.seen[0] ?? "");
    expect(listed.map((c) => c.checkId.split(":")[0]).sort()).toEqual([
      "ANGEL_CHEQUE",
      "RANGE_SPAN",
      "STAGE_CHEQUE",
    ]);
    expect(listed.every((c) => !c.raised)).toBe(true);

    // Q raises two of them, and claims one that does not exist.
    const ids = listed.map((c) => c.checkId);
    const second = scripted([
      {
        reply: "Before we go on: a €3 million typical cheque at pre-seed?",
        raised: [ids[0] ?? "", ids[1] ?? "", "INVENTED:1"],
      },
    ]);
    await createInterviewAgent({
      gateway: second.gateway,
      firewall: firewall(),
      logger,
      recommendations: world.recommendations,
      raisedChecks: raised,
    }).turn({ ...turn(world, "Balanced."), actor });

    const third = scripted([{ reply: "Noted." }]);
    await createInterviewAgent({
      gateway: third.gateway,
      firewall: firewall(),
      logger,
      recommendations: world.recommendations,
      raisedChecks: raised,
    }).turn({ ...turn(world, "Qualified founders can reach me."), actor });
    const after = checksIn(third.seen[0] ?? "");
    expect(
      after
        .filter((c) => c.raised)
        .map((c) => c.checkId)
        .sort(),
    ).toEqual([ids[0] ?? "", ids[1] ?? ""].sort());
    // Only checks that exist are remembered.
    expect([...raised.get(turn(world, "").onboardingSessionId)]).not.toContain(
      "INVENTED:1",
    );
  });

  it("confirm_as_stated settles a check on their word, unchanged; without it, nothing changes", async () => {
    for (const stated of [["I2.cheque_typical"], []] as const) {
      const world = investorSession({
        currentStepKey: "I9.discovery_mode",
        recorded: FOUNDER_EXAMPLE,
      });
      const probe = scripted([{ reply: "x" }]);
      await createInterviewAgent({
        gateway: probe.gateway,
        firewall: firewall(),
        logger,
        recommendations: world.recommendations,
      }).turn({ ...turn(world, "Balanced."), actor });
      const angel =
        checksIn(probe.seen[0] ?? "").find((c) =>
          c.checkId.startsWith("ANGEL_CHEQUE"),
        )?.checkId ?? "";

      const said = "Yes, three million is right, I write big cheques.";
      const settle = scripted([
        {
          calls: [
            {
              name: "confirm_as_stated",
              arguments: { checkId: angel, quote: said },
            },
          ],
        },
        { reply: "Understood, it stays as it is." },
      ]);
      await createInterviewAgent({
        gateway: settle.gateway,
        firewall: firewall(),
        logger,
        recommendations: world.recommendations,
        delegation: readerOf(reading({ stated })),
      }).turn({ ...turn(world, said), actor });

      // The value is never changed by settling.
      expect(world.recordedValue("I2.cheque_typical")).toEqual({
        type: "RANGE",
        value: "3000000",
      });
      const again = scripted([{ reply: "x" }]);
      await createInterviewAgent({
        gateway: again.gateway,
        firewall: firewall(),
        logger,
        recommendations: world.recommendations,
      }).turn({ ...turn(world, "Qualified."), actor });
      const stillOpen = checksIn(again.seen[0] ?? "").some(
        (c) => c.checkId === angel,
      );
      expect(stillOpen, JSON.stringify(stated)).toBe(stated.length === 0);
    }
  });

  it("a consistent record carries no checks", async () => {
    const world = investorSession({
      currentStepKey: "I9.discovery_mode",
      recorded: {
        ...FOUNDER_EXAMPLE,
        "I2.cheque_max": "100000",
        "I2.cheque_typical": "75000",
      },
    });
    const probe = scripted([{ reply: "x" }]);
    await createInterviewAgent({
      gateway: probe.gateway,
      firewall: firewall(),
      logger,
      recommendations: world.recommendations,
    }).turn({ ...turn(world, "Balanced."), actor });
    expect(checksIn(probe.seen[0] ?? "")).toEqual([]);
  });
});
