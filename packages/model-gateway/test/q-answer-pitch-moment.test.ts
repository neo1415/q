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
  QToolProposal,
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
import { clock, pitchMomentFact } from "../src/q/pitch-moment-fact.js";
import { TENANT, testCatalog, USER } from "./fixtures.js";

/**
 * Q watches the video with us (R18). When the run's plan carries the
 * viewed pitch moment -- which the Q API put there only after authorising
 * that pitch for this person -- Home Q reads the moment through the same
 * get_pitch_moment tool the model could call, and tells the model where
 * the person is and what is said there, labelled as the founder's own
 * machine-transcribed words. Without the moment, nothing is read; with no
 * transcript, the fact says so rather than implying silence.
 */

const RUN = randomUUID();
const CONVERSATION = randomUUID();
const COMPANY = randomUUID();

const PITCH = randomUUID();
const PITCH_TOOL: QOfferedTool = {
  toolName: "pitch.moment.get",
  toolVersion: 1,
  classification: "READ_ONLY",
  definition: {
    name: "get_pitch_moment",
    description: "What is said in the pitch being viewed around a moment.",
    inputJsonSchema: { type: "object", properties: {} },
  },
  visibleStage: "REVIEWING_COMPANY",
};

const MOMENT = {
  pitchId: PITCH,
  atSeconds: 102,
  transcript: "AVAILABLE",
  segments: [
    { fromSeconds: 100, toSeconds: 104, text: "Our revenue grew three times" },
    { fromSeconds: 104, toSeconds: 107.25, text: "last year and margins held" },
  ],
  source: "Machine-generated transcript of the pitch video",
  truthClass: "USER_CLAIM",
};

type Subject =
  | { readonly kind: "COMPANY"; readonly companyId: string }
  | { readonly kind: "RELATIONSHIP"; readonly relationshipId: string };

function build(
  read: { status: "SUCCEEDED" | "DENIED"; data?: unknown },
  subject: Subject = { kind: "COMPANY", companyId: COMPANY },
  viewing: boolean = true,
) {
  const alpha = createFakeModelProvider({
    code: "alpha",
    script: [
      {
        kind: "TEXT",
        text: JSON.stringify({
          answer: "You connected with Kora on 25 September.",
          responseShape: "CONCISE",
          insufficientEvidence: false,
          recommendation: null,
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
      content: "What did they just say about revenue?",
      contentType: "TEXT",
      createdAt: new Date().toISOString(),
    } as unknown as QConversationMessage,
  ];
  const executed: QToolProposal[] = [];
  const tools: QToolPort = {
    offer: () => Promise.resolve([PITCH_TOOL]),
    execute: (proposal) => {
      executed.push(proposal);
      const outcome: QToolCallOutcome = {
        callId: proposal.callId,
        toolName: "pitch.moment.get",
        toolVersion: 1,
        classification: "READ_ONLY",
        status: read.status,
        failureCode: read.status === "DENIED" ? "NOT_AVAILABLE" : null,
        sensitivity: read.status === "DENIED" ? null : "CONFIDENTIAL",
        result:
          read.status === "DENIED"
            ? {
                ok: false,
                error: {
                  code: "NOT_AVAILABLE",
                  message: "Not available in this conversation's context.",
                },
              }
            : { ok: true, data: read.data },
        latencyMs: 2,
      } as QToolCallOutcome;
      return Promise.resolve(outcome);
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
    subjects: [subject],
    retrieval: { kind: "NOT_CONFIGURED" },
    plan: {
      runId: RUN,
      tenantId: TENANT,
      actor: { userId: USER },
      purpose: {
        capability: "ANSWER",
        taskClass:
          subject.kind === "RELATIONSHIP"
            ? "RELATIONSHIP_QUESTION"
            : "COUNTERPARTY_COMPANY_QUESTION",
      },
      subjects: [subject],
      ...(viewing
        ? {
            viewing: {
              kind: "PITCH_PLAYBACK",
              companyId: COMPANY,
              mediaAssetId: PITCH,
              positionSeconds: 102,
            },
          }
        : {}),
      scopes: [
        {
          kind:
            subject.kind === "RELATIONSHIP"
              ? "RELATIONSHIP_CONTEXT"
              : "COMPANY_PROFILE",
          subject,
        },
      ],
      denied: [],
      // The test catalogue routes PUBLIC only, as the own-profile test does.
      maxSensitivity: "PUBLIC",
    } as unknown as PermittedContextPlan,
  } as unknown as QAnswerRequest;
  return { seam, request, alpha, executed };
}

const sentTo = (alpha: ReturnType<typeof build>["alpha"]) =>
  alpha.calls
    .flatMap((call) => call.request.messages.map((m) => m.content))
    .join("\n");

describe("Home Q knows where the person is in the pitch", () => {
  it("reads the viewed moment through get_pitch_moment and states it among the facts", async () => {
    const { seam, request, alpha, executed } = build({
      status: "SUCCEEDED",
      data: MOMENT,
    });
    expect((await seam.answer(request)).kind).toBe("ANSWERED");
    expect(executed.map((call) => [call.name, call.arguments])).toEqual([
      [
        "get_pitch_moment",
        { pitchId: PITCH, atSeconds: 102, windowSeconds: 20 },
      ],
    ]);
    const sent = sentTo(alpha);
    const facts = sent.slice(sent.indexOf("AUTHORISED FACTS"));
    expect(facts).toContain("currently at 1:42");
    // The fact is fenced as untrusted data, so its quotes arrive escaped.
    expect(facts).toContain("[1:40-1:44]");
    expect(facts).toContain("Our revenue grew three times");
    expect(facts).toContain("not verified");
  });

  it("reads nothing without an authorised viewing moment", async () => {
    const { seam, request, executed, alpha } = build(
      { status: "SUCCEEDED", data: MOMENT },
      { kind: "COMPANY", companyId: COMPANY },
      false,
    );
    await seam.answer(request);
    expect(executed).toEqual([]);
    expect(sentTo(alpha)).not.toContain("currently at");
  });

  it("adds nothing when the read is refused", async () => {
    const { seam, request, alpha } = build({ status: "DENIED" });
    await seam.answer(request);
    expect(sentTo(alpha)).not.toContain("currently at");
  });
});

describe("pitchMomentFact", () => {
  it("never turns no transcript into silence", () => {
    const none = pitchMomentFact(
      { ...MOMENT, transcript: "UNKNOWN", segments: [] },
      "Kora",
    );
    expect(none?.statement).toContain("Kora's pitch video, currently at 1:42");
    expect(none?.statement).toContain("unknown");
    expect(none?.statement).toContain("never that nothing was said");
    const pending = pitchMomentFact(
      { ...MOMENT, transcript: "PENDING", segments: [] },
      null,
    );
    expect(pending?.statement).toContain("still being prepared");
    // A pause with a transcript is different: nobody speaking then.
    const pause = pitchMomentFact({ ...MOMENT, segments: [] }, null);
    expect(pause?.statement).toContain("Nobody is speaking");
    expect(pause).toMatchObject({
      truthClass: "USER_CLAIM",
      evidenceStatus: "SELF_REPORTED",
    });
  });

  it("formats clock times", () => {
    expect(clock(0)).toBe("0:00");
    expect(clock(102)).toBe("1:42");
    expect(clock(3725)).toBe("1:02:05");
  });
});
