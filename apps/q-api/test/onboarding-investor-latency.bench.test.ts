import { describe, expect, it } from "vitest";

import type { PermittedContextPlan } from "@capital-q/contracts";
import type { ModelGateway } from "@capital-q/model-gateway";
import type { QDelegationReader } from "@capital-q/model-gateway/q";
import { createLogger } from "@capital-q/observability";
import type { ContextFirewallPort } from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import { createInterviewAgent } from "../src/voice/interview-agent.js";
import type { RecommendationStore } from "../src/voice/onboarding-port.js";

import { reading } from "./authority-fixtures.js";
import { investorSession, turn } from "./interviewer-fixtures.js";

/**
 * An investor's typed turn with their mandate's categories already on the
 * record (onboarding speed 2026-10-20), with the same modelled latencies
 * as `interview-latency.bench.test.ts`. What is measured is how the turn
 * composes its reads around one model round: the record's category names,
 * the thread, the firewall plan and the recommendation store. No provider
 * is called. Wall-clock targets only with CQ_BENCH=1.
 */

const SCALE = Number(process.env["CQ_BENCH_SCALE"] ?? "0.25");
const MODELLED = {
  apiRoundTripMs: 150,
  databaseMs: 40,
  readerMs: 1_500,
  replyRoundMs: 1_600,
};
const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms * SCALE);
  });

const logger = createLogger(
  { serviceName: "q-api-bench", environment: "test" },
  { level: "silent" },
);
const actor = ActorContextSchema.parse({
  userId: "b0000000-0000-4000-8000-000000000001",
  tenantId: "c0000000-0000-4000-8000-000000000001",
  actorType: "HUMAN",
});
const firewall: ContextFirewallPort = {
  plan: async () => {
    await wait(MODELLED.databaseMs);
    return {
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
    };
  },
};

const node = (n: number) =>
  `d0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

async function runInvestorTurn(): Promise<{
  readonly ms: number;
  readonly apiCalls: number;
  readonly nodeReads: number;
  readonly reply: string;
}> {
  const world = investorSession({
    currentStepKey: "I4.capital_intensity",
    recorded: {
      "I0.investor_type": "angel",
      "I0.organisation_name": "Zino Capital",
      "I2.currency": "usd",
      "I3.geography": [node(1), node(2)].join(","),
      "I3.sectors": [node(3), node(4)].join(","),
      "I3.sectors_avoid": node(5),
      "I4.business_models": node(6),
      "I4.customer_types": node(7),
    },
  });
  let apiCalls = 0;
  let nodeReads = 0;
  const fetchSlow: typeof fetch = async (input, init) => {
    apiCalls += 1;
    await wait(MODELLED.apiRoundTripMs);
    const url = input instanceof Request ? input.url : input.toString();
    const nodeId = /\/taxonomy\/nodes\/([^/?]+)$/.exec(url)?.[1];
    if (nodeId !== undefined) {
      nodeReads += 1;
      return Response.json({
        id: decodeURIComponent(nodeId),
        vocabularyCode: "industry",
        canonicalCode: "node",
        displayName: `Category ${decodeURIComponent(nodeId).slice(-2)}`,
        description: null,
        parentNodeId: null,
        depth: 0,
        status: "ACTIVE",
        ancestors: [],
        aliases: [],
      });
    }
    return world.fetch(input, init);
  };
  const store = world.recommendations;
  const slowStore: RecommendationStore = {
    pending: async (...args) => {
      await wait(MODELLED.databaseMs);
      return store.pending(...args);
    },
    recommend: async (...args) => {
      await wait(MODELLED.databaseMs);
      return store.recommend(...args);
    },
  };
  const gateway = {
    execute: async () => {
      await wait(MODELLED.replyRoundMs);
      return {
        output: {
          kind: "TEXT",
          text: JSON.stringify({
            reply: "Understood. How do you feel about regulated markets?",
            asking: null,
          }),
        },
      };
    },
  } as unknown as ModelGateway;
  const delegation: QDelegationReader = {
    read: async () => {
      await wait(MODELLED.readerMs);
      return reading();
    },
  };
  const agent = createInterviewAgent({
    gateway,
    firewall,
    logger,
    delegation,
    recommendations: slowStore,
    replyByCodeAfterCleanSave: true,
    readingByCodeWhereExact: true,
  });
  const started = performance.now();
  const outcome = await agent.turn({
    ...turn({ ...world, fetch: fetchSlow }, "Tell me what you think so far."),
    actor,
  });
  return {
    ms: Math.round((performance.now() - started) / SCALE),
    apiCalls,
    nodeReads,
    reply: outcome.reply,
  };
}

describe("investor typed turn latency, with fakes", () => {
  it("names each recorded category once a turn, and replies", async () => {
    const result = await runInvestorTurn();
    console.log(JSON.stringify({ scale: SCALE, modelled: MODELLED, result }));
    expect(result.reply.length).toBeGreaterThan(0);
    // Seven category ids on the record: each is named once this turn,
    // however many times the turn reads its state.
    expect(result.nodeReads).toBeLessThanOrEqual(7);
    if (process.env["CQ_BENCH"] === "1") {
      expect(result.ms).toBeLessThanOrEqual(3_000);
    }
  }, 60_000);
});
