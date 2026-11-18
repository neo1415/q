import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { PermittedContextPlan } from "@capital-q/contracts";
import type {
  QAnswerRequest,
  QConversationMessage,
  QRuntimeRepositories,
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
  asksAboutOthersInterest,
  OTHERS_INTEREST_LINE,
  othersInterestAsked,
} from "../src/q/others-interest.js";
import { TENANT, testCatalog, USER } from "./fixtures.js";

/**
 * Audit 2026-11-13 item 17 (privacy). Other investors' interest in a
 * company was withheld only when a word rule matched the question; a
 * paraphrase it missed was answered without the withholding note or the
 * answer check. TURN_READER v93 reads it by meaning (`othersActivity`,
 * carried as `othersActivityAsked`); either one withholds. The word rule
 * stays as defence in depth. Fakes only: no provider is called.
 */

/** Asks the word rule misses: spoken, French, Spanish and paraphrased. */
const PARAPHRASES = [
  "Is anybody else circling Kazikit?",
  "Am I the only one looking at them?",
  "What's the competition like on this deal?",
  "Has Kazikit got other suitors?",
  "Anyone else kicking the tyres on Kazikit?",
  "How hot is this round, who's in?",
  "um so like is there a queue of people wanting a piece of kazikit",
  "Did Acme Ventures pass on Kazikit?",
  "Who's doing diligence on Kazikit besides us?",
  "Est-ce que d'autres fonds regardent Kazikit ?",
  "Qui d'autre s'intéresse à Kazikit ?",
  "¿Alguien más está mirando Kazikit?",
  "¿Cuántos inversores han pasado de Kazikit?",
];

/** Follow-ups that only mean it with the turn before. */
const FOLLOW_UPS = ["and how many of them?", "what are they putting in?"];

const NO_OTHERS_CLAIM =
  "No other investors are recorded as interested in Kazikit. Your own interest is waiting for their answer.";

function build(said: string, othersActivityAsked: boolean | undefined) {
  const RUN = randomUUID();
  const CONVERSATION = randomUUID();
  const COMPANY = randomUUID();
  const alpha = createFakeModelProvider({
    code: "alpha",
    script: [
      {
        kind: "TEXT",
        text: JSON.stringify({
          answer: NO_OTHERS_CLAIM,
          responseShape: "CONCISE",
          insufficientEvidence: false,
          recommendation: null,
        }),
      },
    ],
  });
  const gateway = createModelGateway({
    catalog: createStaticModelCatalog(testCatalog((s) => s)),
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
  const stored: string[] = [];
  const tools: QToolPort = {
    offer: () => Promise.resolve([]),
    execute: () => Promise.reject(new Error("no tool is offered")),
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
    gateway,
    repositories,
    sql: {} as never,
    transactions: { run: (work) => work({} as never) },
    tools,
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
    ...(othersActivityAsked === undefined ? {} : { othersActivityAsked }),
    plan: {
      runId: RUN,
      tenantId: TENANT,
      actor: { userId: USER },
      purpose: {
        capability: "ANSWER",
        taskClass: "COUNTERPARTY_COMPANY_QUESTION",
      },
      subjects: [subject],
      scopes: [{ kind: "COMPANY_PROFILE", subject }],
      denied: [],
      maxSensitivity: "PUBLIC",
    } as unknown as PermittedContextPlan,
  } as unknown as QAnswerRequest;
  const sent = () =>
    alpha.calls
      .flatMap((call) => call.request.messages.map((m) => m.content))
      .join("\n");
  return { seam, request, sent, stored };
}

const NOTE_MARK = "OTHER INVESTORS' INTEREST IS PRIVATE";

describe("other parties' interest is withheld when the reading says so (item 17)", () => {
  it("the word rule alone misses every one of these asks", () => {
    for (const said of [...PARAPHRASES, ...FOLLOW_UPS]) {
      expect(asksAboutOthersInterest(said), said).toBe(false);
    }
    expect(PARAPHRASES.length).toBeGreaterThanOrEqual(10);
  });

  it("either the reading or the word rule triggers it; neither alone is required", () => {
    expect(othersInterestAsked({ othersActivityAsked: true }, "and?")).toBe(
      true,
    );
    // Defence in depth: a reading that failed or missed it never lets a
    // plain ask through.
    expect(
      othersInterestAsked(
        { othersActivityAsked: false },
        "Which other investors are interested in Kazikit?",
      ),
    ).toBe(true);
    expect(othersInterestAsked({}, "Who else is looking at Kazikit?")).toBe(
      true,
    );
    expect(othersInterestAsked({}, "What does Kazikit do?")).toBe(false);
  });

  it.each([...PARAPHRASES, ...FOLLOW_UPS])(
    "read by meaning, %s is withheld, never denied",
    async (said) => {
      const { seam, request, sent, stored } = build(said, true);
      expect((await seam.answer(request)).kind).toBe("ANSWERED");
      // The model is told it is private before it writes.
      expect(sent()).toContain(NOTE_MARK);
      const answer = stored.at(-1) ?? "";
      // What it must withhold: never "there are none", always the line.
      expect(answer.startsWith(OTHERS_INTEREST_LINE)).toBe(true);
      expect(answer).not.toMatch(/no other investors/iu);
      // Their own side is still theirs to hear.
      expect(answer).toContain("Your own interest is waiting");
    },
  );

  it("the word rule still withholds when the reading did not say so", async () => {
    const { seam, request, sent, stored } = build(
      "Which other investors are interested in Kazikit, and what cheques?",
      false,
    );
    await seam.answer(request);
    expect(sent()).toContain(NOTE_MARK);
    expect(stored.at(-1)?.startsWith(OTHERS_INTEREST_LINE)).toBe(true);
  });

  it.each([
    "What's my interest in Kazikit?",
    "Where do we stand with Kazikit?",
    // A founder about their own investors: their own pipeline, allowed.
    "Is Acme Ventures interested in us?",
    "Which investors are interested in us?",
  ])("%s is their own side: nothing withheld", async (said) => {
    const { seam, request, sent, stored } = build(said, false);
    await seam.answer(request);
    expect(asksAboutOthersInterest(said)).toBe(false);
    expect(sent()).not.toContain(NOTE_MARK);
    const answer = stored.at(-1) ?? "";
    expect(answer).toContain("Your own interest is waiting");
    expect(answer).not.toContain(OTHERS_INTEREST_LINE);
  });
});
