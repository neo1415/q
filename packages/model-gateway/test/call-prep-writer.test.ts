import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { PermittedContextPlan } from "@capital-q/contracts";
import type { QAnswerRequest } from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import {
  createFakeModelProvider,
  createInMemoryModelUsageRepository,
  createModelGateway,
  createModelProviderRegistry,
  createStaticModelCatalog,
} from "../src/index.js";
import { createCallPrepWriter, createSmallTalkReply } from "../src/q/index.js";
import { TENANT, testCatalog, USER } from "./fixtures.js";

/**
 * Live 2026-10-23 (run 3ba29d7d): the call prep was read and routed, but
 * the gateway refused its request as invalid before any model was tried
 * (INVALID_REQUEST, candidates []): a live run's abort signal sat in the
 * strict request body. Through the real gateway (request validation,
 * catalogue routing, a scripted provider), with a live run's signal.
 */
const PREP = {
  whoTheyAre: "A seed fund in Nairobi.",
  soFar: "Connected; their message waits for your reply.",
  questions: [
    { question: "Why now?", answer: "Pilots with 3 co-ops." },
    { question: "Who pays?", answer: "The co-ops." },
    { question: "How big?", answer: "Not in your record yet." },
  ],
  weakSpots: [{ spot: "No churn figure.", handle: "Say so." }],
  ask: "A second meeting with their partner.",
};

function setup(text: string) {
  const alpha = createFakeModelProvider({
    code: "alpha",
    script: [{ kind: "TEXT", text }],
  });
  const usage = createInMemoryModelUsageRepository();
  const gateway = createModelGateway({
    catalog: createStaticModelCatalog(testCatalog((s) => s)),
    registry: createModelProviderRegistry([alpha]),
    usage,
    sleep: () => Promise.resolve(),
  });
  const runId = randomUUID();
  const request = {
    runId,
    tenantId: TENANT,
    actorUserId: USER,
    actor: ActorContextSchema.parse({
      userId: USER,
      tenantId: TENANT,
      actorType: "HUMAN",
    }),
    correlationId: `cor_${runId}`,
    capability: "ANSWER",
    subjects: [],
    retrieval: { kind: "NOT_CONFIGURED" },
    plan: { maxSensitivity: "PUBLIC" } as unknown as PermittedContextPlan,
    // A live run's own abort signal, as every answered turn carries.
    signal: new AbortController().signal,
  } as unknown as QAnswerRequest;
  return { gateway, alpha, request };
}

describe("call prep through the real gateway (live 2026-10-23)", () => {
  it("is a valid request with a live run's signal, routed and answered", async () => {
    const { gateway, alpha, request } = setup(JSON.stringify(PREP));
    const warned: unknown[] = [];
    const write = createCallPrepWriter({
      gateway,
      logger: {
        warn: (entry: unknown) => warned.push(entry),
      } as unknown as Parameters<typeof createCallPrepWriter>[0]["logger"],
    });
    const prep = await write(request, {
      viewerRole: "FOUNDER",
      counterpartName: "Savanna Seed Partners (fictional)",
      counterpartProfile: "Name: Savanna Seed Partners\nType: VC",
      soFar: "WHAT THEY WROTE TO YOU:\nAmara: Looking forward to it.",
      ownRecord: "THEIR COMPANY: Maji Loop. ".repeat(400),
      said: "Help me prepare for a first call with Savanna Seed Partners",
    });
    expect(warned).toEqual([]);
    expect(prep).toEqual(PREP);
    expect(alpha.calls).toHaveLength(1);
    const prompt = (alpha.calls[0]?.request.messages ?? [])
      .map((message) => message.content)
      .join("\n");
    expect(prompt).toContain("TASK: CALL_PREP");
  });

  it("small talk is valid with a live run's signal too (the same defect)", async () => {
    const { gateway, alpha, request } = setup(
      JSON.stringify({ say: "Busy, but good. You?" }),
    );
    const said = await createSmallTalkReply({ gateway })(request, {
      said: "how's your day going?",
      recent: [],
    });
    expect(said).toBe("Busy, but good. You?");
    expect(alpha.calls).toHaveLength(1);
  });
});
