import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  Q_CHALLENGE_LEVELS,
  Q_EXPLANATION_STYLES,
  Q_QUESTION_STYLES,
  Q_RESPONSE_DEPTHS,
  Q_TONES,
  type PermittedContextPlan,
} from "@capital-q/contracts";
import type {
  TransactionContext,
  TransactionManager,
} from "@capital-q/database";
import { DEFAULT_COMMUNICATION_PROFILE } from "@capital-q/q-core";
import { ActorContextSchema, type ActorContext } from "@capital-q/security";

import {
  compactThread,
  COMMUNICATION_ASPECTS,
  communicationProfileFromMemory,
  createLoopMemoryReader,
  createMemoryService,
  createPreferenceNotebook,
  type CommunicationAspect,
  type ThreadTurn,
} from "../src/index.js";
import type { MemoryItem } from "../src/memory/contracts.js";
import type {
  MemoryRepository,
  NewMemoryItem,
} from "../src/memory/postgres-memory-repository.js";

/**
 * Memory in the loop (CQ-QX-007 P0-5), as properties.
 *
 *   - A preference the person states at turn t holds for every later turn
 *     of that conversation, and — when stated as a rule — in the next.
 *   - It never appears for another person, nor (session-scoped) in another
 *     conversation.
 *   - Nothing reaches memory except through the Write Gate with the
 *     person's own words.
 *   - Recall happens only through the firewall's own-conversation scope.
 *   - The compacted thread is bounded, keeps the recent turns verbatim and
 *     never says anything the record does not.
 *
 * Randomised with a seeded generator, so a failure reproduces.
 */

function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}
const pick = <T>(random: () => number, items: readonly T[]): T =>
  items[Math.floor(random() * items.length)] as T;

const VALUES: Readonly<Record<CommunicationAspect, readonly string[]>> = {
  responseDepth: Q_RESPONSE_DEPTHS,
  tone: Q_TONES,
  challengeLevel: Q_CHALLENGE_LEVELS,
  questionStyle: Q_QUESTION_STYLES,
  explanationStyle: Q_EXPLANATION_STYLES,
};

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const person = (userId: string): ActorContext =>
  ActorContextSchema.parse({ userId, tenantId: TENANT, actorType: "HUMAN" });

/** A store over the real Write Gate. Live = active, per key. */
function store() {
  const rows: MemoryItem[] = [];
  let clock = Date.parse("2026-09-25T00:00:00.000Z");
  const live = (r: MemoryItem) => r.status === "active";
  const owned = (
    r: MemoryItem,
    tenantId: string,
    owner: { ownerContextType: string; ownerContextId: string },
  ) =>
    r.tenantId === tenantId &&
    r.ownerContextType === owner.ownerContextType &&
    r.ownerContextId === owner.ownerContextId;
  const repository: MemoryRepository = {
    listLive: (_e, tenantId, owner, limit) =>
      Promise.resolve(
        rows
          .filter((r) => owned(r, tenantId, owner) && live(r))
          .slice(0, limit),
      ),
    findLiveByKey: (_e, tenantId, owner, type, key) =>
      Promise.resolve(
        rows.find(
          (r) =>
            owned(r, tenantId, owner) &&
            live(r) &&
            r.memoryType === type &&
            r.memoryKey === key,
        ) ?? null,
      ),
    findLiveByHash: (_e, tenantId, owner, hash) =>
      Promise.resolve(
        rows.find(
          (r) =>
            owned(r, tenantId, owner) && live(r) && r.contentSha256 === hash,
        ) ?? null,
      ),
    insert: (_tx, input: NewMemoryItem) => {
      clock += 1_000;
      const now = new Date(clock).toISOString();
      const item: MemoryItem = {
        id: randomUUID(),
        tenantId: input.tenantId,
        ownerContextType: input.owner.ownerContextType,
        ownerContextId: input.owner.ownerContextId,
        subject: null,
        memoryType: input.memoryType,
        memoryKey: input.memoryKey,
        content: input.content,
        structuredValue: input.structuredValue,
        quote: input.quote,
        contentSha256: input.contentSha256,
        sourceConversationId: input.sourceConversationId,
        sourceRunId: input.sourceRunId,
        writeMode: input.writeMode,
        status: input.status,
        supersededBy: null,
        validFrom: now,
        validTo: null,
        lastUsedAt: null,
        useCount: 0,
        createdAt: now,
        updatedAt: now,
      };
      rows.push(item);
      return Promise.resolve(item);
    },
    supersede: (_tx, _tenant, _owner, id, by) => {
      const index = rows.findIndex((r) => r.id === id);
      const row = rows[index];
      if (row !== undefined) {
        rows[index] = { ...row, status: "superseded", supersededBy: by };
      }
      return Promise.resolve();
    },
    forget: () => Promise.resolve(null),
    markUsed: () => Promise.resolve(),
  };
  const tx = {
    sql: Object.assign(() => Promise.resolve([]), {}),
  } as unknown as TransactionContext;
  const transactions: TransactionManager = { run: (work) => work(tx) };
  return {
    rows,
    memory: createMemoryService({ sql: tx.sql, transactions, repository }),
  };
}

/** The firewall's actor-wide own-conversation scope for `userId`. */
const ownPlan = (userId: string) =>
  ({
    scopes: [
      {
        kind: "OWN_Q_CONVERSATION",
        filter: { tenantId: TENANT, userId },
      },
    ],
  }) as unknown as Pick<PermittedContextPlan, "scopes">;

describe("a stated preference holds, for that person only", () => {
  it("holds for every later turn of the conversation, and as a rule in the next, never for anybody else (200 random runs)", async () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const random = rng(seed);
      const { memory } = store();
      const alice = person(randomUUID());
      const bob = person(randomUUID());
      const session = randomUUID();
      const nextSession = randomUUID();
      const reader = createLoopMemoryReader({ memory });

      // What the person says over the conversation: some turns state a
      // preference (and the model notes it), most do not.
      const expectedSession: Partial<Record<CommunicationAspect, string>> = {};
      const expectedLongTerm: Partial<Record<CommunicationAspect, string>> = {};
      const priorTurns: string[] = [];
      const turns = 3 + Math.floor(random() * 8);
      for (let turn = 0; turn < turns; turn += 1) {
        const said = `turn ${String(turn)} of seed ${String(seed)}: something the person said`;
        if (random() < 0.5) {
          const aspect = pick(random, COMMUNICATION_ASPECTS);
          const value = pick(random, VALUES[aspect]);
          const persistence = random() < 0.5 ? "SESSION" : "LONG_TERM";
          const notebook = createPreferenceNotebook({
            memory,
            actor: alice,
            sessionKey: session,
            priorUserTurns: priorTurns,
          });
          const result = await notebook.note({
            aspect,
            value,
            persistence,
            quote: said.slice(0, 30),
            latestUserText: said,
          });
          expect(result.outcome).not.toBe("REFUSED");
          if (persistence === "SESSION") expectedSession[aspect] = value;
          else expectedLongTerm[aspect] = value;
        }
        priorTurns.push(said);

        // Every later turn of this conversation sees everything so far,
        // the session's own word outranking the standing rule.
        const now = await reader.read({
          actor: alice,
          plan: ownPlan(alice.userId),
          sessionKey: session,
        });
        expect(now.profile).toEqual({
          ...DEFAULT_COMMUNICATION_PROFILE,
          ...expectedLongTerm,
          ...expectedSession,
        });
      }

      // The next conversation keeps only the rules.
      const next = await reader.read({
        actor: alice,
        plan: ownPlan(alice.userId),
        sessionKey: nextSession,
      });
      expect(next.profile).toEqual({
        ...DEFAULT_COMMUNICATION_PROFILE,
        ...expectedLongTerm,
      });
      for (const aspect of Object.keys(
        expectedSession,
      ) as CommunicationAspect[]) {
        expect(next.memory).not.toContain(`for this conversation: ${aspect}`);
      }

      // Somebody else, in the same conversation id, gets none of it.
      const other = await reader.read({
        actor: bob,
        plan: ownPlan(bob.userId),
        sessionKey: session,
      });
      expect(other.profile).toEqual(DEFAULT_COMMUNICATION_PROFILE);
      expect(other.memory).toBe("");
    }
  });

  it("writes nothing the person did not say, and nothing for another owner", async () => {
    const { memory, rows } = store();
    const alice = person(randomUUID());
    const notebook = createPreferenceNotebook({
      memory,
      actor: alice,
      sessionKey: randomUUID(),
      priorUserTurns: ["can you keep it short please"],
    });
    const invented = await notebook.note({
      aspect: "responseDepth",
      value: "CONCISE",
      persistence: "LONG_TERM",
      quote: "I prefer very short answers",
      latestUserText: "what's my next step?",
    });
    expect(invented).toEqual({
      outcome: "REFUSED",
      reason: "QUOTE_NOT_IN_TURNS",
    });
    const said = await notebook.note({
      aspect: "responseDepth",
      value: "CONCISE",
      persistence: "LONG_TERM",
      quote: "keep it short",
      latestUserText: "what's my next step?",
    });
    expect(said.outcome).toBe("REMEMBERED");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.ownerContextId).toBe(alice.userId);
    expect(rows[0]?.structuredValue).toEqual({ responseDepth: "CONCISE" });
    expect(rows[0]?.memoryKey).toBe("preference.communication.response_depth");
  });

  it("recalls nothing without the firewall's own-conversation scope for this person", async () => {
    const { memory } = store();
    const alice = person(randomUUID());
    await createPreferenceNotebook({
      memory,
      actor: alice,
      sessionKey: null,
      priorUserTurns: ["just give me the result"],
    }).note({
      aspect: "responseDepth",
      value: "CONCISE",
      persistence: "LONG_TERM",
      quote: "just give me the result",
      latestUserText: null,
    });
    const reader = createLoopMemoryReader({ memory });
    for (const plan of [{ scopes: [] }, ownPlan(randomUUID())] as Pick<
      PermittedContextPlan,
      "scopes"
    >[]) {
      const read = await reader.read({ actor: alice, plan, sessionKey: null });
      expect(read.memory).toBe("");
      expect(read.profile).toEqual(DEFAULT_COMMUNICATION_PROFILE);
    }
    const granted = await reader.read({
      actor: alice,
      plan: ownPlan(alice.userId),
      sessionKey: null,
    });
    expect(granted.profile.responseDepth).toBe("CONCISE");
  });

  it("ignores a value outside the contract instead of guessing", () => {
    const item = {
      id: randomUUID(),
      memoryType: "preference",
      memoryKey: "preference.communication.response_depth",
      structuredValue: { responseDepth: "TINY" },
      status: "active",
      validTo: null,
      validFrom: "2026-09-25T00:00:00.000Z",
    } as unknown as MemoryItem;
    expect(
      communicationProfileFromMemory([item], { conversationId: null }),
    ).toEqual(DEFAULT_COMMUNICATION_PROFILE);
  });
});

describe("the compacted thread", () => {
  const words = [
    "we",
    "raise",
    "seed",
    "in",
    "Lagos",
    "380k",
    "GMV",
    "pilots",
    "Kenya",
    "fintech",
    "no",
    "yes",
  ];
  function randomThread(random: () => number): ThreadTurn[] {
    const count = Math.floor(random() * 120);
    return Array.from({ length: count }, (_, index) => {
      const length = 1 + Math.floor(random() * 60);
      const text = Array.from({ length }, () => pick(random, words))
        .join(random() < 0.2 ? ". " : " ")
        .concat(random() < 0.5 ? "." : "");
      return {
        role: index % 2 === 0 ? ("PERSON" as const) : ("Q" as const),
        text,
      };
    });
  }

  it("is bounded, keeps the recent turns verbatim, and only ever quotes the record (300 random threads)", () => {
    for (let seed = 1; seed <= 300; seed += 1) {
      const random = rng(seed);
      const thread = randomThread(random);
      const recentTurns = Math.floor(random() * 20);
      const summaryMaxChars = 200 + Math.floor(random() * 3_000);
      const compacted = compactThread(thread, {
        recentTurns,
        summaryMaxChars,
      });
      // Bounded.
      expect(compacted.recent.length).toBeLessThanOrEqual(recentTurns);
      expect(compacted.summary?.length ?? 0).toBeLessThanOrEqual(
        summaryMaxChars,
      );
      // The recent window is the verbatim tail.
      expect(compacted.recent).toEqual(
        thread.slice(thread.length - compacted.recent.length),
      );
      // Every condensed line is an exact opening of an older turn by the
      // same speaker: nothing said that the record does not say.
      const older = thread.slice(0, thread.length - compacted.recent.length);
      const lines = (compacted.summary ?? "").split("\n").slice(1);
      for (const line of lines) {
        const match = /^- (Person|Q): "(.*?)( …)?"$/.exec(line);
        expect(match, line).not.toBeNull();
        const role = match?.[1] === "Person" ? "PERSON" : "Q";
        const excerpt = match?.[2] ?? "";
        expect(
          older.some(
            (turn) =>
              turn.role === role &&
              turn.text.replace(/\s+/g, " ").trim().startsWith(excerpt),
          ),
          line,
        ).toBe(true);
      }
      // Accounted for: shown plus omitted is every older turn.
      expect(lines.length + compacted.omitted).toBe(older.length);
      // Deterministic.
      expect(compactThread(thread, { recentTurns, summaryMaxChars })).toEqual(
        compacted,
      );
    }
  });

  it("changes nothing when the thread already fits the window", () => {
    const thread: ThreadTurn[] = [
      { role: "PERSON", text: "We are seed stage." },
      { role: "Q", text: "Noted." },
    ];
    expect(compactThread(thread, { recentTurns: 12 })).toEqual({
      summary: null,
      recent: thread,
      omitted: 0,
    });
  });
});
