import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { AnyAppAction } from "@capital-q/app-actions";
import { InstructionGrantSchema } from "@capital-q/contracts";

import {
  threadOwnNumbers,
  validateStep,
  type InstructionPerson,
  type InstructionPlanStep,
} from "../src/composition/instructions/engine.js";
import {
  companyCardFacts,
  distinctiveWords,
  investorProfileFacts,
  type InstructionMaterial,
} from "../src/composition/instructions/material.js";
import { transcriptOf } from "../src/composition/instructions/quarantine.js";

/**
 * Tensorgate, 8 Oct, second kick (08:56): the exact production inputs,
 * read-only, for instruction 4fe0050f -- conversation 08b5cf9f, Zino
 * Aviation's network-visible profile, Tensorgate's card, grant v1 and the
 * live RELATIONSHIP_ROUTINE delegation 61e76220. Plausible model replies
 * run through code's validators: a warm, specific reply passes; an
 * invented number does not.
 */

const REL = "ea7388fd-e6ec-40ff-99b1-55c00a8d945d";
const ZINO_ORG = "9c73b384-876c-45a9-a564-d498d1a3fe22";
const NOW = new Date("2026-10-08T08:56:20Z");

const GRANT = InstructionGrantSchema.parse({
  tone: "Warm, brief and professional, in their own voice.",
  digest: "DAILY",
  topics: ["introductions", "their company", "times to meet"],
  actions: [
    { mode: "AUTO", action: "chat.message.send" },
    { mode: "ASK", action: "schedule.meeting.book" },
    { mode: "ASK", action: "relationship.connection_request.send" },
    { mode: "ASK", action: "relationship.interest.accept" },
    { mode: "ASK", action: "relationship.interest.decline" },
    { mode: "ASK", action: "relationship.outcome.change" },
    { mode: "ASK", action: "schedule.reminder.create" },
    { mode: "ASK", action: "diligence.change" },
  ],
  counterparts: {
    scope: "ALL_MY_RELATIONSHIPS",
    exclude: [],
    relationshipIds: [],
    includeNewCompanies: false,
  },
  workingHours: {
    end: "23:59",
    days: [1, 2, 3, 4, 5, 6, 7],
    start: "00:00",
    timeZone: "UTC",
  },
  expiresInDays: 30,
  budgetUsdMonth: "5.00",
  routineReplies: true,
  maxMessagesPerCounterpart: 8,
});
const DELEGATION = { id: "61e76220-3f14-4136-a09d-e4c972adff9e" };

const PEOPLE: readonly InstructionPerson[] = [
  {
    relationshipId: REL,
    counterpartKind: "INVESTOR_ORGANISATION",
    counterpartId: ZINO_ORG,
    name: "Zino Aviation",
    state: "CONNECTED",
  },
];

const THREAD = [
  {
    id: "e692bf78-cea5-4e9f-9af3-ca094313ae8a",
    from: "YOU" as const,
    sentAt: "2026-10-06T17:28:35.767Z",
    text: "Thanks for connecting. Tensorgate is a policy gateway for LLM traffic in regulated industries: 4 design partners, 2 converted to $180k contracts, 31m requests served. Raising a $4m seed. Want the deck, or 20 minutes this week? Daniel",
    attachmentTitle: null,
  },
  {
    id: "91a1c216-ff52-4704-bd31-4bd99a2d4b89",
    from: "OTHER_SIDE" as const,
    sentAt: "2026-10-07T15:43:31.143Z",
    text: "Hello Tensorgate team — thank you for the invitation. Running LLM inference inside hardware enclaves and attesting every request addresses a concrete barrier for regulated firms using sensitive data. I’d be interested to hear how those firms are evaluating the gateway in practice. Would you be open to connecting?",
    attachmentTitle: null,
  },
];
const THEIR_LATEST = THREAD[1]?.text ?? "";

const labels = {
  code: (code: string) =>
    ({ seed: "Seed", NG: "Nigeria", US: "United States" })[code],
  investorType: (code: string) => ({ ANGEL: "Angel investor" })[code],
};
const MATERIAL: InstructionMaterial = {
  sender: {
    side: "COMPANY",
    facts: companyCardFacts(
      {
        currentStageCode: "seed",
        headquartersCountry: "US",
        shortDescription:
          "A gateway that runs LLM inference inside hardware enclaves and attests every request, so regulated firms can use AI on sensitive data.",
      },
      labels.code,
      "your company profile",
    ),
  },
  counterparts: new Map([
    [
      ZINO_ORG,
      investorProfileFacts(
        {
          investorType: "ANGEL",
          hqCountry: "NG",
          publicDescription:
            "I’m a founder and angel investor actively backing pre-seed companies, typically investing around €3 million, across B2B SaaS, enterprise software, fintech and consumer markets. I look for ambitious teams with strong technical capability, deep domain expertise, repeat-founder experience or enterprise-sales strength, building scalable businesses that solve meaningful customer problems. I’m open to regulated businesses and prefer to engage with founders early, where strategic capital and practical experience can help support growth.",
        },
        labels,
        "their Capital Q profile",
      ),
    ],
  ]),
};

// The thread reader's facts for Zino's reply (plausible: a question,
// wanting to connect, about their company).
const FACTS = new Map([
  [
    REL,
    {
      lastFrom: "THEM" as const,
      asksQuestion: true,
      wantsToMeet: true,
      proposedTime: null,
      topicNumbers: [2],
      mentionsTermsOrMoney: false,
      declined: false,
      tone: "POSITIVE" as const,
      questionAbout: ["OTHER" as const],
    },
  ],
]);

const action = (name: string, input: z.ZodType): AnyAppAction =>
  ({
    name,
    classification: "CONSEQUENTIAL",
    does: name,
    input,
    authorize: () => Promise.resolve({ ok: true }),
    run: () => Promise.resolve({}),
  }) as unknown as AnyAppAction;
const ACTIONS = [
  action(
    "chat.message.send",
    z
      .object({
        relationshipId: z.string(),
        idempotencyKey: z.string().min(8),
        input: z.object({ kind: z.literal("TEXT"), body: z.string() }).strict(),
      })
      .strict(),
  ),
  action("schedule.meeting.book", z.object({}).passthrough()),
];

const reply = (
  body: string,
  asks: "MEETING" | "QUESTION" | "NONE",
): InstructionPlanStep => ({
  action: "chat.message.send",
  argumentsJson: JSON.stringify({
    relationshipId: REL,
    idempotencyKey: "model-written-key",
    input: { kind: "TEXT", body },
  }),
  topic: "their company",
  touchesTermsOrMoney: false,
  words: "Reply to Zino Aviation.",
  message: { kind: "REPLY", asks },
});

const verdict = (step: InstructionPlanStep, delegated: boolean) => {
  const out = validateStep(step, {
    grant: GRANT,
    actions: ACTIONS,
    people: PEOPLE,
    sent: new Map(),
    now: NOW,
    stepKey: "instr:4fe0050f:prod:0",
    facts: FACTS,
    material: MATERIAL,
    introduced: new Set([REL]),
    delegation: delegated ? DELEGATION : null,
    delegatedToday: { count: 0 },
    threads: new Map([
      [
        REL,
        {
          theirTerms: distinctiveWords(THEIR_LATEST),
          ourNumbers: threadOwnNumbers(transcriptOf(THREAD)),
        },
      ],
    ]),
  });
  return out.verdict === "REFUSED"
    ? `REFUSED:${out.code}`
    : `${out.verdict}${out.code === null ? "" : `:${out.code}`}`;
};

// What a v7 planner writes for a founder's reply: 60-120 words, specific
// opening, one proof point, one soft ask.
const WARM_DECK_AND_TIME = reply(
  "Thanks Zino — glad the enclave approach resonates. In practice, regulated firms evaluate the gateway with a scoped pilot on one sensitive workload: their security team checks each request's attestation, and compliance reviews the policy logs before wider rollout. Two of our 4 design partners converted to $180k contracts that way. Happy to share our deck here, and glad to find 30 minutes next week if that suits you.",
  "MEETING",
);
const WARM_DECK_ONLY = reply(
  "Thanks Zino — glad the enclave approach resonates. In practice, regulated firms evaluate the gateway with a scoped pilot on one sensitive workload: their security team checks each request's attestation, and compliance reviews the policy logs before wider rollout. Two of our 4 design partners converted to $180k contracts that way. Happy to share our deck here if it would be useful.",
  "NONE",
);
const SHORT_WARM = reply(
  "Thanks Zino. Regulated firms evaluate the gateway with a scoped pilot on one sensitive workload, checking each request's attestation before rollout. Happy to share our deck here.",
  "NONE",
);
// What a planner that sees only the typed facts ("asks a question; wants
// to meet; about: their company") plausibly writes.
const PLAIN_THANKS = reply(
  "Thank you, Zino, and glad the approach resonates. We would be glad to connect. Happy to share our deck here, and to walk you through how regulated firms are evaluating the gateway in practice.",
  "NONE",
);
const ANGEL_FOCUS = reply(
  "Thanks for coming back to us, Zino. Your openness to regulated businesses is exactly why we reached out: we run LLM inference inside hardware enclaves so regulated firms can use AI on sensitive data. Would it be useful if I shared our deck here?",
  "QUESTION",
);
const INVENTED = reply(
  "Thanks Zino — glad the enclave approach resonates. Regulated firms evaluate the gateway with a scoped pilot; 12 banks signed $950k contracts last quarter. Happy to share our deck here.",
  "NONE",
);

describe("production inputs, 4fe0050f (Tensorgate -> Zino Aviation)", () => {
  it("a warm, specific 60-120 word reply passes -- sent under the delegation, a card without it", () => {
    expect(verdict(WARM_DECK_ONLY, true)).toBe("AUTO");
    expect(verdict(WARM_DECK_ONLY, false)).toBe("AUTO");
    expect(verdict(SHORT_WARM, true)).toBe("AUTO");
    expect(verdict(PLAIN_THANKS, true)).toBe("AUTO");
    expect(verdict(ANGEL_FOCUS, true)).toBe("AUTO");
  });

  it("offering a time: under the delegation it goes; without it, the founder's card", () => {
    expect(verdict(WARM_DECK_AND_TIME, true)).toBe("AUTO");
    expect(verdict(WARM_DECK_AND_TIME, false)).toBe("ASK:MEETING_NEEDS_YES");
  });

  it("an invented number is still refused", () => {
    expect(verdict(INVENTED, true)).toBe("REFUSED:UNGROUNDED_NUMBER");
  });
});
