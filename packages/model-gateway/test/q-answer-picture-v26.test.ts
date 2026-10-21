import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  QResultBlockSchema,
  type PermittedContextPlan,
  type QResultBlock,
} from "@capital-q/contracts";
import { CompanyAnalystV26ResultSchema } from "@capital-q/q-core";
import type {
  QAnswerRequest,
  QConversationMessage,
  QRuntimeRepositories,
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
  createModelGatewayQAnswer,
  type QPictureBlock,
  type QPicturePort,
} from "../src/q/index.js";
import { testCatalog } from "./fixtures.js";

/**
 * COMPANY_ANALYST v26 (L-13) through the real answer seam, the model's
 * answers scripted: a picture appears only when the analyst asks for one,
 * the picture port is handed the person's own words (never Q's), what is
 * stored is a validated, credited block on the source's own hosts, a
 * picture is never evidence, and an answer without one is complete.
 */

const TENANT = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const ORG = "33333333-3333-4333-8333-333333333333";
const COMPANY = "77777777-7777-4777-8777-777777777777";
const RUN = "44444444-4444-4444-8444-444444444444";
const CONVERSATION = "55555555-5555-4555-8555-555555555555";

const EARLIER = "We sell shea butter from northern Ghana";
const Q_SAID = "Kivu Freight grew revenue to 2.4m last year.";
const ASKED = "What does a baobab tree look like?";

const PICTURE: QPictureBlock = {
  kind: "PICTURE",
  url: "https://images.pexels.com/photos/1/pexels-photo-1.jpeg",
  alt: "A baobab tree at dusk",
  credit: { name: "Ada Obi", url: "https://www.pexels.com/@ada-obi" },
  source: "PEXELS",
  pageUrl: "https://www.pexels.com/photo/baobab-1/",
};

const ANSWER =
  "A baobab is a broad, short tree with a very thick trunk and sparse branches.";

function plan(): PermittedContextPlan {
  return {
    contractVersion: 1,
    policyVersion: "context-firewall-v2",
    planId: "66666666-6666-4666-8666-666666666666",
    fingerprint: "a".repeat(64),
    runId: RUN,
    tenantId: TENANT,
    actor: { userId: USER, organisationId: ORG },
    purpose: { capability: "ANSWER", taskClass: "OWN_COMPANY_QUESTION" },
    subjects: [{ kind: "COMPANY", companyId: COMPANY }],
    scopes: [],
    denied: [],
    maxSensitivity: "PUBLIC",
    allowedLayers: ["GENERAL_MODEL"],
    combinationConstraints: [],
    evaluatedAt: "2026-10-21T10:00:00.000Z",
    revalidateAfter: "2026-10-21T10:05:00.000Z",
    revalidateOnResume: true,
  } as unknown as PermittedContextPlan;
}

function message(
  role: "USER" | "Q",
  content: string,
  at: string,
): QConversationMessage {
  return {
    id: randomUUID(),
    tenantId: TENANT,
    conversationId: CONVERSATION,
    runId: RUN,
    role,
    content,
    contentType: "TEXT",
    createdAt: at,
  } as unknown as QConversationMessage;
}

type Asked = Parameters<QPicturePort["find"]>[0];

function build(
  object: Record<string, unknown>,
  found: () => Promise<QPictureBlock | null> = () => Promise.resolve(PICTURE),
) {
  const capture: {
    content?: string;
    blocks?: readonly QResultBlock[];
    asked: Asked[];
  } = { asked: [] };
  const messages = [
    message("USER", EARLIER, "2026-10-21T09:58:00.000Z"),
    message("Q", Q_SAID, "2026-10-21T09:59:00.000Z"),
    message("USER", ASKED, "2026-10-21T10:00:00.000Z"),
  ];
  const alpha = createFakeModelProvider({
    code: "alpha",
    script: [{ kind: "JSON", value: object }],
  });
  const gateway = createModelGateway({
    catalog: createStaticModelCatalog(testCatalog()),
    registry: createModelProviderRegistry([alpha]),
    usage: createInMemoryModelUsageRepository(),
    sleep: () => Promise.resolve(),
    random: () => 0.5,
  });
  const repositories = {
    messages: {
      listRecentForConversationOfRun: () => Promise.resolve([...messages]),
      listForRun: () => Promise.resolve([...messages]),
      insert: (
        _tx: unknown,
        input: { content: string; blocks?: readonly QResultBlock[] },
      ) => {
        capture.content = input.content;
        if (input.blocks !== undefined) capture.blocks = input.blocks;
        return Promise.resolve({
          ...messages[2],
          id: randomUUID(),
          role: "Q",
          content: input.content,
        } as QConversationMessage);
      },
      findById: () => Promise.resolve(null),
    },
    runs: { allocateEventSequence: () => Promise.resolve(2) },
    runEvents: { append: () => Promise.resolve({}) },
  } as unknown as QRuntimeRepositories;
  const pictures: QPicturePort = {
    find: (input) => {
      capture.asked.push(input);
      return found();
    },
  };
  const seam = createModelGatewayQAnswer({
    gateway,
    repositories,
    sql: {} as never,
    transactions: { run: (work) => work({} as never) },
    deltas: {
      publish: () => undefined,
      subscribe: () => () => undefined,
      subscriberCount: () => 1,
    },
    pictures,
  });
  const request = {
    runId: RUN,
    tenantId: TENANT,
    actorUserId: USER,
    actor: ActorContextSchema.parse({
      userId: USER,
      tenantId: TENANT,
      actorType: "HUMAN",
    }),
    correlationId: `cor_${RUN}`,
    capability: "ANSWER",
    subjects: [{ kind: "COMPANY", companyId: COMPANY }],
    plan: plan(),
  } as unknown as QAnswerRequest;
  return { seam, request, capture };
}

const v26 = (extra: Record<string, unknown> = {}) =>
  CompanyAnalystV26ResultSchema.parse({
    answer: ANSWER,
    responseShape: "CONCISE",
    insufficientEvidence: false,
    recommendation: null,
    ...extra,
  });

const pictures = (blocks: readonly QResultBlock[] | undefined) =>
  (blocks ?? []).filter((block) => block.kind === "PICTURE");

describe("COMPANY_ANALYST v26 pictures through the answer seam", () => {
  it("shows one credited picture when asked, searched with the person's words only", async () => {
    const { seam, request, capture } = build(
      v26({ visual: "PICTURE", pictureQuery: "baobab tree" }),
    );
    const outcome = await seam.answer(request);
    expect(outcome.kind).toBe("ANSWERED");
    expect(capture.content).toBe(ANSWER);

    expect(capture.asked).toHaveLength(1);
    const asked = capture.asked[0];
    // The model's words are only a proposal; the port composes what
    // leaves from these, and Q's own earlier words are never among them.
    expect(asked?.requestedQuery).toBe("baobab tree");
    expect(asked?.userText).toBe(ASKED);
    expect(asked?.earlierUserText).toEqual([EARLIER]);
    expect(JSON.stringify(asked)).not.toContain("Kivu");
    expect(JSON.stringify(asked)).not.toContain("2.4m");

    const shown = pictures(capture.blocks);
    expect(shown).toEqual([PICTURE]);
    expect(QResultBlockSchema.safeParse(shown[0]).success).toBe(true);
    expect(shown[0]?.credit.name).toBe("Ada Obi");
  });

  it("is never evidence: no finding, evidence or source comes from the picture, and its credit stays out of the words", async () => {
    const { seam, request, capture } = build(
      v26({ visual: "PICTURE", pictureQuery: "baobab tree" }),
    );
    await seam.answer(request);
    for (const block of capture.blocks ?? []) {
      if (block.kind === "PICTURE") continue;
      expect(JSON.stringify(block)).not.toContain("pexels");
      expect(JSON.stringify(block)).not.toContain("Ada Obi");
    }
    expect(
      (capture.blocks ?? []).some(
        (block) =>
          (block.kind === "EVIDENCE" ||
            block.kind === "PUBLIC_SOURCE" ||
            block.kind === "FINDING") &&
          JSON.stringify(block).includes("baobab"),
      ),
    ).toBe(false);
    expect(capture.content).not.toContain("Ada Obi");
    expect(capture.content).not.toContain("pexels");
  });

  it("an answer with no picture is complete, and the port is never asked", async () => {
    for (const result of [
      v26(),
      v26({ visual: "TABLE" }),
      v26({ visual: "PICTURE", pictureQuery: null }),
    ]) {
      const { seam, request, capture } = build(result);
      const outcome = await seam.answer(request);
      expect(outcome.kind).toBe("ANSWERED");
      expect(capture.content).toBe(ANSWER);
      expect(pictures(capture.blocks)).toEqual([]);
      expect(capture.asked).toEqual([]);
    }
  });

  it("drops a picture from another host, or one with no credit, and keeps the answer", async () => {
    for (const found of [
      { ...PICTURE, url: "https://tracker.example.com/pixel.gif" },
      { ...PICTURE, pageUrl: "https://example.com/photo/1" },
      { ...PICTURE, url: "http://images.pexels.com/photos/1/p.jpeg" },
      { ...PICTURE, credit: { name: " ", url: null } },
    ]) {
      const { seam, request, capture } = build(
        v26({ visual: "PICTURE", pictureQuery: "baobab tree" }),
        () => Promise.resolve(found),
      );
      const outcome = await seam.answer(request);
      expect(outcome.kind).toBe("ANSWERED");
      expect(capture.content).toBe(ANSWER);
      expect(pictures(capture.blocks)).toEqual([]);
    }
  });

  it("a picture search that fails is no picture, not a failed answer", async () => {
    const { seam, request, capture } = build(
      v26({ visual: "PICTURE", pictureQuery: "baobab tree" }),
      () => Promise.reject(new Error("offline")),
    );
    const outcome = await seam.answer(request);
    expect(outcome.kind).toBe("ANSWERED");
    expect(capture.content).toBe(ANSWER);
    expect(pictures(capture.blocks)).toEqual([]);
  });
});
