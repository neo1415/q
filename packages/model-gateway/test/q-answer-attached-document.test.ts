import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { PermittedContextPlan } from "@capital-q/contracts";
import type {
  QAnswerRequest,
  QConversationMessage,
  QOfferedTool,
  QRuntimeRepositories,
  QToolPort,
  QToolProposal,
} from "@capital-q/q-runtime";
import {
  createReadAttachedDocumentTool,
  type AttachedDocumentsPort,
} from "@capital-q/q-tools";
import { ActorContextSchema } from "@capital-q/security";

import {
  createFakeModelProvider,
  createInMemoryModelUsageRepository,
  createModelGateway,
  createModelProviderRegistry,
  createStaticModelCatalog,
  type FakeBehaviour,
} from "../src/index.js";
import { createModelGatewayQAnswer } from "../src/q/index.js";
import { TENANT, testCatalog, USER } from "./fixtures.js";

/**
 * Lane 8 (owner's boss, 2026-10-22): "I uploaded a document, it attached,
 * but nothing happened." A document attached in the composer is read for
 * the person before the model is asked (the real read_attached_document
 * tool, through a port that answers as Evidence would), so the first
 * answer is about it; a follow-up is answered from it too; and a later
 * conversation finds it again by its name. The model here is fake and
 * timed; nothing reaches a provider.
 */

const DOC = "d0000000-0000-4000-8000-0000000000a1";

const OFFERED: QOfferedTool = {
  toolName: "documents.attached.read",
  toolVersion: 1,
  classification: "READ_ONLY",
  definition: {
    name: "read_attached_document",
    description: "Reads a document they attached to Q.",
    inputJsonSchema: { type: "object", properties: {} },
  },
  visibleStage: "CHECKING_EVIDENCE",
};

/** Their term sheet, as Evidence and the pipeline's pages would give it. */
const port: AttachedDocumentsPort & { asked: unknown[] } = {
  asked: [],
  read(actor, request) {
    port.asked.push({ userId: actor.userId, ...request });
    const found =
      request.documentId === DOC ||
      (request.name?.toLowerCase().includes("term") ?? false);
    return Promise.resolve({
      document: found
        ? {
            documentId: DOC,
            title: "Term sheet",
            filename: "term-sheet.pdf",
            uploadedAt: "2026-10-22T09:00:00.000Z",
            state: "READ",
            pageCount: 2,
            whole: true,
            pages: [
              {
                page: 1,
                text: "Series A term sheet for Ajopot. Pre-money valuation $8m.",
              },
              {
                page: 2,
                text: "1x non-participating liquidation preference. Pro-rata rights for the lead.",
              },
            ],
          }
        : null,
      others: [],
    });
  },
};

const tool = createReadAttachedDocumentTool(port);

const analyst = (answer: string): FakeBehaviour => ({
  kind: "JSON",
  value: {
    answer,
    responseShape: "CONCISE",
    findings: [],
    missingEvidence: [],
    contradictions: [],
    insufficientEvidence: false,
    recommendation: null,
    clarifyingQuestions: [],
    declined: false,
  },
});

function build(scene: {
  readonly said: string;
  readonly attached: readonly string[];
  readonly script: readonly FakeBehaviour[];
}) {
  const alpha = createFakeModelProvider({
    code: "alpha",
    script: scene.script,
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
  const run = randomUUID();
  const conversation = randomUUID();
  const messages = [
    {
      id: randomUUID(),
      tenantId: TENANT,
      conversationId: conversation,
      runId: run,
      role: "USER",
      content: scene.said,
      contentType: "TEXT",
      createdAt: new Date().toISOString(),
    } as unknown as QConversationMessage,
  ];
  const actor = ActorContextSchema.parse({
    userId: USER,
    tenantId: TENANT,
    actorType: "HUMAN",
  });
  const executed: QToolProposal[] = [];
  const persisted: string[] = [];
  const tools: QToolPort = {
    offer: () => Promise.resolve([OFFERED]),
    execute: async (proposal) => {
      executed.push(proposal);
      // The real tool's own execute, as the executor would run it.
      const data = await tool.execute(
        proposal.arguments,
        { actor } as never,
        null,
      );
      return {
        callId: proposal.callId,
        toolName: "documents.attached.read",
        toolVersion: 1,
        classification: "READ_ONLY",
        status: "SUCCEEDED",
        failureCode: null,
        sensitivity: "CONFIDENTIAL",
        result: { ok: true, data },
        latencyMs: 1,
      };
    },
  };
  const repositories = {
    messages: {
      listForRun: () => Promise.resolve([...messages]),
      listRecentForConversationOfRun: () => Promise.resolve([...messages]),
      insert: (_tx: unknown, input: { content: string }) => {
        persisted.push(input.content);
        return Promise.resolve({
          ...messages[0],
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
  const seam = createModelGatewayQAnswer({
    gateway,
    repositories,
    sql: {} as never,
    transactions: { run: (work) => work({} as never) },
    tools,
  });
  const request = {
    runId: run,
    tenantId: TENANT,
    actorUserId: USER,
    actor,
    correlationId: `cor_${run}`,
    capability: "ANSWER",
    subjects: [],
    retrieval: { kind: "NOT_CONFIGURED" },
    plan: {
      runId: run,
      tenantId: TENANT,
      actor: { userId: USER },
      purpose: { capability: "ANSWER", taskClass: "GENERAL_QUESTION" },
      subjects: [],
      screen: {
        route: "HOME",
        ...(scene.attached.length === 0
          ? {}
          : { attachedDocumentIds: [...scene.attached] }),
      },
      scopes: [{ kind: "OWN_Q_CONVERSATION" }],
      denied: [],
      maxSensitivity: "PUBLIC",
    } as unknown as PermittedContextPlan,
  } as unknown as QAnswerRequest;
  return { seam, request, alpha, executed, persisted };
}

const sentTo = (alpha: ReturnType<typeof build>["alpha"]) =>
  alpha.calls
    .flatMap((call) => call.request.messages.map((m) => m.content))
    .join("\n");

describe("Q answers from a document the person attached", () => {
  it("Send on the document alone: it is read before the model is asked, and summarised", async () => {
    port.asked = [];
    const { seam, request, alpha, executed, persisted } = build({
      said: 'I\'ve attached "term-sheet.pdf". Tell me briefly what it is, the two or three things worth knowing, and what I could do next.',
      attached: [DOC],
      script: [
        analyst(
          "It's Ajopot's Series A term sheet: $8m pre-money (p. 1), a 1x non-participating preference and pro-rata for the lead (p. 2).",
        ),
      ],
    });
    const started = performance.now();
    const outcome = await seam.answer(request);
    const tookMs = performance.now() - started;
    expect(outcome.kind).toBe("ANSWERED");
    // Read once, by id, as the asker, with no tool round from the model.
    expect(executed).toEqual([
      expect.objectContaining({
        callId: "q-attached-0",
        name: "read_attached_document",
        arguments: expect.objectContaining({ documentId: DOC }) as unknown,
      }),
    ]);
    expect(alpha.calls).toHaveLength(1);
    const sent = sentTo(alpha);
    // The facts travel JSON-encoded inside the untrusted fence.
    expect(sent).toContain('ATTACHED BY THEM: \\"Term sheet\\", 2 pages');
    expect(sent).toContain("[p. 1] Series A term sheet for Ajopot.");
    expect(sent).toContain("never verified fact");
    // Owner 23 Oct: a bare upload is summarised first, not critiqued.
    expect(sent).toContain('THEY ATTACHED "Term sheet" AND WANT TO KNOW');
    expect(sent).toContain("Want my read on what's weak?");
    expect(persisted.join("\n")).toContain("(p. 1)");
    // Timed with the fake model: the read adds no model round.
    expect(tookMs).toBeLessThan(5_000);
    console.info(
      `[lane8] attached-only turn answered in ${tookMs.toFixed(0)} ms (fake model)`,
    );
  });

  it("a follow-up is answered from the same document, read where the question points", async () => {
    port.asked = [];
    const { seam, request, alpha } = build({
      said: "What's the liquidation preference?",
      attached: [DOC],
      script: [analyst("1x non-participating (p. 2).")],
    });
    expect((await seam.answer(request)).kind).toBe("ANSWERED");
    expect(port.asked).toEqual([
      expect.objectContaining({
        documentId: DOC,
        question: "What's the liquidation preference?",
      }),
    ]);
    expect(sentTo(alpha)).toContain("[p. 2] 1x non-participating");
    // A specific question is answered from it, with no unasked critique.
    expect(sentTo(alpha)).toContain("Add no critique they did not ask for");
  });

  it("a later conversation finds it again by its name", async () => {
    port.asked = [];
    const { seam, request, executed, persisted } = build({
      said: "In that term sheet I sent you, who gets pro-rata?",
      attached: [],
      script: [
        {
          kind: "TOOL_CALLS",
          calls: [
            {
              callId: "m1",
              name: "read_attached_document",
              arguments: { name: "term sheet" },
            },
          ],
        },
        analyst("The lead investor gets pro-rata rights (p. 2)."),
      ],
    });
    expect((await seam.answer(request)).kind).toBe("ANSWERED");
    expect(executed.map((call) => call.arguments)).toContainEqual({
      name: "term sheet",
    });
    expect(port.asked).toContainEqual(
      expect.objectContaining({ name: "term sheet" }),
    );
    expect(persisted.join("\n")).toContain("pro-rata");
  });

  it("an id that is not theirs adds nothing (Evidence refused it)", async () => {
    port.asked = [];
    const { seam, request, alpha } = build({
      said: "What does it say?",
      attached: ["d0000000-0000-4000-8000-0000000000ff"],
      script: [analyst("I can't find that document.")],
    });
    expect((await seam.answer(request)).kind).toBe("ANSWERED");
    expect(sentTo(alpha)).not.toContain("ATTACHED BY THEM");
  });
});
