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
  spokenRecordName,
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

function request(
  screenCompanyId?: string,
  askerSide?: "INVESTOR" | "FOUNDER",
): QAnswerRequest {
  const runId = randomUUID();
  return {
    ...(askerSide === undefined ? {} : { askerSide }),
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
      ...(screenCompanyId === undefined
        ? {}
        : { screen: { route: "COMPANY", companyId: screenCompanyId } }),
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
  /** What the page-move decision is told the reading read (heard). */
  readonly heard?: (reading: unknown) => void;
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
    ...(options.heard === undefined
      ? {}
      : {
          pageMoves: {
            start: () => undefined,
            settle: (_request: unknown, blocks: unknown) =>
              Promise.resolve(blocks),
            heard: (_request: unknown, reading: Promise<unknown>) => {
              void reading.then(options.heard);
            },
          } as never,
        }),
  });
  const say = async (
    said: string,
    read: QTurnReading | null,
    screenCompanyId?: string,
    askerSide?: "INVESTOR" | "FOUNDER",
  ) => {
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
    await answer.answer(request(screenCompanyId, askerSide));
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

  it("'show me Nixo's pitch' is that company's item in Your companies", () => {
    expect(
      openTarget(
        {
          open: "PITCH",
          name: "Nixo",
          shown: null,
          retryLast: false,
          sameFor: null,
        },
        [],
        "INVESTOR",
      ),
    ).toEqual({ pages: ["COMPANY_PITCH"], name: "Nixo" });
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
      if (target.page === "COMPANY" && target.name === "Clinicrest") {
        return Promise.resolve({
          kind: "OPEN_RECORD_PAGE",
          page: "COMPANY",
          id: NIXO,
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
    expect(said?.content).toBe("Opening Questions for Priya Khandelwal…");
    expect(said?.blocks).toEqual([
      {
        kind: "UI_INTENT",
        intent: { kind: "OPEN_RECORD_PAGE", page: "DOCUMENT", id: DOC },
      },
    ]);
    expect(chat.delegated()).toBe(0);
  });

  it("'Tell me more about the second one.' is a question: answered, never opened (QA F-41)", async () => {
    const chat = conversation({ openRecord });
    const before = opened.length;
    await chat.say("Tell me more about the second one.", {
      ...BASE,
      kind: "QUESTION_TO_Q",
      reference: {
        open: "COMPANY",
        name: "Nixo",
        shown: 2,
        retryLast: false,
        sameFor: null,
      },
    });
    expect(opened).toHaveLength(before);
    expect(chat.delegated()).toBe(1);
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

  const CLINICREST = {
    open: "COMPANY",
    name: "Clinicrest",
    shown: null,
    retryLast: false,
    sameFor: null,
  } as const;

  it("live 2026-11-13: 'Can I see Clinicrest's data room?' opens that company on its data room tab, never the bare profile", async () => {
    const chat = conversation({ openRecord });
    const said = await chat.say("Can I see Clinicrest's data room?", {
      ...BASE,
      // Production read GO, no destination; v87 names the tab by meaning.
      navigation: {
        mode: "GO",
        negated: false,
        destination: null,
        tab: "dataroom",
      },
      reference: CLINICREST,
    });
    expect(said?.blocks?.[0]).toEqual({
      kind: "UI_INTENT",
      intent: {
        kind: "OPEN_RECORD_PAGE",
        page: "COMPANY",
        id: NIXO,
        tab: "dataroom",
      },
    });
    expect(said?.content).toBe("Opening the data room…");
  });

  // v87: the tab is the reading's, by meaning and in any language; the
  // words are never consulted when there is a navigation reading.
  it.each([
    "let me look through the documents Clinicrest shared for diligence",
    "Je voudrais parcourir les documents que Clinicrest a partagés",
  ])("'%s' read as tab dataroom opens the data room tab", async (words) => {
    const chat = conversation({ openRecord });
    const said = await chat.say(words, {
      ...BASE,
      navigation: {
        mode: "GO",
        negated: false,
        destination: null,
        tab: "dataroom",
      },
      reference: CLINICREST,
    });
    expect(said?.blocks?.[0]).toEqual({
      kind: "UI_INTENT",
      intent: {
        kind: "OPEN_RECORD_PAGE",
        page: "COMPANY",
        id: NIXO,
        tab: "dataroom",
      },
    });
  });

  it("a reading with tab null opens the record whole, whatever the words say", async () => {
    const chat = conversation({ openRecord });
    const said = await chat.say("Can I see Clinicrest's data room?", {
      ...BASE,
      navigation: { mode: "GO", negated: false, destination: null, tab: null },
      reference: CLINICREST,
    });
    expect(said?.blocks?.[0]).toEqual({
      kind: "UI_INTENT",
      intent: { kind: "OPEN_RECORD_PAGE", page: "COMPANY", id: NIXO },
    });
  });

  it("a tab the page does not have is dropped; the record still opens", async () => {
    const chat = conversation({ openRecord });
    const said = await chat.say("Open the Clinicrest deal.", {
      ...BASE,
      navigation: {
        mode: "GO",
        negated: false,
        destination: null,
        tab: "deal",
      },
      reference: CLINICREST,
    });
    expect(said?.blocks?.[0]).toEqual({
      kind: "UI_INTENT",
      intent: { kind: "OPEN_RECORD_PAGE", page: "COMPANY", id: NIXO },
    });
  });

  it.each(["NONE", "OFFER_ONLY"] as const)(
    "a %s reading with a tab never opens the record",
    async (mode) => {
      opened.length = 0;
      const chat = conversation({ openRecord });
      const said = await chat.say("Can I see Clinicrest's data room?", {
        ...BASE,
        navigation: {
          mode,
          negated: false,
          destination: null,
          tab: "dataroom",
        },
        reference: CLINICREST,
      });
      expect(opened).toEqual([]);
      expect(
        (said?.blocks ?? []).some(
          (block) =>
            block.kind === "UI_INTENT" &&
            block.intent.kind === "OPEN_RECORD_PAGE",
        ),
      ).toBe(false);
    },
  );

  it("'Open Clinicrest.' still opens the profile, with no tab added", async () => {
    const chat = conversation({ openRecord });
    const said = await chat.say("Open Clinicrest.", {
      ...BASE,
      // The reading production logged for this turn: GO, no destination.
      navigation: { mode: "GO", negated: false, destination: null, tab: null },
      reference: CLINICREST,
    });
    expect(said?.blocks?.[0]).toEqual({
      kind: "UI_INTENT",
      intent: { kind: "OPEN_RECORD_PAGE", page: "COMPANY", id: NIXO },
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

/**
 * voiceq-63 (live 2026-10-04): "open the relationship between Nixon and I"
 * was answered `Opening "Nixon and I".` The words around a name are not
 * the name.
 */
describe("a record's name as said", () => {
  it.each([
    ["Nixon and I", "Nixon"],
    ["the relationship between Nixon and I", "Nixon"],
    ["my chat with Kazikit", "Kazikit"],
    ["me and Nixo", "Nixo"],
    ["Yamfield Agro", "Yamfield Agro"],
    ["Savanna Seed Partners", "Savanna Seed Partners"],
  ])("%s -> %s", (said, name) => {
    expect(spokenRecordName(said)).toBe(name);
  });
});

describe("a question about the page already on screen is answered, not re-opened", () => {
  // Live 2026-10-11 (investor rehearsal): on Ledgerfold's page the reader
  // marked "What does this company actually do and why does it fit my
  // mandate?" as an open, and Q re-opened the page with no evidence.
  const LEDGERFOLD = "84b9641f-b618-4fa3-8b35-1d19b1c71d82";
  const opener: QOpenRecordPort = {
    open: (_request, target) =>
      Promise.resolve({
        kind: "OPEN_RECORD_PAGE",
        page: target.page,
        id: LEDGERFOLD,
      }),
  };
  const read = {
    ...BASE,
    kind: "QUESTION_TO_Q",
    reference: {
      open: "COMPANY",
      name: "Ledgerfold",
      shown: null,
      retryLast: false,
      sameFor: null,
    },
  } as unknown as QTurnReading;

  it("answers a question on the company's own page through the answer path", async () => {
    const chat = conversation({ openRecord: opener });
    const last = await chat.say(
      "What does this company actually do and why does it fit my mandate? Use its Capital Q records.",
      read,
      LEDGERFOLD,
    );
    expect(chat.delegated()).toBe(1);
    expect(last?.content).toBe("An answer.");
  });

  it("still opens it when they ask to open it; a question asked elsewhere is answered (QA F-41)", async () => {
    const here = conversation({ openRecord: opener });
    const opened = await here.say(
      "Open Ledgerfold",
      { ...read, kind: "TOOL_REQUEST" } as unknown as QTurnReading,
      LEDGERFOLD,
    );
    expect(here.delegated()).toBe(0);
    expect(opened?.blocks?.[0]).toMatchObject({
      kind: "UI_INTENT",
      intent: { kind: "OPEN_RECORD_PAGE", id: LEDGERFOLD },
    });
    // Asking about it never moves them (QA F-41: the move lost the
    // conversation); the answer path answers with the record bound.
    const elsewhere = conversation({ openRecord: opener });
    await elsewhere.say("What does Ledgerfold do?", read);
    expect(elsewhere.delegated()).toBe(1);
  });
});

describe("an asked action or question is never turned into a page move (QA 2026-10-23, live v60)", () => {
  const LEDGERFOLD = "84b9641f-b618-4fa3-8b35-1d19b1c71d82";
  // An opener that would open anything: only the gate decides.
  const always: QOpenRecordPort = {
    open: (_request, target) =>
      Promise.resolve({
        kind: "OPEN_RECORD_PAGE",
        page: target.page,
        id: LEDGERFOLD,
      }),
  };
  const reading = (
    open: "COMPANY" | "INVESTOR",
    name: string,
    kind: string = "TOOL_REQUEST",
  ) =>
    ({
      ...BASE,
      kind,
      reference: { open, name, shown: null, retryLast: false, sameFor: null },
    }) as unknown as QTurnReading;

  for (const [finding, said, read] of [
    [
      "F-33",
      "Reply to Rift Valley Seed Fund: accept their interest and suggest a call next week.",
      reading("INVESTOR", "Rift Valley Seed Fund"),
    ],
    [
      "QO-39",
      "Express interest in Ledgerfold with this note: 'Hi team, I back early fintech in Lagos and would love to learn more.'",
      reading("COMPANY", "Ledgerfold"),
    ],
    [
      "F-41",
      "Tell me more about the second one.",
      reading("COMPANY", "Ledgerfold"),
    ],
  ] as const) {
    it(`${finding}: "${said.slice(0, 40)}…" reaches the answer, not a move`, async () => {
      const chat = conversation({ openRecord: always });
      const reply = await chat.say(said, read);
      expect(chat.delegated()).toBe(1);
      expect(reply?.blocks ?? []).not.toContainEqual(
        expect.objectContaining({ kind: "UI_INTENT" }),
      );
    });
  }

  it("still opens what they ask to open", async () => {
    const chat = conversation({ openRecord: always });
    const reply = await chat.say(
      "Open Ledgerfold.",
      reading("COMPANY", "Ledgerfold"),
    );
    expect(chat.delegated()).toBe(0);
    expect(reply?.blocks?.[0]).toMatchObject({
      kind: "UI_INTENT",
      intent: { kind: "OPEN_RECORD_PAGE", id: LEDGERFOLD },
    });
  });
});

/**
 * v87 record tabs (owner clarification, 13 Nov 2026): the reading names the
 * part of a record by meaning (navigation.tab, any language); the record is
 * the one the turn points at, the one on screen, or the one Q last opened.
 * Each opens through open_page (this double); readings are fixtures.
 */
describe("record tabs by the reading, explicit and contextual (v87)", () => {
  const CLINICREST_ID = "6b2f0000-0000-4000-8000-000000000001";
  const SAVANNA_ID = "5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a";
  const opened: { page: string; id?: string; name?: string }[] = [];
  const COMPANIES: Readonly<Record<string, string>> = {
    Clinicrest: CLINICREST_ID,
    Nixo: NIXO,
  };
  const COMPANY_PAGES = new Set([
    "COMPANY",
    "COMPANY_TEAM",
    "COMPANY_DECK",
    "COMPANY_DATA_ROOM",
    "RELATIONSHIP_COMPANY",
    "RELATIONSHIP_COMPANY_MESSAGES",
  ]);
  const ids = new Set([CLINICREST_ID, NIXO]);
  // Their companies (by name or id) and their relationship with Savanna;
  // Ledgerline is not theirs to open (open_page refuses: null).
  const openRecord: QOpenRecordPort = {
    open: (_request, target) => {
      opened.push({
        page: target.page,
        ...(target.id === undefined ? {} : { id: target.id }),
        ...(target.name === undefined ? {} : { name: target.name }),
      });
      const company =
        (target.name === undefined ? undefined : COMPANIES[target.name]) ??
        (target.id !== undefined && ids.has(target.id) ? target.id : undefined);
      if (company !== undefined && COMPANY_PAGES.has(target.page)) {
        return Promise.resolve({
          kind: "OPEN_RECORD_PAGE",
          page: target.page,
          id: company,
        } as never);
      }
      const savanna =
        target.name?.startsWith("Savanna") === true || target.id === SAVANNA_ID;
      if (
        savanna &&
        (target.page === "INVESTOR" ||
          target.page === "RELATIONSHIP_INVESTOR" ||
          target.page === "RELATIONSHIP_INVESTOR_MESSAGES")
      ) {
        return Promise.resolve({
          kind: "OPEN_RECORD_PAGE",
          page: target.page,
          id: SAVANNA_ID,
        } as never);
      }
      return Promise.resolve(null);
    },
  };
  const go = (tab: string | null, mode = "GO") =>
    ({ mode, negated: false, destination: null, tab }) as never;
  const named = (open: string, name: string) =>
    ({
      open,
      name,
      shown: null,
      retryLast: false,
      sameFor: null,
    }) as never;
  const moveOf = (
    line: { blocks?: readonly QResultBlock[] | undefined } | undefined,
  ) =>
    (line?.blocks ?? []).flatMap((block) =>
      block.kind === "UI_INTENT" && block.intent.kind === "OPEN_RECORD_PAGE"
        ? [block.intent]
        : [],
    );

  it.each([
    ["Show me Clinicrest's messages", "messages"],
    ["Montre-moi les messages de Clinicrest", "messages"],
  ])(
    "'%s' read GO tab messages opens the relationship's thread",
    async (said, tab) => {
      const chat = conversation({ openRecord });
      const reply = await chat.say(said, {
        ...BASE,
        navigation: go(tab),
        reference: named("COMPANY", "Clinicrest"),
      });
      expect(moveOf(reply)).toEqual([
        expect.objectContaining({
          page: "RELATIONSHIP_COMPANY_MESSAGES",
          id: CLINICREST_ID,
        }),
      ]);
    },
  );

  it("'I'd like to look at where things stand on terms with Clinicrest' read GO tab deal opens the relationship on its deal tab", async () => {
    const chat = conversation({ openRecord });
    const reply = await chat.say(
      "I'd like to look at where things stand on terms with Clinicrest",
      {
        ...BASE,
        navigation: go("deal"),
        reference: named("COMPANY", "Clinicrest"),
      },
    );
    expect(moveOf(reply)).toEqual([
      {
        kind: "OPEN_RECORD_PAGE",
        page: "RELATIONSHIP_COMPANY",
        id: CLINICREST_ID,
        tab: "deal",
      },
    ]);
  });

  it("'muéstrame el deck de Nixo' read GO tab deck opens the deck viewer", async () => {
    const chat = conversation({ openRecord });
    const reply = await chat.say("muéstrame el deck de Nixo", {
      ...BASE,
      navigation: go("deck"),
      reference: named("COMPANY", "Nixo"),
    });
    expect(moveOf(reply)).toEqual([
      expect.objectContaining({
        page: "COMPANY_DECK",
        id: NIXO,
        tab: "deck",
        viewer: "OPEN",
      }),
    ]);
  });

  it("'Make Nixo a deck' with no navigation read opens nothing", async () => {
    opened.length = 0;
    const chat = conversation({ openRecord });
    const reply = await chat.say("Make Nixo a deck.", {
      ...BASE,
      navigation: go(null, "NONE"),
      reference: named("COMPANY", "Nixo"),
    });
    expect(opened).toEqual([]);
    expect(moveOf(reply)).toEqual([]);
    expect(chat.delegated()).toBe(1);
  });

  it("cross-turn: 'Open Nixo.' then 'Can I see their team?' opens Nixo's team tab", async () => {
    const chat = conversation({ openRecord });
    const first = await chat.say("Open Nixo.", {
      ...BASE,
      navigation: go(null),
      reference: named("COMPANY", "Nixo"),
    });
    expect(moveOf(first)).toEqual([
      expect.objectContaining({ page: "COMPANY", id: NIXO }),
    ]);
    const second = await chat.say("Can I see their team?", {
      ...BASE,
      navigation: go("team"),
      reference: null,
    });
    expect(moveOf(second)).toEqual([
      expect.objectContaining({ page: "COMPANY_TEAM", id: NIXO, tab: "team" }),
    ]);
    expect(chat.delegated()).toBe(0);
  });

  it("on Clinicrest's page, 'Can I see their data room?' opens its data room", async () => {
    const chat = conversation({ openRecord });
    const reply = await chat.say(
      "Can I see their data room?",
      { ...BASE, navigation: go("dataroom"), reference: null },
      CLINICREST_ID,
    );
    expect(moveOf(reply)).toEqual([
      expect.objectContaining({
        page: "COMPANY_DATA_ROOM",
        id: CLINICREST_ID,
        tab: "dataroom",
      }),
    ]);
  });

  it.each([
    ["RELATIONSHIP", "Open my relationship with Savanna."],
    ["INVESTOR", "Open Savanna Seed Partners."],
  ])(
    "cross-turn (%s): '%s' then 'And the calls?' opens the relationship's calls tab",
    async (open, said) => {
      const chat = conversation({ openRecord });
      const first = await chat.say(said, {
        ...BASE,
        navigation: go(null),
        reference: named(open, "Savanna Seed Partners"),
      });
      expect(moveOf(first)).toHaveLength(1);
      const second = await chat.say("And the calls?", {
        ...BASE,
        navigation: go("calls", "CONTEXT"),
        reference: null,
      });
      // CONTEXT outside the workspace is not a move; GO is.
      expect(moveOf(second)).toEqual([]);
      const third = await chat.say("Show me the calls.", {
        ...BASE,
        navigation: go("calls"),
        reference: null,
      });
      expect(moveOf(third)).toEqual([
        {
          kind: "OPEN_RECORD_PAGE",
          page: "RELATIONSHIP_INVESTOR",
          id: SAVANNA_ID,
          tab: "calls",
        },
      ]);
    },
  );

  it("nothing on screen or in the conversation: 'Can I see their team?' is answered, nothing opens", async () => {
    opened.length = 0;
    const chat = conversation({ openRecord });
    const reply = await chat.say("Can I see their team?", {
      ...BASE,
      navigation: go("team"),
      reference: null,
    });
    expect(opened).toEqual([]);
    expect(moveOf(reply)).toEqual([]);
    expect(chat.delegated()).toBe(1);
  });

  it("a tab the record in view lacks (a team on an investor relationship) opens nothing", async () => {
    const chat = conversation({ openRecord });
    await chat.say("Open my relationship with Savanna.", {
      ...BASE,
      navigation: go(null),
      reference: named("RELATIONSHIP", "Savanna Seed Partners"),
    });
    const reply = await chat.say("Can I see their team?", {
      ...BASE,
      navigation: go("team"),
      reference: null,
    });
    expect(moveOf(reply)).toEqual([]);
    expect(chat.delegated()).toBe(1);
  });

  it("a record they may not open never opens and Q never says it did", async () => {
    const chat = conversation({ openRecord });
    const reply = await chat.say("Can I see Ledgerline's data room?", {
      ...BASE,
      navigation: go("dataroom"),
      reference: named("COMPANY", "Ledgerline"),
    });
    expect(moveOf(reply)).toEqual([]);
    expect(reply?.content).not.toMatch(/^Opening/u);
    expect(chat.delegated()).toBe(1);
  });

  // Live 13 Nov 2026 on 550ecdd5c (workspace, Clinicrest's data room tab):
  // the exact reading production logged. The pitch plays inline (A8
  // COMPANY_MEDIA, the answer path); nothing opens; the decision is told
  // the Elevator pitch tab, never the deck.
  const WATCH_PITCH = {
    ...BASE,
    navigation: go("deck"),
    reference: named("PITCH", "Clinicrest"),
    companyMedia: { pitch: true, picture: false },
  } as never;

  it("'Could I watch how Clinicrest presents itself? Play me their pitch.' opens nothing; the answer plays it", async () => {
    opened.length = 0;
    const told: unknown[] = [];
    const chat = conversation({
      openRecord,
      heard: (reading) => told.push(reading),
    });
    const reply = await chat.say(
      "Could I watch how Clinicrest presents itself? Play me their pitch.",
      WATCH_PITCH,
    );
    expect(opened).toEqual([]);
    expect(moveOf(reply)).toEqual([]);
    expect(chat.delegated()).toBe(1);
    await Promise.resolve();
    expect(told).toMatchObject([
      { navigation: { mode: "GO", tab: "elevator" } },
    ]);
  });

  it("on Clinicrest's page, a pitch to watch with no record named opens no tab", async () => {
    opened.length = 0;
    const chat = conversation({ openRecord });
    await chat.say(
      "Play me their pitch.",
      { ...(WATCH_PITCH as object), reference: null } as never,
      CLINICREST_ID,
    );
    expect(opened).toEqual([]);
    expect(chat.delegated()).toBe(1);
  });

  it("'Show me Clinicrest's pitch deck' (tab deck, pitch false) still opens the deck", async () => {
    const told: unknown[] = [];
    const chat = conversation({
      openRecord,
      heard: (reading) => told.push(reading),
    });
    const reply = await chat.say("Show me Clinicrest's pitch deck", {
      ...BASE,
      navigation: go("deck"),
      reference: named("COMPANY", "Clinicrest"),
      companyMedia: { pitch: false, picture: false },
    });
    expect(moveOf(reply)).toEqual([
      expect.objectContaining({ page: "COMPANY_DECK", id: CLINICREST_ID }),
    ]);
    // Said by name, the deck may open before the reading lands; when the
    // decision is told the reading, its tab stays the deck.
    await Promise.resolve();
    for (const reading of told)
      expect(reading).toMatchObject({ navigation: { tab: "deck" } });
  });
});

/**
 * Live replay on d96c63ee1 (13 Nov 2026, investor). The conversation's
 * stored turns build the ledger (code, no model); readings are the logged
 * ones, as fixtures. "Their" binds to what the conversation is about now,
 * over the record merely in view; two in play: Q asks.
 */
describe("live d96c63ee1: their record is the conversation's, not the pane's", () => {
  const CLINICREST_ID = "6b2f0000-0000-4000-8000-000000000001";
  const LEDGERLINE_ID = "1e1e1e1e-1e1e-4e1e-8e1e-1e1e1e1e1e1e";
  const MEDIBASE_ID = "3c3c3c3c-3c3c-4c3c-8c3c-3c3c3c3c3c3c";
  const media = (companyId: string, name: string) =>
    ({
      kind: "COMPANY_MEDIA",
      companyId,
      name,
      image: true,
      pitch: null,
    }) as unknown as QResultBlock;
  const openPage = (page: string, id: string) =>
    ({
      kind: "UI_INTENT",
      intent: { kind: "OPEN_RECORD_PAGE", page, id },
    }) as unknown as QResultBlock;
  /** The logged conversation up to "Can I see their data room?". */
  const EARLIER: readonly Line[] = [
    { role: "USER", content: "Tell me about Clinicrest." },
    {
      role: "Q",
      content: "Clinicrest runs clinics.",
      blocks: [media(CLINICREST_ID, "Clinicrest")],
    },
    { role: "USER", content: "Can I see their data room?" },
    {
      role: "Q",
      content: "Opening the data room.",
      blocks: [openPage("COMPANY", CLINICREST_ID)],
    },
    { role: "USER", content: "Show me my messages with Clinicrest." },
    {
      role: "Q",
      content: "Here's your thread.",
      blocks: [openPage("RELATIONSHIP_COMPANY_MESSAGES", CLINICREST_ID)],
    },
    { role: "USER", content: "Tell me about Ledgerline." },
    {
      role: "Q",
      content: "Ledgerline does bookkeeping.",
      blocks: [media(LEDGERLINE_ID, "Ledgerline")],
    },
    { role: "USER", content: "And what's their team like?" },
    {
      role: "Q",
      content: "A team of six.",
      blocks: [
        { kind: "COMPANY_REFERENCE", companyId: LEDGERLINE_ID } as never,
      ],
    },
  ];
  const ALL: Readonly<Record<string, string>> = {
    Clinicrest: CLINICREST_ID,
    Ledgerline: LEDGERLINE_ID,
    Medibase: MEDIBASE_ID,
  };
  const recordPort = (
    openable: Readonly<Record<string, string>>,
    opened: { page: string; name?: string; id?: string }[],
  ): QOpenRecordPort => ({
    open: (_request, target) => {
      opened.push({
        page: target.page,
        ...(target.name === undefined ? {} : { name: target.name }),
        ...(target.id === undefined ? {} : { id: target.id }),
      });
      const id = target.name === undefined ? target.id : openable[target.name];
      return Promise.resolve(
        id === undefined ||
          !Object.values(openable).includes(id) ||
          target.page !== "COMPANY"
          ? null
          : ({ kind: "OPEN_RECORD_PAGE", page: "COMPANY", id } as never),
      );
    },
  });
  const theirDataRoom = (name: string) =>
    ({
      ...BASE,
      aboutNamedOther: true,
      navigation: {
        mode: "GO",
        negated: false,
        destination: null,
        tab: "dataroom",
      },
      reference: {
        open: "COMPANY",
        name,
        shown: null,
        retryLast: false,
        sameFor: null,
      },
    }) as unknown as QTurnReading;
  const moveOf = (
    line: { blocks?: readonly QResultBlock[] | undefined } | undefined,
  ) =>
    (line?.blocks ?? []).flatMap((block) =>
      block.kind === "UI_INTENT" && block.intent.kind === "OPEN_RECORD_PAGE"
        ? [block.intent]
        : [],
    );

  it("'Can I see their data room?' read to Clinicrest (in view) opens Ledgerline's, the conversation's record", async () => {
    const opened: { page: string; name?: string }[] = [];
    const chat = conversation({
      openRecord: recordPort(ALL, opened),
      earlier: EARLIER,
    });
    const reply = await chat.say(
      "Can I see their data room?",
      theirDataRoom("Clinicrest"),
      CLINICREST_ID,
    );
    expect(opened[0]).toMatchObject({ page: "COMPANY", name: "Ledgerline" });
    expect(moveOf(reply)).toEqual([
      expect.objectContaining({
        page: "COMPANY",
        id: LEDGERLINE_ID,
        tab: "dataroom",
      }),
    ]);
  });

  it("the name said in their words stands: 'Can I see Clinicrest's data room?' opens Clinicrest's", async () => {
    const chat = conversation({
      openRecord: recordPort(ALL, []),
      earlier: EARLIER,
    });
    const reply = await chat.say(
      "Can I see Clinicrest's data room?",
      theirDataRoom("Clinicrest"),
      CLINICREST_ID,
    );
    expect(moveOf(reply)).toEqual([
      expect.objectContaining({ id: CLINICREST_ID, tab: "dataroom" }),
    ]);
  });

  it("two records in the latest turn, neither the one read: Q asks which, and opens nothing", async () => {
    const opened: { page: string }[] = [];
    const chat = conversation({
      openRecord: recordPort(ALL, opened),
      earlier: [
        ...EARLIER,
        { role: "USER", content: "Compare Ledgerline and Medibase." },
        {
          role: "Q",
          content: "Side by side.",
          blocks: [
            media(LEDGERLINE_ID, "Ledgerline"),
            media(MEDIBASE_ID, "Medibase"),
          ],
        },
      ],
    });
    const reply = await chat.say(
      "Can I see their data room?",
      theirDataRoom("Clinicrest"),
      CLINICREST_ID,
    );
    expect(opened).toEqual([]);
    expect(moveOf(reply)).toEqual([]);
    expect(reply?.content).toBe("Do you mean Ledgerline or Medibase?");
  });

  it("the conversation's record they may not open: nothing opens (never the one in view instead)", async () => {
    const opened: { page: string; name?: string }[] = [];
    const chat = conversation({
      openRecord: recordPort({ Clinicrest: CLINICREST_ID }, opened),
      earlier: EARLIER,
    });
    const reply = await chat.say(
      "Can I see their data room?",
      theirDataRoom("Clinicrest"),
      CLINICREST_ID,
    );
    expect(opened.map((one) => one.name)).toEqual(["Ledgerline"]);
    expect(moveOf(reply)).toEqual([]);
  });

  it("the page-move decision is told the turn's record: named Ledgerline, then their team (Ledgerline from the ledger)", async () => {
    const told: unknown[] = [];
    const chat = conversation({
      earlier: EARLIER.slice(0, 6),
      heard: (reading) => told.push(reading),
    });
    await chat.say(
      "Tell me about Ledgerline.",
      {
        ...BASE,
        kind: "QUESTION_TO_Q",
        aboutNamedOther: true,
        namedOther: { name: "Ledgerline", kind: "COMPANY" },
        navigation: {
          mode: "CONTEXT",
          negated: false,
          destination: null,
          tab: "overview",
        },
      } as unknown as QTurnReading,
      CLINICREST_ID,
    );
    const later = conversation({
      earlier: EARLIER.slice(0, 8),
      heard: (reading) => told.push(reading),
    });
    await later.say(
      "And what's their team like?",
      {
        ...BASE,
        kind: "QUESTION_TO_Q",
        navigation: {
          mode: "CONTEXT",
          negated: false,
          destination: null,
          tab: "team",
        },
      } as unknown as QTurnReading,
      CLINICREST_ID,
      "INVESTOR",
    );
    await Promise.resolve();
    expect(told).toEqual([
      expect.objectContaining({
        subject: {
          kind: "COMPANY",
          name: "Ledgerline",
          id: null,
          named: true,
        },
      }),
      expect.objectContaining({
        subject: {
          kind: "COMPANY",
          name: "Ledgerline",
          id: LEDGERLINE_ID,
          named: false,
        },
      }),
    ]);
  });

  it("'Play me their pitch.' (GO, tab null, pitch) tells the decision pitch, and no subject", async () => {
    const told: unknown[] = [];
    const chat = conversation({
      earlier: EARLIER.slice(0, 4),
      heard: (reading) => told.push(reading),
    });
    await chat.say(
      "Could I watch how Clinicrest presents itself? Play me their pitch.",
      {
        ...BASE,
        companyMedia: { pitch: true, picture: false },
        navigation: {
          mode: "GO",
          negated: false,
          destination: null,
          tab: null,
        },
      } as unknown as QTurnReading,
      CLINICREST_ID,
    );
    await Promise.resolve();
    expect(told).toEqual([
      expect.objectContaining({ pitch: true, subject: undefined }),
    ]);
  });
});
