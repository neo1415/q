import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { PermittedContextPlan } from "@capital-q/contracts";
import type {
  QAnswerRequest,
  QConversationMessage,
} from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import {
  createFakeModelProvider,
  createInMemoryModelUsageRepository,
  createModelGateway,
  createModelProviderRegistry,
  createStaticModelCatalog,
} from "../src/index.js";
import {
  conversationContextOf,
  createConversationRecall,
  shownContextNote,
} from "../src/q/index.js";
import { TENANT, testCatalog, USER } from "./fixtures.js";

/**
 * Owner live 2026-10-17: "so what was the second one?" after Q listed three
 * companies is answered from the conversation's own record of that list,
 * in one call with no tools, no ranking and no lookup.
 */

const CONVERSATION = randomUUID();

const listed = {
  id: randomUUID(),
  tenantId: TENANT,
  conversationId: CONVERSATION,
  runId: randomUUID(),
  role: "Q",
  content:
    "So, the top three: Halyard Security at 10; then Clearwater Assurance and Tensorgate, level at 8.8.",
  contentType: "TEXT",
  createdAt: new Date().toISOString(),
  blocks: [
    {
      kind: "ANSWER_CARDS",
      cards: [
        { name: "Halyard Security", fit: { score: 10 } },
        { name: "Clearwater Assurance", fit: { score: 8.8 } },
        { name: "Tensorgate", fit: { score: 8.8 } },
      ],
    },
  ],
} as unknown as QConversationMessage;

function setup(output: unknown) {
  const alpha = createFakeModelProvider({
    code: "alpha",
    script:
      output === null
        ? [
            { kind: "ERROR", failureClass: "PROVIDER_OUTAGE" },
            { kind: "ERROR", failureClass: "PROVIDER_OUTAGE" },
          ]
        : [{ kind: "TEXT", text: JSON.stringify(output) }],
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
  return { recall: createConversationRecall({ gateway }), alpha, request };
}

const shown = conversationContextOf([listed]).text;

describe("a follow-up answered from what Q already showed", () => {
  it("is one call with no tools, reading the record with its order", async () => {
    const { recall, alpha, request } = setup({
      answerable: true,
      say: "The second was Clearwater Assurance, at 8.8 on your mandate.",
    });
    const said = await recall(request, {
      said: "so what was the second one?",
      recent: [],
      shown,
      turn: 1,
    });
    expect(said).toMatch(/Clearwater Assurance/u);
    expect(alpha.calls).toHaveLength(1);
    const call = alpha.calls[0]?.request;
    expect(call?.tools ?? []).toEqual([]);
    const prompt = (call?.messages ?? []).map((m) => m.content).join("\n");
    expect(prompt).toContain('<<<UNTRUSTED_CONTENT source="shown">>>');
    expect(prompt).toContain(`"#":2`);
    expect(prompt).toContain("Clearwater Assurance");
  });

  it("is null when the record does not hold the answer, so the full path looks it up", async () => {
    const { recall, request } = setup({ answerable: false, say: null });
    expect(
      await recall(request, {
        said: "what is Clearwater's burn?",
        recent: [],
        shown,
        turn: 1,
      }),
    ).toBeNull();
  });

  it("is null when the reply claims a lookup it did not do", async () => {
    const { recall, request } = setup({
      answerable: true,
      say: "I've just checked: it's Clearwater Assurance.",
    });
    expect(
      await recall(request, {
        said: "the second?",
        recent: [],
        shown,
        turn: 1,
      }),
    ).toBeNull();
  });

  it("makes no call at all with nothing shown", async () => {
    const { recall, alpha, request } = setup({ answerable: true, say: "x" });
    expect(
      await recall(request, {
        said: "the second?",
        recent: [],
        shown: "",
        turn: 1,
      }),
    ).toBeNull();
    expect(alpha.calls).toHaveLength(0);
  });
});

describe("the answer's note of what Q showed", () => {
  it("is built from this conversation's own messages, fenced, with order", () => {
    const note = shownContextNote([listed]);
    expect(note?.content).toContain('<<<UNTRUSTED_CONTENT source="shown">>>');
    expect(note?.content).toContain(`"#":2,"name":"Clearwater Assurance"`);
  });

  it("is absent for a conversation where Q showed nothing (another conversation's list never leaks in)", () => {
    expect(shownContextNote([])).toBeNull();
    const other = { ...listed, role: "USER", blocks: undefined, content: "hi" };
    expect(shownContextNote([other as QConversationMessage])).toBeNull();
  });
});
