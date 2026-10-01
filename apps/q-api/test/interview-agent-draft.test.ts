import { describe, expect, it } from "vitest";

import type { PermittedContextPlan } from "@capital-q/contracts";
import type { ModelGateway } from "@capital-q/model-gateway";
import { createLogger } from "@capital-q/observability";
import type { ContextFirewallPort } from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import {
  createInterviewAgent,
  everyWriteLanded,
} from "../src/voice/interview-agent.js";

import { readerOf, reading } from "./authority-fixtures.js";
import { investorSession, turn } from "./interviewer-fixtures.js";

/**
 * HANDOVER §5.6: on the typed channel a response that only writes carries
 * its reply beside the calls; Capital Q uses that draft only when every
 * write landed, saving the second ~2 s round. Anything refused gets the
 * usual round, so no reply ever claims a write that did not happen.
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

const SAID = "Our firm is Harrow Road Capital.";
const DRAFT = JSON.stringify({
  reply: "Harrow Road Capital, noted. How do you invest?",
  asking: "I0.investor_type",
});

/** One round of calls carrying a drafted reply; a second round replies. */
function drafting(args: unknown) {
  let rounds = 0;
  const gateway = {
    execute: () => {
      rounds += 1;
      return Promise.resolve(
        rounds === 1
          ? {
              output: {
                kind: "TOOL_CALLS",
                text: DRAFT,
                calls: [
                  { callId: "c1", name: "record_answers", arguments: args },
                ],
              },
            }
          : {
              output: {
                kind: "TEXT",
                text: JSON.stringify({ reply: "Rewritten.", asking: null }),
              },
            },
      );
    },
  } as unknown as ModelGateway;
  return { gateway, rounds: () => rounds };
}

describe("a reply drafted beside its writes", () => {
  it("is used when every write landed, in one round", async () => {
    const world = investorSession({ currentStepKey: "I0.organisation_name" });
    const { gateway, rounds } = drafting({
      answers: [
        {
          stepKey: "I0.organisation_name",
          value: "Harrow Road Capital",
          quote: SAID,
        },
      ],
    });
    const outcome = await createInterviewAgent({
      gateway,
      firewall: firewall(),
      logger,
      recommendations: world.recommendations,
      delegation: readerOf(reading({ stated: ["I0.organisation_name"] })),
    }).turn({ ...turn(world, SAID), actor });

    expect(rounds()).toBe(1);
    expect(outcome.reply).toBe(
      "Harrow Road Capital, noted. How do you invest?",
    );
  });

  it("is thrown away when a write was refused, and the reply is written again", async () => {
    const world = investorSession({ currentStepKey: "I0.investor_type" });
    const { gateway, rounds } = drafting({
      answers: [
        {
          stepKey: "I0.investor_type",
          value: "zzz not an option",
          quote: SAID,
        },
      ],
    });
    const outcome = await createInterviewAgent({
      gateway,
      firewall: firewall(),
      logger,
      recommendations: world.recommendations,
      delegation: readerOf(reading({ stated: ["I0.investor_type"] })),
    }).turn({ ...turn(world, SAID), actor });

    expect(rounds()).toBe(2);
    expect(outcome.reply).toBe("Rewritten.");
  });

  it("is never used on the voice channel", async () => {
    const world = investorSession({ currentStepKey: "I0.organisation_name" });
    const { gateway, rounds } = drafting({
      answers: [
        {
          stepKey: "I0.organisation_name",
          value: "Harrow Road Capital",
          quote: SAID,
        },
      ],
    });
    await createInterviewAgent({
      gateway,
      firewall: firewall(),
      logger,
      recommendations: world.recommendations,
      delegation: readerOf(reading({ stated: ["I0.organisation_name"] })),
    }).turn({ ...turn(world, SAID), channel: "voice", actor });

    expect(rounds()).toBe(2);
  });
});

/** The draft as a write_reply call beside the write (INTERVIEW_AGENT v14). */
function replyingByCall(args: unknown, replyOnly = false) {
  let rounds = 0;
  const reply = {
    callId: "r",
    name: "write_reply",
    arguments: {
      reply: "Harrow Road Capital, noted. How do you invest?",
      asking: "I0.investor_type",
    },
  };
  const gateway = {
    execute: (request: { tools?: readonly { name: string }[] }) => {
      rounds += 1;
      offeredReply.push(
        (request.tools ?? []).some((tool) => tool.name === "write_reply"),
      );
      return Promise.resolve(
        rounds === 1
          ? {
              output: {
                kind: "TOOL_CALLS",
                text: "",
                calls: replyOnly
                  ? [reply]
                  : [
                      { callId: "c1", name: "record_answers", arguments: args },
                      reply,
                    ],
              },
            }
          : {
              output: {
                kind: "TEXT",
                text: JSON.stringify({ reply: "Rewritten.", asking: null }),
              },
            },
      );
    },
  } as unknown as ModelGateway;
  const offeredReply: boolean[] = [];
  return { gateway, rounds: () => rounds, offeredReply };
}

describe("a reply drafted as a write_reply call (v14)", () => {
  const landing = {
    answers: [
      {
        stepKey: "I0.organisation_name",
        value: "Harrow Road Capital",
        quote: SAID,
      },
    ],
  };

  it("is used beside a write that landed, in one round, and is offered on the typed channel", async () => {
    const world = investorSession({ currentStepKey: "I0.organisation_name" });
    const { gateway, rounds, offeredReply } = replyingByCall(landing);
    const outcome = await createInterviewAgent({
      gateway,
      firewall: firewall(),
      logger,
      recommendations: world.recommendations,
      delegation: readerOf(reading({ stated: ["I0.organisation_name"] })),
    }).turn({ ...turn(world, SAID), actor });
    expect(rounds()).toBe(1);
    expect(offeredReply[0]).toBe(true);
    expect(outcome.reply).toBe(
      "Harrow Road Capital, noted. How do you invest?",
    );
    expect(world.recordedValue("I0.organisation_name")).toBeDefined();
  });

  it("is thrown away beside a refused write", async () => {
    const world = investorSession({ currentStepKey: "I0.investor_type" });
    const { gateway, rounds } = replyingByCall({
      answers: [
        {
          stepKey: "I0.investor_type",
          value: "zzz not an option",
          quote: SAID,
        },
      ],
    });
    const outcome = await createInterviewAgent({
      gateway,
      firewall: firewall(),
      logger,
      recommendations: world.recommendations,
      delegation: readerOf(reading({ stated: ["I0.investor_type"] })),
    }).turn({ ...turn(world, SAID), actor });
    expect(rounds()).toBe(2);
    expect(outcome.reply).toBe("Rewritten.");
  });

  it("alone is the reply", async () => {
    const world = investorSession({ currentStepKey: "I0.organisation_name" });
    const { gateway, rounds } = replyingByCall(landing, true);
    const outcome = await createInterviewAgent({
      gateway,
      firewall: firewall(),
      logger,
      recommendations: world.recommendations,
      delegation: readerOf(reading()),
    }).turn({ ...turn(world, "Hello there."), actor });
    expect(rounds()).toBe(1);
    expect(outcome.reply).toBe(
      "Harrow Road Capital, noted. How do you invest?",
    );
  });

  it("is not offered on the voice channel", async () => {
    const world = investorSession({ currentStepKey: "I0.organisation_name" });
    const { gateway, offeredReply } = replyingByCall(landing);
    await createInterviewAgent({
      gateway,
      firewall: firewall(),
      logger,
      recommendations: world.recommendations,
      delegation: readerOf(reading({ stated: ["I0.organisation_name"] })),
    })
      .turn({ ...turn(world, SAID), channel: "voice", actor })
      .catch(() => undefined);
    expect(offeredReply[0]).toBe(false);
  });
});

describe("everyWriteLanded", () => {
  const write = (tool: string, data: unknown, ok = true) => ({
    tool,
    input: {},
    result: ok ? { ok: true, data } : { ok: false, error: { code: "X" } },
  });

  it("holds only when every action is a write whose every result landed", () => {
    expect(
      everyWriteLanded([
        write("record_answers", {
          results: [{ outcome: "COMMITTED" }, { outcome: "SET_ASIDE" }],
        }),
        write("note_preference", { outcome: "REMEMBERED" }),
      ]),
    ).toBe(true);
    expect(everyWriteLanded([])).toBe(false);
    expect(
      everyWriteLanded([
        write("record_answers", {
          results: [{ outcome: "COMMITTED" }, { outcome: "REJECTED" }],
        }),
      ]),
    ).toBe(false);
    expect(
      everyWriteLanded([write("get_onboarding_state", { steps: [] })]),
    ).toBe(false);
    expect(
      everyWriteLanded([write("confirm_and_finish", { outcome: "COMMITTED" })]),
    ).toBe(false);
    expect(everyWriteLanded([write("record_answers", {}, false)])).toBe(false);
  });
});
