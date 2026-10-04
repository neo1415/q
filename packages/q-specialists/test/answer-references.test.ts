import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  PermittedContextPlanSchema,
  Q_CONTEXT_FIREWALL_POLICY_VERSION,
  type QResultBlock,
} from "@capital-q/contracts";
import type { QTurnReader, QTurnReading } from "@capital-q/model-gateway/q";
import type {
  QAnswerRequest,
  QConversationMessage,
  QRuntimeRepositories,
} from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import { createSpecialistQAnswer } from "../src/answer.js";
import type { QAppActionPort, TurnAppAction } from "../src/app-action-turn.js";
import {
  openTarget,
  referenceNote,
  repeatedAction,
  shownItems,
  type QOpenRecordPort,
} from "../src/references.js";

/**
 * follow-55 (Zino live 2026-10-04): what a turn points back at -- one
 * record to open, or Q's last action again -- is bound by code to a record
 * of theirs or to that action. The phrasings are the founder's own, from
 * the logs. Deterministic doubles; code asserts.
 */

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const DOC = "8e4b6f4b-bd88-4ab1-8a4f-3d4e5f607182";
const NIXO = "d48c26d2-5aca-4788-9033-073b0f9d08ec";

const actor = ActorContextSchema.parse({
  userId: USER,
  tenantId: TENANT,
  organisationId: "a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0",
  membershipId: "a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2",
  actorType: "HUMAN",
});

function request(): QAnswerRequest {
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

const BASE: QTurnReading = {
  kind: "TOOL_REQUEST",
  confidence: "HIGH",
  transcript: "CLEAR",
  question: null,
  aboutNamedOther: false,
  tool: null,
} as unknown as QTurnReading;

type Line = {
  readonly role: "USER" | "Q";
  readonly content: string;
  readonly blocks?: readonly QResultBlock[];
};

/** One conversation: each turn is said, read as given, and answered. */
function conversation(options: {
  readonly openRecord?: QOpenRecordPort;
  readonly appActions?: QAppActionPort;
  readonly appActionArguments?: (
    request: QAnswerRequest,
    input: { readonly tool: string; readonly utterance: string },
  ) => Promise<Record<string, unknown> | null>;
  readonly appActionRouter?: () => Promise<string | null>;
  readonly earlier?: readonly Line[];
}) {
  const conversationId = randomUUID();
  const lines: QConversationMessage[] = (options.earlier ?? []).map(
    (line, index) =>
      ({
        id: randomUUID(),
        tenantId: TENANT,
        conversationId,
        runId: randomUUID(),
        role: line.role,
        content: line.content,
        contentType: "TEXT",
        createdAt: new Date(Date.now() - (100 - index) * 1000).toISOString(),
        ...(line.blocks === undefined ? {} : { blocks: line.blocks }),
      }) as QConversationMessage,
  );
  const notes: (string | undefined)[] = [];
  let reading: QTurnReading | null = null;
  const turns: QTurnReader = {
    read: (input) => {
      const last = input.recentTurns.at(-1);
      notes.push(
        last?.text.startsWith("[Q context]") === true ? last.text : undefined,
      );
      return Promise.resolve(reading);
    },
  };
  let delegated = 0;
  const answer = createSpecialistQAnswer({
    specialist: {
      id: "company-intelligence",
      version: "v1",
      supports: () => false,
      investigate: () => Promise.reject(new Error("not used")),
    },
    delegate: {
      answer: () => {
        delegated += 1;
        lines.push({
          ...(lines[0] as QConversationMessage),
          id: randomUUID() as QConversationMessage["id"],
          role: "Q",
          content: "An answer.",
        });
        return Promise.resolve({
          kind: "ANSWERED",
          messageId: "m",
          modelPolicyVersion: "p",
          promptBundleVersion: "b",
        });
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
    offeredTools: () =>
      Promise.resolve([
        "open_page",
        "change_my_mandate",
        "propose_express_interest",
      ]),
    ...(options.openRecord === undefined
      ? {}
      : { openRecord: options.openRecord }),
    ...(options.appActions === undefined
      ? {}
      : { appActions: options.appActions }),
    ...(options.appActionArguments === undefined
      ? {}
      : { appActionArguments: options.appActionArguments }),
    ...(options.appActionRouter === undefined
      ? {}
      : { appActionRouter: options.appActionRouter }),
  });
  const say = async (said: string, read: QTurnReading | null) => {
    lines.push({
      ...(lines[0] ?? {
        tenantId: TENANT,
        conversationId,
        runId: randomUUID(),
        contentType: "TEXT",
        createdAt: new Date().toISOString(),
      }),
      id: randomUUID(),
      role: "USER",
      content: said,
    } as QConversationMessage);
    reading = read;
    await answer.answer(request());
    return lines.at(-1);
  };
  return {
    say,
    notes,
    lines,
    delegated: () => delegated,
  };
}

describe("the conversation reference resolver", () => {
  const history = (lines: readonly Line[]): readonly QConversationMessage[] =>
    lines.map(
      (line) =>
        ({
          id: randomUUID(),
          role: line.role,
          content: line.content,
          blocks: line.blocks,
        }) as unknown as QConversationMessage,
    );

  it("lists what Q showed, newest answer first: document cards, then titles it quoted", () => {
    const shown = shownItems(
      history([
        { role: "Q", content: "Nixo and Yamfield Agro are connected." },
        {
          role: "Q",
          content:
            "The most useful preparation is to review the ready document titled “Questions for Priya Khandelwal.”",
          blocks: [
            {
              kind: "ARTIFACT_REFERENCE",
              artifactId: DOC,
              type: "Q_REPORT",
              version: 1,
              title: "Questions for Priya Khandelwal",
            } as unknown as QResultBlock,
          ],
        },
      ]),
    );
    expect(shown[0]).toEqual({
      kind: "DOCUMENT",
      id: DOC,
      name: "Questions for Priya Khandelwal",
    });
    // The same title quoted in prose is not listed twice.
    expect(shown).toHaveLength(1);
  });

  it("writes Capital Q's own note: the numbered SHOWN list and the last action with its inputs", () => {
    const note = referenceNote(
      [{ kind: "DOCUMENT", id: DOC, name: "Questions for Priya Khandelwal" }],
      {
        tool: "change_my_mandate",
        arguments: { minStageCode: "pre_seed", maxStageCode: "series_a" },
        utterance: "make sure I invest in pre-seed to Series A",
        outcome: "NOT_DONE",
      },
    );
    expect(note).toContain("[Q context]");
    expect(note).toContain('1. document "Questions for Priya Khandelwal"');
    expect(note).toContain(
      'LAST ACTION: change_my_mandate {"minStageCode":"pre_seed"',
    );
    expect(note).toContain("not done");
    expect(note?.length).toBeLessThanOrEqual(400);
    expect(referenceNote([], null)).toBeNull();
  });

  it("binds 'that one' to the shown item, and tries a company before an investor for an investor", () => {
    const shown = [
      { kind: "NAMED" as const, id: null, name: "Clinicrest" },
      { kind: "DOCUMENT" as const, id: DOC, name: "Questions for Priya" },
    ];
    expect(
      openTarget(
        {
          open: "RELATIONSHIP",
          name: null,
          shown: 1,
          retryLast: false,
          sameFor: null,
        },
        shown,
        "INVESTOR",
      ),
    ).toEqual({
      pages: ["RELATIONSHIP_COMPANY", "RELATIONSHIP_INVESTOR"],
      name: "Clinicrest",
    });
    expect(
      openTarget(
        {
          open: "CHAT",
          name: "Nixo",
          shown: null,
          retryLast: false,
          sameFor: null,
        },
        shown,
        "FOUNDER",
      )?.pages,
    ).toEqual([
      "RELATIONSHIP_INVESTOR_MESSAGES",
      "RELATIONSHIP_COMPANY_MESSAGES",
    ]);
    // A document card opens by its id, only as a document.
    expect(
      openTarget(
        {
          open: "DOCUMENT",
          name: null,
          shown: 2,
          retryLast: false,
          sameFor: null,
        },
        shown,
        "INVESTOR",
      ),
    ).toEqual({ pages: ["DOCUMENT"], id: DOC });
    // Nothing concrete: nothing is guessed.
    expect(
      openTarget(
        {
          open: "DOCUMENT",
          name: null,
          shown: 5,
          retryLast: false,
          sameFor: null,
        },
        shown,
        "INVESTOR",
      ),
    ).toBeNull();
  });

  it("'same for Kazikit' repeats the action for the record they named instead", () => {
    const last = {
      tool: "propose_express_interest",
      arguments: { company: "Clinicrest", note: "Keen to talk" },
      utterance: "express interest in Clinicrest",
      outcome: "PREPARED" as const,
    };
    expect(repeatedAction(last, "Kazikit")).toEqual({
      tool: "propose_express_interest",
      arguments: { company: "Kazikit", note: "Keen to talk" },
    });
    expect(repeatedAction(last, null)).toEqual({
      tool: "propose_express_interest",
      arguments: last.arguments,
    });
    expect(repeatedAction({ ...last, arguments: null }, null)).toBeNull();
  });
});

describe("opening the one record a turn points at (Zino live 2026-10-04)", () => {
  const opened: { page: string; id?: string; name?: string }[] = [];
  const openRecord: QOpenRecordPort = {
    open: (_request, target) => {
      opened.push({
        page: target.page,
        ...(target.id === undefined ? {} : { id: target.id }),
        ...(target.name === undefined ? {} : { name: target.name }),
      });
      if (
        target.page === "DOCUMENT" &&
        target.name?.toLowerCase().startsWith("questions") === true
      ) {
        return Promise.resolve({
          kind: "OPEN_RECORD_PAGE",
          page: "DOCUMENT",
          id: DOC,
        });
      }
      if (target.page === "RELATIONSHIP_COMPANY_MESSAGES") {
        return Promise.resolve({
          kind: "OPEN_RECORD_PAGE",
          page: target.page,
          id: NIXO,
        });
      }
      return Promise.resolve(null);
    },
  };

  it("'Open the questions for.' opens that document, not the Documents list", async () => {
    const chat = conversation({
      openRecord,
      earlier: [
        {
          role: "USER",
          content: "That's fine. Do you have anything I need to do?",
        },
        {
          role: "Q",
          content:
            "The most useful preparation is to review the ready document titled “Questions for Priya Khandelwal.”",
        },
      ],
    });
    // The reading the logs show, plus v40's reference.
    const said = await chat.say("Yeah. Open the questions for.", {
      ...BASE,
      tool: {
        kind: "NAVIGATE",
        destination: "DOCUMENTS",
        unknownScreen: null,
        visibility: null,
        documentType: null,
        subjectName: null,
      },
      reference: {
        open: "DOCUMENT",
        name: null,
        shown: 1,
        retryLast: false,
        sameFor: null,
      },
    });
    expect(chat.notes.at(-1)).toContain('1. "Questions for Priya Khandelwal"');
    expect(opened.at(-1)).toEqual({
      page: "DOCUMENT",
      name: "Questions for Priya Khandelwal",
    });
    expect(said?.content).toBe('Opening "Questions for Priya Khandelwal".');
    expect(said?.blocks).toEqual([
      {
        kind: "UI_INTENT",
        intent: { kind: "OPEN_RECORD_PAGE", page: "DOCUMENT", id: DOC },
      },
    ]);
    expect(chat.delegated()).toBe(0);
  });

  it("'open my chat with Nixo' from any page opens that chat; an investor's company first", async () => {
    const chat = conversation({ openRecord });
    const said = await chat.say("Open my chat with Nixo.", {
      ...BASE,
      reference: {
        open: "CHAT",
        name: "Nixo",
        shown: null,
        retryLast: false,
        sameFor: null,
      },
    });
    expect(said?.blocks?.[0]).toEqual({
      kind: "UI_INTENT",
      intent: {
        kind: "OPEN_RECORD_PAGE",
        page: "RELATIONSHIP_COMPANY_MESSAGES",
        id: NIXO,
      },
    });
  });

  it("a record that is not theirs is answered, never opened as a screen guess", async () => {
    const chat = conversation({ openRecord });
    await chat.say("Open the board minutes.", {
      ...BASE,
      reference: {
        open: "DOCUMENT",
        name: "board minutes",
        shown: null,
        retryLast: false,
        sameFor: null,
      },
    });
    expect(chat.delegated()).toBe(1);
  });
});

describe("'try again' re-runs the last action (Zino live 2026-10-04)", () => {
  const MANDATE = {
    minStageCode: "pre_seed",
    maxStageCode: "series_a",
  };
  function mandateActions(ran: TurnAppAction[], refuseFirst: boolean) {
    let calls = 0;
    const port: QAppActionPort = {
      tools: new Set(["change_my_mandate", "propose_express_interest"]),
      run: (_request, action) => {
        ran.push(action);
        calls += 1;
        if (refuseFirst && calls === 1) return Promise.resolve(null);
        return Promise.resolve({ prepared: "Change your mandate" });
      },
    };
    return port;
  }

  it("after a mandate change Q could not prepare, 'Okay. Now try again.' prepares it, not the profile page", async () => {
    const ran: TurnAppAction[] = [];
    const reads: string[] = [];
    let argumentReads = 0;
    const chat = conversation({
      appActions: mandateActions(ran, false),
      appActionArguments: (_request, input) => {
        argumentReads += 1;
        reads.push(input.utterance);
        // The first read is the one that failed live; the retry reads the
        // same words with the action's inputs now in hand.
        return Promise.resolve(argumentReads === 1 ? null : MANDATE);
      },
    });
    const ask =
      "Okay. I think I remember. I have series a. Right? Okay. So, um, right now, I want to edit my profile to make sure that I invest in precede series a. Can you save that for me?";
    await chat.say(ask, {
      ...BASE,
      askedAction: "change_my_mandate",
    });
    // Not prepared: nothing ran, the answer said so.
    expect(ran).toHaveLength(0);

    await chat.say("Okay. Now try again.", {
      ...BASE,
      tool: {
        kind: "NAVIGATE",
        destination: "PROFILE",
        unknownScreen: null,
        visibility: null,
        documentType: null,
        subjectName: null,
      },
      askedAction: "change_my_mandate",
      reference: {
        open: null,
        name: null,
        shown: null,
        retryLast: true,
        sameFor: null,
      },
    });
    expect(chat.notes.at(-1)).toContain("LAST ACTION: change_my_mandate");
    expect(chat.notes.at(-1)).toContain("not done");
    expect(reads.at(-1)).toBe(ask);
    expect(ran).toEqual([{ tool: "change_my_mandate", arguments: MANDATE }]);
    // Never "Opening your profile." again.
    expect(
      chat.lines.some((line) => line.content === "Opening your profile."),
    ).toBe(false);
  });

  it("'Yeah. I approve. Go ahead and sync it.' with nothing waiting re-runs the change Q could not prepare", async () => {
    const ran: TurnAppAction[] = [];
    const chat = conversation({
      appActions: mandateActions(ran, true),
      appActionArguments: () => Promise.resolve(MANDATE),
    });
    await chat.say("Make sure I invest in pre-seed to Series A. Save that.", {
      ...BASE,
      appAction: { tool: "change_my_mandate", arguments: MANDATE },
    });
    expect(ran).toHaveLength(1);
    await chat.say("Yeah. I approve. Go ahead and sync it.", {
      ...BASE,
      reference: {
        open: null,
        name: null,
        shown: null,
        retryLast: true,
        sameFor: null,
      },
    });
    expect(ran.at(-1)).toEqual({
      tool: "change_my_mandate",
      arguments: MANDATE,
    });
  });

  it("'same for Kazikit' repeats the last action for Kazikit, through the same proposer", async () => {
    const ran: TurnAppAction[] = [];
    const chat = conversation({ appActions: mandateActions(ran, false) });
    await chat.say("Express interest in Clinicrest.", {
      ...BASE,
      appAction: {
        tool: "propose_express_interest",
        arguments: { company: "Clinicrest" },
      },
    });
    await chat.say("Same for Kazikit.", {
      ...BASE,
      reference: {
        open: null,
        name: null,
        shown: null,
        retryLast: true,
        sameFor: "Kazikit",
      },
    });
    expect(ran).toEqual([
      {
        tool: "propose_express_interest",
        arguments: { company: "Clinicrest" },
      },
      { tool: "propose_express_interest", arguments: { company: "Kazikit" } },
    ]);
  });

  it("with no last action, 'try again' is answered, nothing is run", async () => {
    const ran: TurnAppAction[] = [];
    const chat = conversation({ appActions: mandateActions(ran, false) });
    await chat.say("Try again.", {
      ...BASE,
      kind: "QUESTION_TO_Q",
      reference: {
        open: null,
        name: null,
        shown: null,
        retryLast: true,
        sameFor: null,
      },
    });
    expect(ran).toHaveLength(0);
    expect(chat.delegated()).toBe(1);
  });
});
