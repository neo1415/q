import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { PermittedContextPlan } from "@capital-q/contracts";
import type {
  TransactionContext,
  TransactionManager,
} from "@capital-q/database";
import type { ModelGateway } from "@capital-q/model-gateway";
import { createLogger } from "@capital-q/observability";
import {
  createMemoryService,
  type MemoryItem,
  type MemoryRepository,
  type NewMemoryItem,
} from "@capital-q/q-knowledge";
import type { ContextFirewallPort } from "@capital-q/q-runtime";
import { ActorContextSchema, type ActorContext } from "@capital-q/security";

import { createInterviewAgent } from "../src/voice/interview-agent.js";

import { investorSession, turn } from "./interviewer-fixtures.js";

/**
 * P0-5, as properties of the interview loop over the REAL memory service
 * and Write Gate (an in-memory repository beneath them):
 * - a preference stated at turn t holds on every later turn;
 * - LONG_TERM holds in the next session, SESSION does not;
 * - it never reaches another person;
 * - the loop reads the whole conversation within a fixed budget.
 */

const logger = createLogger(
  { serviceName: "q-api-test", environment: "test" },
  { level: "silent" },
);
const TENANT = "c0000000-0000-4000-8000-000000000001";
const person = (userId: string): ActorContext =>
  ActorContextSchema.parse({ userId, tenantId: TENANT, actorType: "HUMAN" });
const JOE = person("b0000000-0000-4000-8000-000000000001");
const ADA = person("b0000000-0000-4000-8000-000000000002");
const CONCISE = "Depth: concise.";

function memoryStore() {
  const rows: MemoryItem[] = [];
  let clock = Date.parse("2026-09-25T00:00:00.000Z");
  const live = (r: MemoryItem) => r.status === "active";
  const owned = (
    r: MemoryItem,
    tenantId: string,
    owner: { ownerContextType: string; ownerContextId: string },
  ) =>
    r.tenantId === tenantId &&
    r.ownerContextType === owner.ownerContextType &&
    r.ownerContextId === owner.ownerContextId;
  const repository: MemoryRepository = {
    listLive: (_e, tenantId, owner, limit) =>
      Promise.resolve(
        rows
          .filter((r) => owned(r, tenantId, owner) && live(r))
          .slice(0, limit),
      ),
    findLiveByKey: (_e, tenantId, owner, type, key) =>
      Promise.resolve(
        rows.find(
          (r) =>
            owned(r, tenantId, owner) &&
            live(r) &&
            r.memoryType === type &&
            r.memoryKey === key,
        ) ?? null,
      ),
    findLiveByHash: (_e, tenantId, owner, hash) =>
      Promise.resolve(
        rows.find(
          (r) =>
            owned(r, tenantId, owner) && live(r) && r.contentSha256 === hash,
        ) ?? null,
      ),
    insert: (_tx, input: NewMemoryItem) => {
      clock += 1_000;
      const now = new Date(clock).toISOString();
      const item: MemoryItem = {
        id: randomUUID(),
        tenantId: input.tenantId,
        ownerContextType: input.owner.ownerContextType,
        ownerContextId: input.owner.ownerContextId,
        subject: null,
        memoryType: input.memoryType,
        memoryKey: input.memoryKey,
        content: input.content,
        structuredValue: input.structuredValue,
        quote: input.quote,
        contentSha256: input.contentSha256,
        sourceConversationId: input.sourceConversationId,
        sourceRunId: input.sourceRunId,
        writeMode: input.writeMode,
        status: input.status,
        supersededBy: null,
        validFrom: now,
        validTo: null,
        lastUsedAt: null,
        useCount: 0,
        createdAt: now,
        updatedAt: now,
      };
      rows.push(item);
      return Promise.resolve(item);
    },
    supersede: (_tx, _tenant, _owner, id, by) => {
      const index = rows.findIndex((r) => r.id === id);
      const row = rows[index];
      if (row !== undefined) {
        rows[index] = { ...row, status: "superseded", supersededBy: by };
      }
      return Promise.resolve();
    },
    forget: () => Promise.resolve(null),
    markUsed: () => Promise.resolve(),
  };
  const tx = {
    sql: Object.assign(() => Promise.resolve([]), {}),
  } as unknown as TransactionContext;
  const transactions: TransactionManager = { run: (work) => work(tx) };
  return createMemoryService({ sql: tx.sql, transactions, repository });
}

/** The owner's plan: their onboarding and their own conversations. */
function firewall(): ContextFirewallPort {
  return {
    plan: (request) =>
      Promise.resolve({
        outcome: "AUTHORISED",
        plan: {
          tenantId: request.actor.tenantId,
          actor: { userId: request.actor.userId },
          purpose: { capability: "ANSWER", taskClass: "GENERAL_QUESTION" },
          subjects: [],
          scopes: ["OWN_ONBOARDING", "OWN_Q_CONVERSATION"].map((kind) => ({
            kind,
            filter: {
              tenantId: request.actor.tenantId,
              userId: request.actor.userId,
            },
            sensitivity: "CONFIDENTIAL",
          })),
          maxSensitivity: "CONFIDENTIAL",
        } as unknown as PermittedContextPlan,
      }),
  };
}

/** A model that notes the preference when told to, and records what it saw. */
function model(
  note: { persistence: "SESSION" | "LONG_TERM"; quote: string } | null,
) {
  const prompts: string[] = [];
  let noted = false;
  const gateway = {
    execute: (request: {
      readonly messages: readonly { readonly content: string }[];
      readonly tools?: readonly { readonly name: string }[];
    }) => {
      const text = request.messages.map((m) => m.content).join("\n");
      prompts.push(text);
      const offersNote = (request.tools ?? []).some(
        (t) => t.name === "note_preference",
      );
      if (note !== null && offersNote && !noted) {
        noted = true;
        return Promise.resolve({
          output: {
            kind: "TOOL_CALLS",
            text: "",
            calls: [
              {
                callId: "call_note",
                name: "note_preference",
                arguments: {
                  aspect: "responseDepth",
                  value: "CONCISE",
                  persistence: note.persistence,
                  quote: note.quote,
                },
              },
            ],
          },
        });
      }
      return Promise.resolve({
        output: {
          kind: "TEXT",
          text: JSON.stringify({ reply: "Understood.", asking: null }),
        },
      });
    },
  } as unknown as ModelGateway;
  return { gateway, prompts };
}

const SAID = "You're talking too much, keep it short.";

async function say(
  agent: ReturnType<typeof createInterviewAgent>,
  actor: ActorContext,
  utterance: string,
  sessionId?: string,
) {
  const world = investorSession({ currentStepKey: "I2.stages" });
  const input = turn(world, utterance);
  return agent.turn({
    ...input,
    ...(sessionId === undefined ? {} : { onboardingSessionId: sessionId }),
    actor,
  });
}

describe("P0-5 · a stated preference is a real, persistent preference", () => {
  it("holds on the turns after it, and never for another person", async () => {
    const memory = memoryStore();
    const { gateway, prompts } = model({ persistence: "SESSION", quote: SAID });
    const agent = createInterviewAgent({
      gateway,
      firewall: firewall(),
      logger,
      memory,
    });

    await say(agent, JOE, SAID);
    expect(prompts[0]).not.toContain(CONCISE);

    for (const later of ["What stages?", "Pre-seed.", "And seed."]) {
      const before = prompts.length;
      await say(agent, JOE, later);
      expect(prompts[before]).toContain(CONCISE);
    }
    const before = prompts.length;
    await say(agent, ADA, "What stages?");
    expect(prompts[before]).not.toContain(CONCISE);
  });

  it("a session preference stays in its session; a long-term one carries over", async () => {
    const memory = memoryStore();
    const session = model({ persistence: "SESSION", quote: SAID });
    const agentA = createInterviewAgent({
      gateway: session.gateway,
      firewall: firewall(),
      logger,
      memory,
    });
    await say(agentA, JOE, SAID);
    const elsewhere = session.prompts.length;
    await say(agentA, JOE, "Hello.", "f0000000-0000-4000-8000-0000000000aa");
    expect(session.prompts[elsewhere]).not.toContain(CONCISE);

    const rule = model({
      persistence: "LONG_TERM",
      quote: "Always keep it short with me.",
    });
    const agentB = createInterviewAgent({
      gateway: rule.gateway,
      firewall: firewall(),
      logger,
      memory,
    });
    await say(agentB, JOE, "Always keep it short with me.");
    const next = rule.prompts.length;
    await say(agentB, JOE, "Hello.", "f0000000-0000-4000-8000-0000000000bb");
    expect(rule.prompts[next]).toContain(CONCISE);
  });

  it("refuses a preference whose quote the person never said", async () => {
    const memory = memoryStore();
    const { gateway, prompts } = model({
      persistence: "SESSION",
      quote: "Please be very brief with me always.",
    });
    const agent = createInterviewAgent({
      gateway,
      firewall: firewall(),
      logger,
      memory,
    });
    await say(agent, JOE, "What stages do you mean?");
    const before = prompts.length;
    await say(agent, JOE, "Pre-seed.");
    expect(prompts[before]).not.toContain(CONCISE);
  });
});

describe("P0-5 · the loop reads the whole conversation within a fixed budget", () => {
  it("keeps the newest turns verbatim and the older ones as a bounded summary", async () => {
    const { gateway, prompts } = model(null);
    const agent = createInterviewAgent({
      gateway,
      firewall: firewall(),
      logger,
    });
    const world = investorSession({ currentStepKey: "I2.stages" });
    const recentTurns = Array.from({ length: 40 }, (_, i) => ({
      role: i % 2 === 0 ? ("person" as const) : ("q" as const),
      text: `Turn number ${String(i)} ${"detail ".repeat(60)}`,
    }));

    await agent.turn({ ...turn(world, "Carry on."), recentTurns, actor: JOE });

    const prompt = prompts[0] ?? "";
    expect(prompt).toContain("Earlier in this conversation (28 turns");
    expect(prompt).toContain("Turn number 39 ");
    expect(prompt).toContain("Turn number 28 ");
    // Older turns survive only as their opening words, never in full.
    expect(prompt).not.toContain(`Turn number 0 ${"detail ".repeat(60)}`);
  });
});
