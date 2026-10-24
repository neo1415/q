import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { PermittedContextPlan } from "@capital-q/contracts";
import type {
  QAnswerRequest,
  QConversationMessage,
  QOfferedTool,
  QRuntimeRepositories,
  QToolCallOutcome,
  QToolPort,
} from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import {
  createFakeModelProvider,
  createInMemoryModelUsageRepository,
  createModelGateway,
  createModelProviderRegistry,
  createStaticModelCatalog,
} from "../src/index.js";
import { createModelGatewayQAnswer } from "../src/q/index.js";
import {
  asksAboutOwnPitch,
  ownPitchReviewFact,
} from "../src/q/own-pitch-review.js";
import { TENANT, testCatalog, USER } from "./fixtures.js";

/**
 * QA F-99 (24 Oct 2026): "How is my pitch video doing, and how can I make
 * it better?" was answered "your pitch video's performance isn't on
 * record" with no transcript read. A founder's own pitch is now read by
 * code and the review rests on what they say in it.
 */

const RUN = randomUUID();
const CONVERSATION = randomUUID();
const COMPANY = randomUUID();
const PITCH = randomUUID();
const LIVE_ASK = "How is my pitch video doing, and how can I make it better?";

const PITCHES_TOOL: QOfferedTool = {
  toolName: "company.pitches.read",
  toolVersion: 1,
  classification: "READ_ONLY",
  definition: {
    name: "read_company_pitches",
    description: "Reads what a company's founders say in its pitch videos.",
    inputJsonSchema: { type: "object", properties: {} },
  },
  visibleStage: "PREPARING_ANALYSIS",
};

const PITCHES = {
  pitches: [
    {
      pitchId: PITCH,
      title: "Maji Loop",
      transcript: "AVAILABLE",
      claims: [],
      segments: [
        { at: "0:00", atSeconds: 0, text: "Hi, I'm Wanjiru from Maji Loop." },
        {
          at: "0:06",
          atSeconds: 6,
          text: "We run 96 solar kiosks selling clean water by the litre.",
        },
        { at: "0:15", atSeconds: 15, text: "We're raising 1.5 million." },
      ],
    },
  ],
  source: "Machine-generated transcripts of the pitch videos",
  truthClass: "USER_CLAIM",
  evidenceStatus: "SELF_REPORTED",
};

function build(said: string) {
  const alpha = createFakeModelProvider({
    code: "alpha",
    script: [
      {
        kind: "TEXT",
        text: JSON.stringify({
          answer:
            "Your opening names the kiosks by 0:06; lead with the litre price.",
          responseShape: "CONCISE",
          insufficientEvidence: false,
        }),
      },
    ],
  });
  const gateway = createModelGateway({
    catalog: createStaticModelCatalog(
      testCatalog((s) => ({
        ...s,
        models: s.models.map((m) => ({ ...m, supportsTools: true })),
      })),
    ),
    registry: createModelProviderRegistry([alpha]),
    usage: createInMemoryModelUsageRepository(),
    sleep: () => Promise.resolve(),
  });
  const messages = [
    {
      id: randomUUID(),
      tenantId: TENANT,
      conversationId: CONVERSATION,
      runId: RUN,
      role: "USER",
      content: said,
      contentType: "TEXT",
      createdAt: new Date().toISOString(),
    } as unknown as QConversationMessage,
  ];
  const executed: { name: string; arguments: unknown }[] = [];
  const tools: QToolPort = {
    offer: () => Promise.resolve([PITCHES_TOOL]),
    execute: (proposal) => {
      executed.push({ name: proposal.name, arguments: proposal.arguments });
      return Promise.resolve({
        callId: proposal.callId,
        toolName: "company.pitches.read",
        toolVersion: 1,
        classification: "READ_ONLY",
        status: "SUCCEEDED",
        failureCode: null,
        sensitivity: "NETWORK_VISIBLE",
        result: { ok: true, data: PITCHES },
        latencyMs: 3,
      } as QToolCallOutcome);
    },
  };
  const repositories = {
    messages: {
      listForRun: () => Promise.resolve([...messages]),
      listRecentForConversationOfRun: () => Promise.resolve([...messages]),
      insert: (_tx: unknown, input: { content: string }) =>
        Promise.resolve({
          ...messages[0],
          id: randomUUID(),
          role: "Q",
          content: input.content,
        } as QConversationMessage),
      findById: () => Promise.resolve(null),
    },
    runs: { allocateEventSequence: () => Promise.resolve(2) },
    runEvents: { append: () => Promise.resolve({}) },
  } as unknown as QRuntimeRepositories;
  const seam = createModelGatewayQAnswer({
    gateway,
    repositories,
    sql: {} as never,
    transactions: { run: (work) => work({} as never) },
    tools,
    ownCompanySnapshot: () =>
      Promise.resolve({
        companyId: COMPANY,
        name: "Maji Loop",
        shortDescription: null,
        stageCode: "seed",
        countryCode: "KE",
      }),
  });
  const subject = { kind: "COMPANY" as const, companyId: COMPANY };
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
    subjects: [subject],
    retrieval: { kind: "NOT_CONFIGURED" },
    plan: {
      runId: RUN,
      tenantId: TENANT,
      actor: { userId: USER },
      purpose: { capability: "ANSWER", taskClass: "OWN_COMPANY_QUESTION" },
      subjects: [subject],
      scopes: [{ kind: "COMPANY_PROFILE", subject }],
      denied: [],
      maxSensitivity: "NETWORK_VISIBLE",
    } as unknown as PermittedContextPlan,
  } as unknown as QAnswerRequest;
  return { seam, request, alpha, executed };
}

const promptOf = (alpha: ReturnType<typeof build>["alpha"]): string =>
  alpha.calls
    .flatMap((call) => call.request.messages)
    .map((message) =>
      typeof message.content === "string"
        ? message.content
        : JSON.stringify(message.content),
    )
    .join("\n");

describe("QA F-99: a founder's own pitch video is reviewed from its transcript", () => {
  it("the live ask reads their own pitches by code and gives the model the words", async () => {
    const { seam, request, alpha, executed } = build(LIVE_ASK);
    await seam.answer(request);
    expect(executed).toContainEqual({
      name: "read_company_pitches",
      arguments: { companyId: COMPANY },
    });
    const prompt = promptOf(alpha);
    expect(prompt).toContain("THEIR OWN PITCH VIDEO");
    expect(prompt).toContain("[0:06] We run 96 solar kiosks");
    expect(prompt).toContain("first 15 seconds");
  });

  it("a question not about their pitch reads no pitch", async () => {
    const { seam, request, executed } = build("Who can see my data room?");
    await seam.answer(request);
    expect(executed.map(({ name }) => name)).not.toContain(
      "read_company_pitches",
    );
  });
});

describe("asksAboutOwnPitch", () => {
  it("knows the ways a founder asks about their own pitch", () => {
    expect(asksAboutOwnPitch(LIVE_ASK)).toBe(true);
    expect(asksAboutOwnPitch("Critique my pitch video")).toBe(true);
    expect(asksAboutOwnPitch("review our pitch")).toBe(true);
    expect(asksAboutOwnPitch("Is the pitch video any good?")).toBe(true);
  });
  it("leaves other asks alone", () => {
    expect(asksAboutOwnPitch("Who can see my data room?")).toBe(false);
    expect(asksAboutOwnPitch("Show me pitches like Maji Loop")).toBe(false);
  });
});

describe("ownPitchReviewFact", () => {
  it("says a pitch with no transcript is unknown, never silent", () => {
    const fact = ownPitchReviewFact({
      pitches: [{ title: null, transcript: "PENDING", segments: [] }],
    });
    expect(fact?.statement).toContain("Pitch 1: no transcript yet");
    expect(fact?.truthClass).toBe("USER_CLAIM");
  });
  it("is nothing with no pitch", () => {
    expect(ownPitchReviewFact({ pitches: [] })).toBeNull();
    expect(ownPitchReviewFact(null)).toBeNull();
  });
});
