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
import { TENANT, testCatalog, USER } from "./fixtures.js";

/**
 * QA open item (b), live 2026-10-01: "yes, go ahead" with nothing waiting
 * was answered "The reminder has been saved". COMPANY_ANALYST v15 marks a
 * reply about whether a change is saved, approved or waiting
 * (proposalStatus); the model's own status sentence goes out as
 * actionTalk, and the status said is the Approval Engine's, read from the
 * conversation's receipts.
 */

const RUN = randomUUID();
const CONVERSATION = randomUUID();
const COMPANY = randomUUID();
const RELATIONSHIP = randomUUID();

const RELATIONSHIP_TOOL: QOfferedTool = {
  toolName: "relationship.get",
  toolVersion: 1,
  classification: "READ_ONLY",
  definition: {
    name: "get_relationship",
    description: "Where the person's own side stands with a counterparty.",
    inputJsonSchema: { type: "object", properties: {} },
  },
  visibleStage: "REVIEWING_RELATIONSHIP",
};

const STANDING_TOOL: QOfferedTool = {
  ...RELATIONSHIP_TOOL,
  toolName: "relationship.list_mine",
  definition: {
    name: "list_my_relationships",
    description: "The person's own relationships, saves and passes.",
    inputJsonSchema: { type: "object", properties: {} },
  },
};

const OTHER = randomUUID();
const STANDING = {
  yourSide: "INVESTOR",
  relationships: [
    {
      relationshipId: RELATIONSHIP,
      counterpart: { kind: "COMPANY", id: OTHER, name: "Kora" },
      state: "INTEREST_EXPRESSED",
      stateSince: "2026-09-24T10:00:00.000Z",
      milestones: [],
      nextStep: "AWAIT_ANSWER",
    },
  ],
  saved: [{ companyId: OTHER, name: "Kora", stageCode: null }],
  passed: [{ companyId: COMPANY, name: "Ajopot", stageCode: null }],
  truthClass: "VERIFIED",
  source: "Capital Q relationship history",
};

const CONNECTED = {
  yourSide: "INVESTOR",
  counterpart: { kind: "COMPANY", id: COMPANY, name: "Kora" },
  relationship: {
    state: "CONNECTED",
    stateSince: "2026-09-25T11:00:00.000Z",
    milestones: [
      { state: "DISCOVERED", at: "2026-09-20T09:00:00.000Z" },
      { state: "INTEREST_EXPRESSED", at: "2026-09-24T10:00:00.000Z" },
      { state: "CONNECTED", at: "2026-09-25T11:00:00.000Z" },
    ],
    nextStep: "SCHEDULE_MEETING",
  },
  truthClass: "VERIFIED",
  source: "Capital Q relationship history",
};

type Subject =
  | { readonly kind: "COMPANY"; readonly companyId: string }
  | { readonly kind: "RELATIONSHIP"; readonly relationshipId: string };

function build(
  read: { status: "SUCCEEDED" | "DENIED"; data?: unknown },
  subject: Subject = { kind: "COMPANY", companyId: COMPANY },
  answer: Record<string, unknown> = {},
  proposals: readonly { id: string; status: string }[] = [],
  options: {
    readonly said?: string;
    readonly deps?: Partial<Parameters<typeof createModelGatewayQAnswer>[0]>;
  } = {},
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
          ...answer,
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
  const earlier = proposals.map(
    (proposal) =>
      ({
        id: randomUUID(),
        tenantId: TENANT,
        conversationId: CONVERSATION,
        runId: RUN,
        role: "Q",
        content: "Prepared.",
        contentType: "TEXT",
        createdAt: new Date().toISOString(),
        blocks: [
          {
            kind: "ACTION_PROPOSAL",
            proposal: {
              contractVersion: 1,
              proposalId: proposal.id,
              runId: randomUUID(),
              actionType: "reminder.set",
              actionClass: "CONFIRM_REQUIRED",
              targets: [{ kind: "COMPANY", companyId: COMPANY }],
              summary: "Reminder: call Ada at 3pm",
              approval: { required: true },
              status: "PROPOSED",
              createdAt: "2026-10-01T09:00:00.000Z",
            },
          },
        ],
      }) as unknown as QConversationMessage,
  );
  const messages = [
    ...earlier,
    {
      id: randomUUID(),
      tenantId: TENANT,
      conversationId: CONVERSATION,
      runId: RUN,
      role: "USER",
      content: options.said ?? "Where are we with Kora?",
      contentType: "TEXT",
      createdAt: new Date().toISOString(),
    } as unknown as QConversationMessage,
  ];
  const executed: QToolProposal[] = [];
  const stored: string[] = [];
  const tools: QToolPort = {
    offer: () => Promise.resolve([RELATIONSHIP_TOOL, STANDING_TOOL]),
    execute: (proposal) => {
      executed.push(proposal);
      const outcome: QToolCallOutcome = {
        callId: proposal.callId,
        toolName: "relationship.get",
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
            : {
                ok: true,
                data:
                  proposal.name === "list_my_relationships"
                    ? STANDING
                    : read.data,
              },
        latencyMs: 2,
      } as QToolCallOutcome;
      return Promise.resolve(outcome);
    },
  };
  const repositories = {
    messages: {
      listForRun: () => Promise.resolve([...messages]),
      listRecentForConversationOfRun: () => Promise.resolve([...messages]),
      insert: (_tx: unknown, input: { content: string }) => {
        stored.push(input.content);
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
    ...options.deps,
    gateway,
    repositories,
    sql: {} as never,
    transactions: { run: (work) => work({} as never) },
    tools,
    receipts: {
      artifact: () => Promise.resolve(null),
      action: (_actor, id) =>
        Promise.resolve(
          proposals.find((proposal) => proposal.id === id) ?? null,
        ),
    },
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
  return { seam, request, alpha, executed, stored };
}

const CLAIM = "The reminder has been saved.";
const ANSWER = {
  answer: `${CLAIM} Anything else for today?`,
  actionTalk: [CLAIM],
  proposalStatus: true,
};
const PROPOSAL = randomUUID();
const RELATIONSHIP_NONE = { ...CONNECTED, relationship: null };

describe("a reply about a change's status says the engine's status", () => {
  it("with the reminder still waiting: the false 'saved' goes, and it says it is waiting", async () => {
    const { seam, request, stored } = build(
      { status: "SUCCEEDED", data: RELATIONSHIP_NONE },
      undefined,
      ANSWER,
      [{ id: PROPOSAL, status: "PENDING" }],
    );
    expect((await seam.answer(request)).kind).toBe("ANSWERED");
    const reply = stored.at(-1) ?? "";
    expect(reply).not.toContain(CLAIM);
    expect(reply).toContain("Anything else for today?");
    expect(reply).toContain(
      '"Reminder: call Ada at 3pm" is waiting for your approval, not saved yet.',
    );
  });

  it("with nothing prepared in the conversation: says nothing is waiting or saved", async () => {
    const { seam, request, stored } = build(
      { status: "SUCCEEDED", data: RELATIONSHIP_NONE },
      undefined,
      ANSWER,
    );
    expect((await seam.answer(request)).kind).toBe("ANSWERED");
    const reply = stored.at(-1) ?? "";
    expect(reply).not.toContain(CLAIM);
    expect(reply).toContain(
      "Nothing is waiting for your approval in this conversation, and nothing has been saved here.",
    );
  });

  it("QA 5fd903d3: with nothing waiting, the model's 'still needs your approval' goes too, and its offer follows the status line", async () => {
    const claim = "I've updated your Q Card so search engines can find it.";
    const { seam, request, stored } = build(
      { status: "SUCCEEDED", data: RELATIONSHIP_NONE },
      undefined,
      {
        answer: `${claim} The change still needs your approval before it is saved. Want me to update the Q Card now?`,
        actionTalk: [claim],
        proposalStatus: true,
      },
    );
    expect((await seam.answer(request)).kind).toBe("ANSWERED");
    const reply = stored.at(-1) ?? "";
    expect(reply).not.toContain(claim);
    expect(reply).not.toContain("still needs your approval");
    expect(reply).toBe(
      "Nothing is waiting for your approval in this conversation, and nothing has been saved here.\n\nWant me to update the Q Card now?",
    );
  });

  it("run 5dd9bec5: a request answered with nothing but the status line says plainly what Q couldn't do", async () => {
    const said =
      "Ask Ledgerfold for their last 12 months of management accounts.";
    const { seam, request, stored } = build(
      { status: "SUCCEEDED", data: RELATIONSHIP_NONE },
      undefined,
      {
        // The model's own line was all approval talk, and is removed.
        answer: "Nothing is waiting for your approval right now.",
        proposalStatus: true,
      },
      [],
      { said },
    );
    expect(
      (await seam.answer({ ...request, turnKind: "TOOL_REQUEST" })).kind,
    ).toBe("ANSWERED");
    const reply = stored.at(-1) ?? "";
    expect(reply).not.toContain("Nothing is waiting for your approval");
    expect(reply).toBe(
      "Nothing was prepared or changed yet. What should I take on: one thing now, or should I work on it for you over time? Say which, and I'll prepare it for your approval.",
    );
  });

  it("run 9b4ef8d1: model text that isn't an answer plus the status line gets the could-not line instead of the status", async () => {
    const said =
      "Share our financial model with Savanna Seed Partners (fictional).";
    const { seam, request, stored } = build(
      { status: "SUCCEEDED", data: RELATIONSHIP_NONE },
      undefined,
      {
        answer: "Your Ajopot financial model is active and shareable.",
        proposalStatus: true,
      },
      [],
      { said },
    );
    await seam.answer({ ...request, turnKind: "TOOL_REQUEST" });
    const reply = stored.at(-1) ?? "";
    expect(reply).not.toContain("Nothing is waiting for your approval");
    expect(reply).toBe(
      "Your Ajopot financial model is active and shareable.\n\nNothing was prepared or changed yet. What should I take on: one thing now, or should I work on it for you over time? Say which, and I'll prepare it for your approval.",
    );
  });

  it("a question about a change's status still gets the status line", async () => {
    const { seam, request, stored } = build(
      { status: "SUCCEEDED", data: RELATIONSHIP_NONE },
      undefined,
      ANSWER,
    );
    await seam.answer({ ...request, turnKind: "QUESTION_TO_Q" });
    expect(stored.at(-1)).toContain(
      "Nothing is waiting for your approval in this conversation",
    );
  });

  it("a saved one is said as saved, from its record", async () => {
    const { seam, request, stored } = build(
      { status: "SUCCEEDED", data: RELATIONSHIP_NONE },
      undefined,
      ANSWER,
      [{ id: PROPOSAL, status: "SAVED" }],
    );
    await seam.answer(request);
    expect(stored.at(-1)).toContain('"Reminder: call Ada at 3pm" is saved.');
  });

  it("adds nothing when the reply is not about a change's status", async () => {
    const { seam, request, stored } = build(
      { status: "SUCCEEDED", data: RELATIONSHIP_NONE },
      undefined,
      { proposalStatus: false },
      [{ id: PROPOSAL, status: "PENDING" }],
    );
    await seam.answer(request);
    expect(stored.at(-1)).toBe("You connected with Kora on 25 September.");
  });
});

describe("a change prepared this turn is not told 'nothing is waiting' (live 2026-10-02)", () => {
  it("says no status line when the description is handed to the proposer in this turn", async () => {
    const said =
      "Write a short description of my company and save it. I approve it.";
    const noted: unknown[] = [];
    const { seam, request, stored } = build(
      { status: "SUCCEEDED", data: RELATIONSHIP_NONE },
      undefined,
      {
        answer: "Here is a short description: Nixo runs FDEOps for teams.",
        actionTalk: ["I've saved it."],
        proposalStatus: true,
        profileUpdates: [
          {
            field: "shortDescription",
            value: "Nixo runs FDEOps for forward-deployed teams.",
            quote: "save it. I approve it.",
          },
        ],
      },
      [],
      {
        said,
        deps: {
          profileUpdates: {
            note: (entry) => {
              noted.push(entry);
            },
          },
        },
      },
    );
    expect((await seam.answer(request)).kind).toBe("ANSWERED");
    expect(noted).toHaveLength(1);
    const reply = stored.at(-1) ?? "";
    expect(reply).not.toContain("Nothing is waiting for your approval");
    expect(reply).toContain("Here is a short description");
  });
});

describe("saving is not verifying (live 2026-10-02, Nixo)", () => {
  it("tells Q, on the founder's exact words, to prepare the save and not argue about verification", async () => {
    const said =
      "Regardless of whether it is verified or not, I'm giving you the permission to do so.";
    const { seam, request, alpha } = build(
      { status: "SUCCEEDED", data: RELATIONSHIP_NONE },
      undefined,
      {},
      [],
      { said },
    );
    expect((await seam.answer(request)).kind).toBe("ANSWERED");
    const sent = alpha.calls
      .flatMap((call) => call.request.messages.map((m) => m.content))
      .join("\n");
    expect(sent).toContain(said);
    expect(sent).toContain("SAVING IS NOT VERIFYING");
    expect(sent).toContain(
      "I'll save these as your stated company details (not independently verified).",
    );
    expect(sent).toContain(
      "Never argue about verification once they have said to save.",
    );
  });
});
