import { describe, expect, it } from "vitest";

import type { PermittedContextPlan } from "@capital-q/contracts";
import type { ModelGateway } from "@capital-q/model-gateway";
import { createLogger } from "@capital-q/observability";
import type { InvestorResearchReaderResult } from "@capital-q/q-core";
import type { ContextFirewallPort } from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import { validateFounderReading } from "../src/voice/founder-research.js";
import { createInterviewAgent } from "../src/voice/interview-agent.js";
import {
  createInvestorResearch,
  type InvestorResearch,
  type ResearchPage,
} from "../src/voice/investor-research.js";
import { createOnboardingPort } from "../src/voice/onboarding-port.js";

import { readerOf, reading } from "./authority-fixtures.js";
import {
  investorSession,
  turn,
  type InvestorWorld,
} from "./interviewer-fixtures.js";

/**
 * The founder (2026-10-02): "Q doing research on the person, confirming
 * the results based on the question, and on any kind of confirmation,
 * recording the answers at once or one by one depending on what the user
 * tells Q."
 *
 * Sign-up research finds answers; Q puts them to the person; the reading
 * (DELEGATION_READER, by meaning) says which they approved; and CODE
 * records exactly those -- all of them for "yes, all of that is right",
 * exactly two for "the first two are right, change the third" -- even
 * when the model never calls accept_recommendation. A finding never said
 * to them, or one they did not approve, is never recorded.
 */

const SESSION = "f0000000-0000-4000-8000-000000000010";
const actor = ActorContextSchema.parse({
  userId: "b0000000-0000-4000-8000-000000000001",
  tenantId: "c0000000-0000-4000-8000-000000000001",
  actorType: "HUMAN",
});
const logger = createLogger(
  { serviceName: "q-api-test", environment: "test" },
  { level: "silent" },
);

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

/** A model that never calls a tool: it only replies. */
function silentModel(): ModelGateway {
  return {
    execute: () =>
      Promise.resolve({
        output: {
          kind: "TEXT",
          text: JSON.stringify({ reply: "Noted.", asking: null }),
        },
      }),
  } as unknown as ModelGateway;
}

function researching(
  world: InvestorWorld,
  journey: "founder" | "investor",
  pages: readonly ResearchPage[],
  found: {
    readonly founder?: (
      pages: readonly ResearchPage[],
    ) => ReturnType<typeof validateFounderReading>;
    readonly investor?: InvestorResearchReaderResult;
  },
): { research: InvestorResearch; done: Promise<void> } {
  let finish: () => void = () => undefined;
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const research = createInvestorResearch({
    read: () => Promise.resolve(pages),
    ...(found.founder === undefined
      ? {}
      : {
          readFindings: ({ pages: read }: { pages: readonly ResearchPage[] }) =>
            Promise.resolve(found.founder?.(read) ?? []),
        }),
    ...(found.investor === undefined
      ? {}
      : { reader: () => Promise.resolve(found.investor ?? null) }),
    portFor: ({ actor: who, session, onboardingSessionId }) => {
      const port = createOnboardingPort({
        session,
        onboardingSessionId,
        journeyType: journey,
        ownerUserId: who.userId,
        personTurns: [],
        recommendations: world.recommendations,
      });
      return {
        answeredSteps: port.answeredSteps,
        recommendFound: async (items) => {
          const out = await port.recommendFound(items);
          finish();
          return out;
        },
      };
    },
    logger,
  });
  return { research, done };
}

async function pendingSteps(world: InvestorWorld): Promise<string[]> {
  return (
    await world.recommendations.pending({
      userId: actor.userId,
      sessionId: SESSION,
    })
  )
    .map((item) => item.stepKey)
    .sort();
}

// --- founder ---------------------------------------------------------------

const GREENBOX: ResearchPage = {
  url: "https://greenbox.africa/about",
  title: "About Greenbox",
  excerpt:
    "Greenbox runs solar cold rooms for farmers in Lagos, Nigeria. We are a seed-stage team of 14 people.",
  provider: "public_web",
  retrievedAt: "2026-09-30T10:00:00.000Z",
};

const founderFindings = (pages: readonly ResearchPage[]) =>
  validateFounderReading(
    {
      wrongSubject: false,
      description: {
        value: "We run solar cold rooms for farmers in Lagos.",
        sourceIndex: 0,
        quote: "solar cold rooms for farmers in Lagos",
      },
      country: { value: "NG", sourceIndex: 0, quote: "Lagos, Nigeria" },
      stage: { value: "seed", sourceIndex: 0, quote: "seed-stage team" },
      sectors: null,
      teamSize: { value: "14", sourceIndex: 0, quote: "team of 14 people" },
    },
    pages,
    null,
    "Greenbox",
  );

async function founderSignUp() {
  const world = investorSession({
    journey: "founder",
    currentStepKey: "F1.website",
    recorded: { "F0.intent": "raising_now", "F1.company_name": "Greenbox" },
  });
  const { research, done } = researching(world, "founder", [GREENBOX], {
    founder: founderFindings,
  });
  // (a) Research starts at sign-up, from the company they named.
  research.consider({
    actor,
    session: turn(world, "").session,
    onboardingSessionId: SESSION,
    identity: { firmName: "Greenbox", websiteUrl: null, profileUrls: [] },
  });
  await done;
  return { world, research };
}

describe("founder sign-up: Q found 5 answers and puts them to the founder", () => {
  it("(a)(b) research found five, held as recommendations, said to them against the questions", async () => {
    const { world, research } = await founderSignUp();
    const found = await pendingSteps(world);
    expect(found).toEqual([
      "F1.country",
      "F1.description",
      "F1.stage",
      "F1.website",
      "F4.team_size",
    ]);
    const prompts: string[] = [];
    await createInterviewAgent({
      gateway: {
        execute: (request: { messages: readonly { content: string }[] }) => {
          prompts.push(request.messages.map((m) => m.content).join("\n"));
          return Promise.resolve({
            output: {
              kind: "TEXT",
              text: JSON.stringify({
                reply: "Here's what I found.",
                asking: null,
              }),
            },
          });
        },
      } as unknown as ModelGateway,
      firewall: firewall(),
      logger,
      recommendations: world.recommendations,
      founderResearch: research,
    }).turn({ ...turn(world, "Hi"), actor });
    // Nothing is theirs before they confirm.
    for (const step of found) expect(world.recordedValue(step)).toBeUndefined();
    expect(prompts.join("\n")).toContain("greenbox.africa");
  });

  it("(c) 'yes, all of that is correct' records ALL five at once, by code, even when the model calls nothing", async () => {
    const { world, research } = await founderSignUp();
    const found = await pendingSteps(world);
    // Turn one: Q says them.
    await createInterviewAgent({
      gateway: silentModel(),
      firewall: firewall(),
      logger,
      recommendations: world.recommendations,
      founderResearch: research,
    }).turn({ ...turn(world, "Hi"), actor });
    // Turn two: one confirmation, read by meaning as approving all five.
    await createInterviewAgent({
      gateway: silentModel(),
      firewall: firewall(),
      logger,
      recommendations: world.recommendations,
      founderResearch: research,
      delegation: readerOf(reading({ approved: found })),
    }).turn({ ...turn(world, "Yes, all of that is correct."), actor });
    expect(world.recordedValue("F1.country")).toEqual({
      type: "SINGLE_SELECT",
      optionKey: "ng",
    });
    expect(world.recordedValue("F1.stage")).toEqual({
      type: "SINGLE_SELECT",
      optionKey: "seed",
    });
    expect(world.recordedValue("F4.team_size")).toEqual({
      type: "RANGE",
      value: "14",
    });
    expect(world.recordedValue("F1.description")).toBeDefined();
    expect(world.recordedValue("F1.website")).toBeDefined();
    expect(await pendingSteps(world)).toEqual([]);
  });

  it("(c) 'the first two are right, change the third' records exactly the two approved", async () => {
    const { world, research } = await founderSignUp();
    await createInterviewAgent({
      gateway: silentModel(),
      firewall: firewall(),
      logger,
      recommendations: world.recommendations,
      founderResearch: research,
    }).turn({ ...turn(world, "Hi"), actor });
    await createInterviewAgent({
      gateway: silentModel(),
      firewall: firewall(),
      logger,
      recommendations: world.recommendations,
      founderResearch: research,
      delegation: readerOf(
        reading({ approved: ["F1.description", "F1.country"] }),
      ),
    }).turn({
      ...turn(world, "The first two are right, but change the third."),
      actor,
    });
    expect(world.recordedValue("F1.description")).toBeDefined();
    expect(world.recordedValue("F1.country")).toBeDefined();
    expect(world.recordedValue("F1.stage")).toBeUndefined();
    expect(world.recordedValue("F4.team_size")).toBeUndefined();
    expect(await pendingSteps(world)).toEqual([
      "F1.stage",
      "F1.website",
      "F4.team_size",
    ]);
  });

  it("(d) a reading that approves nothing records nothing, whatever the words", async () => {
    const { world, research } = await founderSignUp();
    await createInterviewAgent({
      gateway: silentModel(),
      firewall: firewall(),
      logger,
      recommendations: world.recommendations,
      founderResearch: research,
    }).turn({ ...turn(world, "Hi"), actor });
    await createInterviewAgent({
      gateway: silentModel(),
      firewall: firewall(),
      logger,
      recommendations: world.recommendations,
      founderResearch: research,
      delegation: readerOf(reading({})),
    }).turn({ ...turn(world, "Yes, all of that is correct."), actor });
    expect(world.recordedValue("F1.country")).toBeUndefined();
  });

  it("a finding never said to them is not recorded, even on a reading that approves it", async () => {
    const { world, research } = await founderSignUp();
    const found = await pendingSteps(world);
    // No turn in which Q said them.
    await createInterviewAgent({
      gateway: silentModel(),
      firewall: firewall(),
      logger,
      recommendations: world.recommendations,
      founderResearch: research,
      delegation: readerOf(reading({ approved: found })),
    }).turn({ ...turn(world, "Yes to all of that."), actor });
    for (const step of found) expect(world.recordedValue(step)).toBeUndefined();
  });
});

// --- investor --------------------------------------------------------------

const KESTREL: ResearchPage = {
  url: "https://kestrelridge.vc/",
  title: "Kestrel Ridge Capital",
  excerpt:
    "Kestrel Ridge Capital is an early-stage venture capital fund. We lead pre-seed and seed rounds for founders building fintech and climate software across West Africa and the United Kingdom.",
  provider: "public_web",
  retrievedAt: "2026-09-27T08:00:00.000Z",
};

const INVESTOR_FOUND: InvestorResearchReaderResult = {
  wrongSubject: false,
  investorType: {
    value: "vc",
    sourceIndex: 0,
    quote: "an early-stage venture capital fund",
  },
  thesis: null,
  stages: {
    value: ["pre_seed", "seed"],
    sourceIndex: 0,
    quote: "We lead pre-seed and seed rounds",
  },
  sectors: null,
  geographies: null,
  cheque: null,
  portfolio: null,
};

describe("investor sign-up: the same confirmation records everything approved", () => {
  it("'that's all correct' records every finding said to them, by code", async () => {
    const world = investorSession({
      currentStepKey: "I0.investor_type",
      recorded: {
        "I0.organisation_name": "Kestrel Ridge Capital",
        "I1.mandate_context": "e0000000-0000-4000-8000-000000000001",
      },
    });
    const { research, done } = researching(world, "investor", [KESTREL], {
      investor: INVESTOR_FOUND,
    });
    research.consider({
      actor,
      session: turn(world, "").session,
      onboardingSessionId: SESSION,
      identity: {
        firmName: "Kestrel Ridge Capital",
        websiteUrl: "https://kestrelridge.vc",
        profileUrls: [],
      },
    });
    await done;
    const found = await pendingSteps(world);
    expect(found).toEqual(["I0.investor_type", "I2.stages"]);
    await createInterviewAgent({
      gateway: silentModel(),
      firewall: firewall(),
      logger,
      recommendations: world.recommendations,
      investorResearch: research,
    }).turn({ ...turn(world, "Hi"), actor });
    await createInterviewAgent({
      gateway: silentModel(),
      firewall: firewall(),
      logger,
      recommendations: world.recommendations,
      investorResearch: research,
      delegation: readerOf(reading({ approved: found })),
    }).turn({ ...turn(world, "Yep, that's all correct."), actor });
    expect(world.recordedValue("I0.investor_type")).toEqual({
      type: "SINGLE_SELECT",
      optionKey: "vc",
    });
    expect(world.recordedValue("I2.stages")).toEqual({
      type: "MULTI_SELECT",
      optionKeys: ["pre_seed", "seed"],
    });
  });
});
