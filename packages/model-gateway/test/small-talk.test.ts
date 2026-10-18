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
import { createSmallTalkReply } from "../src/q/index.js";
import { TENANT, testCatalog, USER } from "./fixtures.js";

/**
 * RECOVERY-2026-10 B5: small talk is one model call with no tools and a
 * prompt a fraction of the analyst's (~37k characters live, T3), and it
 * never claims work it did not do.
 */

function setup(text: string | null) {
  const alpha = createFakeModelProvider({
    code: "alpha",
    script:
      text === null
        ? [
            { kind: "ERROR", failureClass: "PROVIDER_OUTAGE" },
            { kind: "ERROR", failureClass: "PROVIDER_OUTAGE" },
          ]
        : [{ kind: "TEXT", text: JSON.stringify({ say: text }) }],
  } as Parameters<typeof createFakeModelProvider>[0]);
  const gateway = createModelGateway({
    catalog: createStaticModelCatalog(testCatalog((s) => s)),
    registry: createModelProviderRegistry([alpha]),
    usage: createInMemoryModelUsageRepository(),
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
  } as unknown as QAnswerRequest;
  return { reply: createSmallTalkReply({ gateway }), alpha, request };
}

describe("small talk in one tool-free call", () => {
  it("makes exactly one call, offers no tools, and keeps the prompt small", async () => {
    const { reply, alpha, request } = setup(
      "Ha, a joke: why did the founder cross the road? To get to Series A.",
    );
    const said = await reply(request, {
      said: "tell me a joke",
      recent: [{ role: "Q", text: "Hi! What would you like to work on?" }],
    });
    expect(said).toMatch(/Series A/u);
    expect(alpha.calls).toHaveLength(1);
    const call = alpha.calls[0]?.request;
    expect(call?.tools ?? []).toEqual([]);
    const characters = (call?.messages ?? []).reduce(
      (sum, message) => sum + message.content.length,
      0,
    );
    // The analyst's prompt was ~37,000 characters live (T3).
    expect(characters).toBeLessThan(9_000);
    // Their words are fenced as data.
    expect(
      call?.messages.some((message) =>
        message.content.includes('<<<UNTRUSTED_CONTENT source="said">>>'),
      ),
    ).toBe(true);
  });

  it("is null when the reply claims work it did not do, so the full path answers", async () => {
    const { reply, request } = setup(
      "I've just booked your call with Halyard.",
    );
    expect(await reply(request, { said: "lovely day", recent: [] })).toBeNull();
  });

  it("is null when the model is unavailable, never silence", async () => {
    const { reply, request } = setup(null);
    expect(await reply(request, { said: "lovely day", recent: [] })).toBeNull();
  });
});
