import { describe, expect, it } from "vitest";

import type { QAttentionReport, QStreamEvent } from "@capital-q/contracts";
import { createLogger } from "@capital-q/observability";
import {
  factsForVoice,
  spokenFactsOfAttention,
  spokenFidelityIssues,
  type SpokenFacts,
} from "@capital-q/q-core";
import type {
  QRunRecord,
  QRunStreamService,
  QRuntimeService,
} from "@capital-q/q-runtime";
import {
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
} from "@capital-q/security";

import type { VoiceSessionBinding } from "../src/voice/bindings.js";
import type { VoiceSpeaker } from "../src/voice/provider.js";
import { createVoiceTurnHandler } from "../src/voice/turn.js";

/**
 * RECOVERY B1 on voice (workstream A, with B): "what needs my attention"
 * is said from the attention report's items, by name, or truthfully as
 * nothing waiting; a source that could not be read is said as unchecked,
 * never as empty. Never a generic line. No provider call: the run stream
 * and the report reader are fakes.
 */

const ACTOR: ActorContext = {
  userId: UserIdSchema.parse("b0000000-0000-4000-8000-000000000001"),
  tenantId: TenantIdSchema.parse("c0000000-0000-4000-8000-000000000001"),
  organisationId: OrganisationIdSchema.parse(
    "d0000000-0000-4000-8000-000000000001",
  ),
  actorType: "HUMAN",
};
const RUN_ID = "f0000000-0000-4000-8000-000000000030";
const NOW = "2026-10-08T19:15:13.000Z";
const RUN = {
  id: RUN_ID,
  conversationId: "f0000000-0000-4000-8000-000000000031",
  status: "RECEIVED",
} as unknown as QRunRecord;
const logger = createLogger(
  { serviceName: "q-api-test", environment: "test" },
  { level: "silent" },
);
const ASKED = "Find anything that needs my attention.";

function report(partial: Partial<QAttentionReport> = {}): QAttentionReport {
  return {
    items: [],
    activity: null,
    unread: [],
    readAt: NOW,
    ...partial,
  };
}

const TWO = report({
  items: [
    {
      key: "msg:1",
      source: "UNANSWERED_MESSAGE",
      title: "Zino Aviation is waiting for your reply",
      note: "They wrote 21 hours ago",
      counterpart: "Zino Aviation",
      since: NOW,
      decidable: false,
    },
    {
      key: "appr:1",
      source: "APPROVAL",
      title: "A note to Halyard Security waits for your approval",
      counterpart: "Halyard Security",
      since: NOW,
      decidable: true,
    },
  ],
});

/** The answer as B's code writes it (attention-answer.ts), on screen. */
function writtenAnswer(r: QAttentionReport): string {
  if (r.items.length === 0) {
    return r.unread.length === 0
      ? "Nothing is waiting on you right now: no messages to answer, approvals, requests, calls to arrange, reminders due or notices."
      : "I found nothing waiting in the places I could check.\nI couldn't check your messages just now, so something may be waiting there that I can't see yet.";
  }
  return [
    `${String(r.items.length)} things need you:`,
    ...r.items.map(
      (item, i) =>
        `${String(i + 1)}. ${item.title}${item.note === undefined ? "" : ` — ${item.note}`}`,
    ),
  ].join("\n");
}

function binding(): VoiceSessionBinding {
  return {
    voiceSessionId: "vs-attention",
    providerConversationId: "conv_1",
    actor: ACTOR,
    accessToken: "eyPRIVATE.bearer",
    voice: "FEMALE",
    thread: {
      conversationId: undefined,
      subjects: undefined,
      onboarding: undefined,
    },
    issuedAt: 0,
    connectBy: 1,
    connectedAt: 0,
  };
}

const event = (type: string, data: Record<string, unknown>): QStreamEvent =>
  ({
    type,
    runId: RUN_ID,
    sequence: 1,
    occurredAt: NOW,
    data,
  }) as unknown as QStreamEvent;

function handler(
  text: string,
  read: QAttentionReport | (() => never),
  blocks?: readonly unknown[],
) {
  const qRuntime = {
    createRun: () =>
      Promise.resolve({
        run: RUN,
        conversation: {} as never,
        message: {} as never,
        created: true,
      }),
    cancelRun: () =>
      Promise.resolve({ run: RUN, changed: true, summary: {} as never }),
  } as unknown as QRuntimeService;
  const events = [
    event("q.message.completed", {
      message: {
        messageId: "m1",
        runId: RUN_ID,
        role: "Q",
        text,
        createdAt: NOW,
        ...(blocks === undefined ? {} : { blocks }),
      },
    }),
    event("q.run.completed", { status: "COMPLETED", completedAt: NOW }),
  ];
  const qStream: QRunStreamService = {
    authorize: () => Promise.resolve(RUN),
    open: async function* () {
      for (const item of events) {
        yield { kind: "durable" as const, event: item };
        await Promise.resolve();
      }
      yield { kind: "end" as const, reason: "TERMINAL" as const };
    },
    stats: () => ({
      noticeSubscribers: 0,
      deltaSubscribers: 0,
      deltasDropped: 0,
    }),
  };
  return createVoiceTurnHandler({
    qRuntime,
    qStream,
    logger,
    attention: () =>
      typeof read === "function"
        ? Promise.reject(new Error("down"))
        : Promise.resolve(read),
  });
}

async function say(
  text: string,
  read: QAttentionReport | (() => never),
  withFacts = false,
  options: { blocks?: readonly unknown[]; asked?: string } = {},
) {
  const spoken: string[] = [];
  let facts: SpokenFacts | null = null;
  const speaker: VoiceSpeaker = {
    providerConversationId: "conv_1",
    isOpen: true,
    speak: async (response) => {
      if (typeof response === "string") {
        spoken.push(response.trim());
        return;
      }
      for await (const part of response) spoken.push(part.trim());
    },
    close: () => undefined,
    ...(withFacts
      ? {
          facts: (given: SpokenFacts) => {
            facts = given;
          },
        }
      : {}),
  };
  await handler(text, read, options.blocks)(
    binding(),
    [{ role: "user", content: options.asked ?? ASKED }],
    new AbortController().signal,
    speaker,
  );
  return { said: spoken.filter((s) => s.length > 0).join(" "), facts };
}

describe("'what needs my attention', said from the attention report", () => {
  it("names the real items, in order, on the standard line", async () => {
    const { said } = await say(writtenAnswer(TWO), TWO);
    expect(said).toContain("Zino Aviation is waiting for your reply");
    expect(said).toContain(
      "a note to Halyard Security waits for your approval",
    );
    expect(said).not.toMatch(/nothing is waiting/iu);
  });

  it("hands the duplex voice the items as must-say facts", async () => {
    const { facts } = await say(writtenAnswer(TWO), TWO, true);
    const given = facts as SpokenFacts | null;
    expect(given?.kind).toBe("ATTENTION");
    expect(given?.mustSay).toEqual(["Zino Aviation", "Halyard Security"]);
  });

  it("says truthfully that nothing is waiting, when every source was read and none had anything", async () => {
    const empty = report();
    const { said } = await say(writtenAnswer(empty), empty);
    expect(said).toBe("Nothing is waiting on you right now.");
  });

  it("never says 'nothing' for a source it could not read", async () => {
    const unread = report({ unread: ["UNANSWERED_MESSAGE"] });
    const { said } = await say(writtenAnswer(unread), unread);
    expect(said).not.toMatch(/nothing is waiting on you/iu);
    expect(said).toMatch(/couldn't check your messages/iu);
  });

  it("never says the written answer when the report does not match it or cannot be read: it points to the screen (V 2026-10-09)", async () => {
    const shown = writtenAnswer(QUOTING);
    const mismatch = await say(shown, report());
    expect(mismatch.said).toBe("What needs you is on your screen now.");
    const failed = await say(shown, () => {
      throw new Error("down");
    });
    expect(failed.said).toBe("What needs you is on your screen now.");
    for (const said of [mismatch.said, failed.said]) {
      expect(said).not.toMatch(/They wrote|lunch on Thursday/u);
    }
  });
});

/** A counterpart's message, quoted in the written answer's note. */
const QUOTING = report({
  items: [
    {
      key: "msg:2",
      source: "UNANSWERED_MESSAGE",
      title: "Spheros is waiting for your reply",
      note: 'They wrote: "Thanks — can we do lunch on Thursday?"',
      counterpart: "Spheros",
      since: NOW,
      decidable: false,
    },
  ],
});

describe("an attention answer is always said from its facts: names, never message bodies (V 2026-10-09)", () => {
  it("an answer carrying its ATTENTION block is said from that report, on any question", async () => {
    const { said, facts } = await say(writtenAnswer(QUOTING), report(), true, {
      blocks: [{ kind: "ATTENTION", report: QUOTING }],
      asked: "Anything from Spheros?",
    });
    expect(said).toContain("Spheros is waiting for your reply");
    expect(said).not.toMatch(/They wrote|lunch on Thursday/u);
    const given = facts as SpokenFacts | null;
    expect(given?.kind).toBe("ATTENTION");
    expect(given?.mustSay).toEqual(["Spheros"]);
    // The duplex and live voices get no item detail that quotes anyone.
    expect(
      JSON.stringify(factsForVoice(given ?? spokenFactsOfAttention(QUOTING))),
    ).not.toMatch(/They wrote|lunch/u);
  });

  it("a written answer that quotes a message, with no block and another question, is still said from facts", async () => {
    const { said } = await say(writtenAnswer(QUOTING), QUOTING, false, {
      asked: "Anything from Spheros?",
    });
    expect(said).toContain("Spheros is waiting for your reply");
    expect(said).not.toMatch(/They wrote|lunch on Thursday/u);
  });

  it("the attention facts never carry an item's note", () => {
    const facts = spokenFactsOfAttention(QUOTING);
    expect(facts.items.every((item) => item.does === null)).toBe(true);
    expect(JSON.stringify(factsForVoice(facts))).not.toMatch(/They wrote/u);
  });
});

describe("the attention facts' fidelity checks", () => {
  it("the fallback passes; a generic line, or 'nothing' while something waits, does not", () => {
    const facts = spokenFactsOfAttention(TWO);
    expect(spokenFidelityIssues(facts.fallback, facts)).toEqual([]);
    expect(
      spokenFidelityIssues("You've got a couple of things to look at.", facts),
    ).toContain("MUST_SAY");
    expect(
      spokenFidelityIssues(
        "Nothing is waiting on you, though Zino Aviation and Halyard Security wrote.",
        facts,
      ),
    ).toContain("MUST_SAY");
    const unread = spokenFactsOfAttention(report({ unread: ["MEETING"] }));
    expect(spokenFidelityIssues(unread.fallback, unread)).toEqual([]);
    expect(spokenFidelityIssues("Nothing is waiting.", unread)).toContain(
      "MUST_SAY",
    );
  });
});
