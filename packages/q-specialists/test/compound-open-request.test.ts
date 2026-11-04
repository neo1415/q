import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  PermittedContextPlanSchema,
  Q_CONTEXT_FIREWALL_POLICY_VERSION,
  type QRecordPage,
  type QResultBlock,
} from "@capital-q/contracts";
import type { QTurnReader, QTurnReading } from "@capital-q/model-gateway/q";
import type {
  QAnswerOutcome,
  QAnswerRequest,
  QConversationMessage,
  QRuntimeRepositories,
} from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import {
  createSpecialistQAnswer,
  movedButNotAnsweredLine,
  questionAfterMove,
} from "../src/answer.js";
import type { QOpenRecordPort } from "../src/references.js";

/**
 * A3 (rehearsal 2026-11-04): "Open Ledgerline's company profile and show
 * the financials" opened the profile and stored only "Opening Ledgerline…";
 * the financials were dropped with no mention. Both parts are done (the
 * move goes with the answer to the rest), or Q says plainly what was done
 * and why the rest was not. A move never stands alone as if it were all.
 */

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const LEDGERLINE = "6a1f7e2a-0c1d-4b5e-9a7f-2b3c4d5e6f71";
const ASKED = "Open Ledgerline's company profile and show the financials";

const actor = ActorContextSchema.parse({
  userId: USER,
  tenantId: TENANT,
  organisationId: "a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0",
  membershipId: "a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2",
  actorType: "HUMAN",
});

/** An investor's run: their own investor organisation is in the plan. */
function request(): QAnswerRequest {
  const asked = base();
  return {
    ...asked,
    plan: {
      ...asked.plan,
      scopes: [
        {
          kind: "INVESTOR_MANDATE",
          subject: {
            kind: "INVESTOR_ORGANISATION",
            investorOrganisationId: actor.organisationId,
          },
        } as unknown as QAnswerRequest["plan"]["scopes"][number],
      ],
    },
  };
}

function base(): QAnswerRequest {
  const runId = randomUUID();
  return {
    runId: runId as QAnswerRequest["runId"],
    tenantId: TENANT as QAnswerRequest["tenantId"],
    actorUserId: USER as QAnswerRequest["actorUserId"],
    actor,
    correlationId: "cor_test",
    capability: "ANSWER",
    subjects: [],
    retrieval: { kind: "NOT_CONFIGURED" },
    plan: PermittedContextPlanSchema.parse({
      contractVersion: 1,
      policyVersion: Q_CONTEXT_FIREWALL_POLICY_VERSION,
      planId: randomUUID(),
      fingerprint: "0".repeat(64),
      runId,
      tenantId: TENANT,
      actor: { userId: USER, organisationId: actor.organisationId },
      purpose: { capability: "ANSWER", taskClass: "GENERAL_QUESTION" },
      subjects: [],
      scopes: [],
      denied: [],
      maxSensitivity: "CONFIDENTIAL",
      allowedLayers: [],
      combinationConstraints: [],
      evaluatedAt: new Date().toISOString(),
      revalidateAfter: new Date(Date.now() + 60_000).toISOString(),
      revalidateOnResume: true,
    }),
  };
}

/** The reader as it reads the ask: open one company, Ledgerline. */
const READING = {
  kind: "TOOL_REQUEST",
  confidence: "HIGH",
  transcript: "CLEAR",
  question: null,
  aboutNamedOther: false,
  tool: null,
  reference: {
    open: "COMPANY",
    name: "Ledgerline",
    shown: null,
    retryLast: false,
    sameFor: null,
  },
} as unknown as QTurnReading;

function conversation(options: {
  /** Whether open_page authorises Ledgerline's profile for them. */
  readonly openable: boolean;
  readonly counterparts?: readonly string[];
  readonly delegate?: () => QAnswerOutcome;
}) {
  const conversationId = randomUUID();
  const lines: QConversationMessage[] = [];
  const opened: { page: QRecordPage; name?: string }[] = [];
  const leadBlocks: (readonly QResultBlock[] | undefined)[] = [];
  const turns: QTurnReader = { read: () => Promise.resolve(READING) };
  const port: QOpenRecordPort = {
    open: (_request, target) => {
      opened.push({
        page: target.page,
        ...(target.name === undefined ? {} : { name: target.name }),
      });
      return Promise.resolve(
        options.openable &&
          target.page === "COMPANY" &&
          (target.name === "Ledgerline" || target.id === LEDGERLINE)
          ? { kind: "OPEN_RECORD_PAGE", page: "COMPANY", id: LEDGERLINE }
          : null,
      );
    },
  };
  const answer = createSpecialistQAnswer({
    specialist: {
      id: "company-intelligence",
      version: "v1",
      supports: () => false,
      investigate: () => Promise.reject(new Error("not used")),
    },
    delegate: {
      answer: (req) => {
        leadBlocks.push(req.leadBlocks);
        return Promise.resolve(
          options.delegate?.() ?? {
            kind: "ANSWERED",
            messageId: "m",
            modelPolicyVersion: "p",
            promptBundleVersion: "b",
          },
        );
      },
    },
    repositories: {
      messages: {
        listRecentForConversationOfRun: () => Promise.resolve([...lines]),
        insert: (_tx: unknown, input: Omit<QConversationMessage, "id">) => {
          const row = {
            ...input,
            id: randomUUID(),
            contentType: "TEXT",
            createdAt: new Date().toISOString(),
          } as unknown as QConversationMessage;
          lines.push(row);
          return Promise.resolve(row);
        },
      },
      runs: { allocateEventSequence: () => Promise.resolve(1) },
      runEvents: {
        append: (_tx: unknown, input: unknown) => Promise.resolve(input),
      },
    } as unknown as QRuntimeRepositories,
    sql: {} as never,
    transactions: { run: (work) => work({} as never) },
    turns,
    offeredTools: () => Promise.resolve(["open_page"]),
    openRecord: port,
    counterpartNames: () =>
      Promise.resolve(options.counterparts ?? ["Ledgerline"]),
  });
  const say = async (said: string) => {
    lines.push({
      tenantId: TENANT,
      conversationId,
      runId: randomUUID(),
      contentType: "TEXT",
      createdAt: new Date().toISOString(),
      id: randomUUID(),
      role: "USER",
      content: said,
    } as unknown as QConversationMessage);
    const outcome = await answer.answer(request());
    return {
      outcome,
      qLines: lines.filter((line) => line.role === "Q"),
    };
  };
  return { say, opened, leadBlocks };
}

const intentsOf = (blocks: readonly QResultBlock[] | undefined) =>
  (blocks ?? []).flatMap((block) =>
    block.kind === "UI_INTENT" ? [block.intent] : [],
  );

describe("A3: a move with more asked after it", () => {
  it("reads a later 'show …' that is no page or tab as more asked", () => {
    expect(questionAfterMove(ASKED)).toBe(true);
    expect(questionAfterMove("Open Ledgerline and show me their numbers")).toBe(
      true,
    );
    expect(
      questionAfterMove("open the data room and tell me what's missing"),
    ).toBe(true);
    // A tab or a page after the move is still only a move.
    expect(questionAfterMove("Open Ledgerline and show me the deck")).toBe(
      false,
    );
    expect(questionAfterMove("Open Ledgerline then show me Discover")).toBe(
      false,
    );
    expect(questionAfterMove("Open Ledgerline's company profile")).toBe(false);
  });

  it("both parts: the profile opens with the answer to the rest, and code never says it alone", async () => {
    const q = conversation({ openable: true });
    const { outcome, qLines } = await q.say(ASKED);
    expect(outcome.kind).toBe("ANSWERED");
    // One answer, the delegate's, carrying the authorised move.
    expect(q.leadBlocks).toHaveLength(1);
    expect(intentsOf(q.leadBlocks[0])).toEqual([
      { kind: "OPEN_RECORD_PAGE", page: "COMPANY", id: LEDGERLINE },
    ]);
    // No "Opening Ledgerline…" stored by code as if it were the answer.
    expect(qLines).toEqual([]);
  });

  it("the rest not answered (figures not authorised): says what opened and why the rest did not", async () => {
    const q = conversation({
      openable: true,
      delegate: () => ({ kind: "FAILED", diagnosticCode: "POLICY_DENIED" }),
    });
    const { outcome, qLines } = await q.say(ASKED);
    expect(outcome.kind).toBe("ANSWERED");
    expect(qLines).toHaveLength(1);
    const said = qLines[0]?.content ?? "";
    expect(said).toBe(movedButNotAnsweredLine("Ledgerline", "POLICY_DENIED"));
    expect(said).toMatch(
      /^I've opened Ledgerline, but I couldn't do the rest/u,
    );
    expect(said).toMatch(/because that isn't something I can access/u);
    expect(intentsOf(qLines[0]?.blocks)).toEqual([
      { kind: "OPEN_RECORD_PAGE", page: "COMPANY", id: LEDGERLINE },
    ]);
  });

  it("a cancelled run says nothing more", async () => {
    const q = conversation({
      openable: true,
      delegate: () => ({ kind: "FAILED", diagnosticCode: "RUN_CANCELLED" }),
    });
    const { outcome, qLines } = await q.say(ASKED);
    expect(outcome).toEqual({
      kind: "FAILED",
      diagnosticCode: "RUN_CANCELLED",
    });
    expect(qLines).toEqual([]);
  });

  it("target missing: nothing opens and nothing claims it did", async () => {
    const q = conversation({ openable: false, counterparts: [] });
    const { qLines } = await q.say(ASKED);
    for (const line of qLines) {
      expect(line.content).not.toMatch(/^Opening\b|I've opened/u);
      expect(intentsOf(line.blocks)).toEqual([]);
    }
    for (const blocks of q.leadBlocks) expect(intentsOf(blocks)).toEqual([]);
  });

  it("a plain open is still only the move", async () => {
    const q = conversation({ openable: true });
    const { qLines } = await q.say("Open Ledgerline.");
    expect(q.leadBlocks).toHaveLength(0);
    expect(qLines).toHaveLength(1);
    expect(qLines[0]?.content).toMatch(/^Opening Ledgerline/u);
    expect(intentsOf(qLines[0]?.blocks)).toEqual([
      { kind: "OPEN_RECORD_PAGE", page: "COMPANY", id: LEDGERLINE },
    ]);
  });

  it("names the page when no record was opened", () => {
    expect(movedButNotAnsweredLine(undefined, "MODEL_PROVIDER_TIMEOUT")).toBe(
      "I've opened the page you asked for, but I couldn't do the rest of what you asked because my reasoning service didn't answer in time. Ask me again and I'll try once more.",
    );
  });
});
