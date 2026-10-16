import { describe, expect, it } from "vitest";

import type { PermittedContextPlan } from "@capital-q/contracts";
import type { ModelGateway } from "@capital-q/model-gateway";
import { createLogger } from "@capital-q/observability";
import type { ContextFirewallPort } from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import { createInterviewAgent } from "../src/voice/interview-agent.js";
import { SPOKEN_QUESTIONS } from "../src/voice/step-copy.js";

import { investorSession, turn } from "./interviewer-fixtures.js";

/**
 * Proactive onboarding (owner requirement 2026-10-16): Q speaks first, by
 * first name, with what it knows, asks the top coverage question, and no
 * non-final turn ends without a question. Deterministic fakes.
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
};

/** A model that replies with these words and records what it was told. */
function saying(reply: string) {
  const seen: string[] = [];
  const gateway = {
    execute: (request: {
      readonly messages: readonly { readonly content: string }[];
    }) => {
      seen.push(request.messages.map((m) => m.content).join("\n"));
      return Promise.resolve({
        output: { kind: "TEXT", text: JSON.stringify({ reply, asking: null }) },
      });
    },
  } as unknown as ModelGateway;
  return { gateway, seen };
}

/** The coverage hint the model was given, from its state. */
function nextOf(
  seen: readonly string[],
): { stepKey: string; reason: string }[] {
  const text = seen[0] ?? "";
  const at = text.indexOf('"next":[');
  if (at < 0) return [];
  const end = text.indexOf("]", at);
  return JSON.parse(text.slice(at + 7, end + 1)) as {
    stepKey: string;
    reason: string;
  }[];
}

const signup = {
  displayName: "Ines Duarte",
  organisationName: "Quillmark Health",
};

describe("proactive onboarding (owner 2026-10-16)", () => {
  it("the first turn is Q's: by first name, with what it knows, asking the top coverage question", async () => {
    const world = investorSession({
      journey: "founder",
      currentStepKey: "F1.company_name",
      recorded: { "F0.intent": "raising_now" },
    });
    const { gateway, seen } = saying("Hi Ines, welcome.");
    const outcome = await createInterviewAgent({
      gateway,
      firewall,
      logger,
    }).turn({
      ...turn(world, ""),
      signup,
      actor,
    });
    const told = seen[0] ?? "";
    expect(told).toContain("Speak first");
    expect(told).toContain("Ines");
    expect(told).toContain("Quillmark Health");
    expect(told).not.toMatch(/how can I help/i);
    const [top] = nextOf(seen);
    expect(top?.reason).toBe("ESSENTIAL_MISSING");
    // The question named is the top coverage field's own.
    const question = SPOKEN_QUESTIONS[top?.stepKey ?? ""];
    expect(told).toMatch(
      /Then ask exactly one question, the most valuable one now: "/,
    );
    if (question !== undefined) expect(told).toContain(question.slice(0, 40));
    // The company typed at sign-up is never the question.
    expect(top?.stepKey).not.toBe("F1.company_name");
    // Q's words, then the question it was given, so the turn ends asking.
    expect(outcome.reply.startsWith("Hi Ines, welcome.")).toBe(true);
    expect(outcome.reply.trim().endsWith("?")).toBe(true);
    expect(outcome.intent).toBe("OPENING");
  });

  it("an investor is asked about their mandate, never about a raise", async () => {
    const world = investorSession({ currentStepKey: "I0.investor_type" });
    const { gateway, seen } = saying("Welcome.");
    const outcome = await createInterviewAgent({
      gateway,
      firewall,
      logger,
    }).turn({
      ...turn(world, ""),
      signup: {
        displayName: "Kofi Mensah",
        organisationName: "Savanna Seed Partners",
      },
      actor,
    });
    expect(seen[0]).toContain("investment mandate");
    const [top] = nextOf(seen);
    expect(top?.stepKey.startsWith("I")).toBe(true);
    expect(outcome.reply).not.toMatch(/raising|raise/i);
    expect(outcome.reply.trim().endsWith("?")).toBe(true);
  });

  it("every non-final turn ends with a question, even when the model's reply asks nothing", async () => {
    const world = investorSession({
      journey: "founder",
      currentStepKey: "F1.stage",
      recorded: {
        "F0.intent": "raising_now",
        "F1.company_name": "Quillmark Health",
      },
    });
    for (const said of ["Thanks.", "Got it, that's useful.", "Noted."]) {
      const { gateway } = saying(said);
      const outcome = await createInterviewAgent({
        gateway,
        firewall,
        logger,
      }).turn({
        ...turn(world, "Okay."),
        actor,
      });
      expect(outcome.reply.trim().endsWith("?"), said).toBe(true);
    }
  });

  it("a reply that already asks is left alone", async () => {
    const world = investorSession({
      journey: "founder",
      currentStepKey: "F1.stage",
      recorded: {
        "F0.intent": "raising_now",
        "F1.company_name": "Quillmark Health",
      },
    });
    const { gateway } = saying("What stage is Quillmark at?");
    const outcome = await createInterviewAgent({
      gateway,
      firewall,
      logger,
    }).turn({
      ...turn(world, "Hi"),
      actor,
    });
    expect(outcome.reply).toBe("What stage is Quillmark at?");
  });
});
