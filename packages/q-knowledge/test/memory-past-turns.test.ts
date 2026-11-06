import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { ActorContextSchema } from "@capital-q/security";

import type { MemoryPastTurn } from "../src/memory/contracts.js";
import type { MemoryRepository } from "../src/memory/postgres-memory-repository.js";
import { PAST_TURNS_LABEL, renderMemoryBundle } from "../src/memory/render.js";
import {
  createMemoryService,
  type MemoryConversationDigestPort,
} from "../src/memory/service.js";

/**
 * Q intelligence step 9: "what did we say about X last week?" is answered
 * from search over the person's own past turns. The memory service reads
 * them only when the caller resolved that the plan admits the person's own
 * conversations (authorisation before retrieval), only for a human, never
 * from the conversation they are in, and renders their words as theirs and
 * Q's as Q's. Fakes only; the SQL's owner scoping is the q-runtime
 * integration test and pgTAP 999_q_runtime_message_search.
 */

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const person = ActorContextSchema.parse({
  userId: "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1",
  tenantId: TENANT,
  actorType: "HUMAN",
});
const HERE = randomUUID();
const LAST_WEEK = randomUUID();

const turns: MemoryPastTurn[] = [
  {
    conversationId: LAST_WEEK,
    conversationTitle: "Ledgerline",
    role: "USER",
    content:
      "I'm going to pass on Ledgerline Systems: the runway is too short.",
    at: "2026-10-30T10:00:00.000Z",
  },
  {
    conversationId: LAST_WEEK,
    conversationTitle: "Ledgerline",
    role: "Q",
    content: "Understood — you're passing on Ledgerline Systems.",
    at: "2026-10-30T10:00:05.000Z",
  },
  {
    conversationId: HERE,
    conversationTitle: null,
    role: "USER",
    content: "Ledgerline again (this conversation).",
    at: "2026-11-06T10:00:00.000Z",
  },
];

function serviceWith() {
  const searched: { text: string; except: readonly string[] }[] = [];
  const conversations: MemoryConversationDigestPort = {
    digestOf: () => Promise.resolve(null),
    recentDigests: () => Promise.resolve([]),
    pastTurns: (_actor, query) => {
      searched.push({ text: query.text, except: query.except });
      return Promise.resolve(turns);
    },
  };
  const memory = createMemoryService({
    sql: Object.assign(() => Promise.resolve([]), {}) as never,
    transactions: { run: (work) => work({} as never) },
    repository: {
      listLive: () => Promise.resolve([]),
      markUsed: () => Promise.resolve(),
    } as unknown as MemoryRepository,
    conversations,
  });
  return { memory, searched };
}

describe("recall of the person's own past turns (step 9)", () => {
  it("is not searched unless the plan admitted their own conversations", async () => {
    const { memory, searched } = serviceWith();
    const bundle = await memory.recall({
      actor: person,
      conversationId: HERE,
      utterance: "What did I decide about Ledgerline last week?",
    });
    expect(bundle.pastTurns).toBeUndefined();
    expect(searched).toEqual([]);
  });

  it("is never searched for a non-human actor", async () => {
    const { memory, searched } = serviceWith();
    const bundle = await memory.recall({
      actor: { ...person, actorType: "SYSTEM" },
      conversationId: HERE,
      utterance: "Ledgerline",
      ownConversationsAdmitted: true,
    });
    expect(bundle.pastTurns).toBeUndefined();
    expect(searched).toEqual([]);
  });

  it("searches their words and their earlier words here, leaves this conversation out, and renders who said what", async () => {
    const { memory, searched } = serviceWith();
    const bundle = await memory.recall({
      actor: person,
      conversationId: HERE,
      utterance: "Why?",
      earlierWords: ["What did I decide about Ledgerline last week?"],
      ownConversationsAdmitted: true,
    });
    expect(searched).toEqual([
      {
        text: "Why?\nWhat did I decide about Ledgerline last week?",
        except: [HERE],
      },
    ]);
    expect(bundle.pastTurns?.map((t) => t.role)).toEqual(["USER", "Q"]);
    const text = renderMemoryBundle(bundle);
    expect(text.startsWith(PAST_TURNS_LABEL)).toBe(true);
    expect(text).toContain(
      `- 2026-10-30 (in "Ledgerline"), they said: "I'm going to pass on Ledgerline Systems: the runway is too short."`,
    );
    expect(text).toContain(
      `- 2026-10-30 (in "Ledgerline"), Q said: "Understood — you're passing on Ledgerline Systems."`,
    );
    expect(text).not.toContain("this conversation).");
  });

  it("a failed search is absent (unknown), never 'none' and never a failed recall", async () => {
    const memory = createMemoryService({
      sql: Object.assign(() => Promise.resolve([]), {}) as never,
      transactions: { run: (work) => work({} as never) },
      repository: {
        listLive: () => Promise.resolve([]),
        markUsed: () => Promise.resolve(),
      } as unknown as MemoryRepository,
      conversations: {
        digestOf: () => Promise.resolve(null),
        recentDigests: () => Promise.resolve([]),
        pastTurns: () => Promise.reject(new Error("down")),
      },
    });
    const bundle = await memory.recall({
      actor: person,
      utterance: "Ledgerline",
      ownConversationsAdmitted: true,
    });
    expect(bundle.pastTurns).toBeUndefined();
  });
});
