import { createHash } from "node:crypto";

import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";
import type { Logger } from "@capital-q/observability";
import type { ActorContext } from "@capital-q/security";

import { quoteOccursIn } from "../q/statement-recorder.js";
import {
  MemoryCandidateSchema,
  SMALL_TALK_RETENTION_DAYS,
  type MemoryBundle,
  type SmallTalkThread,
  type MemoryCandidate,
  type MemoryConversationDigest,
  type MemoryItem,
  type MemoryOwner,
  type MemoryRehearsalDigest,
  type MemoryWriteMode,
  type MemoryWriteResult,
} from "./contracts.js";
import type { MemoryRepository } from "./postgres-memory-repository.js";
import {
  connectedRecallWithin,
  planGraphRecall,
  type RecallGraphPort,
} from "./graph.js";
import { asksAboutRehearsal, recallTermsFrom } from "./recall-terms.js";

/**
 * The memory service (doc 14 §130; ADR 0012): retrieve, remember, forget.
 *
 * `remember` is the memory write gate, and it is the only path into the
 * table. Its order is fixed:
 *
 *   candidate → schema → owner (the actor, never the candidate) → quote
 *   verified against the person's recorded turns → sensitive content
 *   refused → dedupe by content hash → supersede by key → persist
 *
 * A model never chooses the owner, the tenant, the status or the write
 * mode. It proposes a typed candidate with a quote; the quote must occur
 * in what the person actually said in this run, or nothing is written.
 * That is the whole defence against a memory nobody stated, and it is
 * deterministic.
 */

export type MemoryConversationDigestPort = {
  /** This conversation's title and summary, when it is the actor's and has one. */
  readonly digestOf: (
    actor: ActorContext,
    conversationId: string,
  ) => Promise<{
    readonly title: string | null;
    readonly summary: string | null;
  } | null>;
  /** The actor's other recent conversations that carry a summary. */
  readonly recentDigests: (
    actor: ActorContext,
    exceptConversationId: string | null,
    limit: number,
  ) => Promise<readonly MemoryConversationDigest[]>;
  /**
   * The actor's own summarised conversations about one of `companyIds` or
   * mentioning one of `terms`, newest first, whatever their recency.
   * Optional: without it recall has no relevant section.
   */
  readonly relevantDigests?: (
    actor: ActorContext,
    query: {
      readonly companyIds: readonly string[];
      readonly terms: readonly string[];
      readonly except: readonly string[];
      readonly limit: number;
    },
  ) => Promise<readonly MemoryConversationDigest[]>;
};

/**
 * The person's own finished, reviewed rehearsals (owner and tenant from
 * the actor, never from the caller), newest first. Founder-private
 * practice: read only for that person's own recall.
 */
export type MemoryRehearsalPort = {
  readonly recentForOwner: (
    actor: ActorContext,
    limit: number,
  ) => Promise<readonly MemoryRehearsalDigest[]>;
};

export type MemoryServiceDependencies = {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
  readonly repository: MemoryRepository;
  /** Conversation working memory, read from the runtime's own store. */
  readonly conversations?: MemoryConversationDigestPort | undefined;
  /** Optional: without it recall has no rehearsal section. */
  readonly rehearsals?: MemoryRehearsalPort | undefined;
  /**
   * Optional: connected recall over the person's own records (graph.ts).
   * Without it, or when the turn does not ask across them, none is read.
   */
  readonly graph?: RecallGraphPort | undefined;
  /** The connected read's time budget; late is absent, never awaited. */
  readonly graphBudgetMs?: number | undefined;
  readonly logger?: Logger | undefined;
  /** The clock small talk's lapse is measured on; injected for tests. */
  readonly now?: (() => number) | undefined;
};

export type RecallQuery = {
  readonly actor: ActorContext;
  /** The conversation the run belongs to, when known. */
  readonly conversationId?: string | undefined;
  /** Companies the run is about, for company-subject memory. */
  readonly companyIds?: readonly string[] | undefined;
  /**
   * What the person just asked, when known. Only names are read from it,
   * by code (`recallTermsFrom`), to find earlier conversations about them.
   */
  readonly utterance?: string | undefined;
  readonly limit?: number | undefined;
};

export type RememberCommand = {
  readonly actor: ActorContext;
  readonly candidate: MemoryCandidate;
  /**
   * How this write is being made. Q_PROPOSED (a model read it) and
   * USER_CONFIRMED (the person said yes) both require the quote; only
   * AUTOMATIC_SYSTEM may write without one, for a deterministic platform
   * fact such as a name the person typed at sign-up.
   */
  readonly writeMode: MemoryWriteMode;
  /** The person's own recorded turns in this run, for quote verification. */
  readonly userTurns: readonly string[];
  readonly source: {
    readonly conversationId: string | null;
    readonly runId: string | null;
  };
};

export type ForgetCommand = {
  readonly actor: ActorContext;
  readonly memoryItemId: string;
};

export type MemoryService = {
  readonly recall: (query: RecallQuery) => Promise<MemoryBundle>;
  /**
   * What Q holds about the person, for them to read and correct. Not a
   * recall: nothing is marked used, and it never reaches a prompt.
   */
  readonly list: (actor: ActorContext) => Promise<readonly MemoryItem[]>;
  readonly remember: (command: RememberCommand) => Promise<MemoryWriteResult>;
  readonly forget: (command: ForgetCommand) => Promise<MemoryItem | null>;
  /**
   * ADR 0062: one thread of the person's own small talk for Q to bring
   * back in a long wait, newest first, skipping any already used. Only
   * ever the actor's own memory, only for Q's conversation with them; it
   * is not part of `recall`, so no prompt, assessment or other person's
   * purpose ever reads it.
   */
  readonly smallTalkThread?: (
    actor: ActorContext,
    used: ReadonlySet<string>,
  ) => Promise<SmallTalkThread | null>;
};

/** Small talk's question, from its structured value; null when it has none. */
export function smallTalkFollowUp(item: {
  readonly structuredValue: Readonly<Record<string, unknown>>;
}): string | null {
  const value = item.structuredValue["followUp"];
  if (typeof value !== "string") return null;
  const line = value.replace(/\s+/g, " ").trim();
  return line.length >= 3 && line.length <= 120 ? line : null;
}

/** The owner of everything a person says about themselves: the person. */
export function personOwner(actor: ActorContext): MemoryOwner {
  return { ownerContextType: "user", ownerContextId: actor.userId };
}

export function memoryContentHash(candidate: MemoryCandidate): string {
  return createHash("sha256")
    .update(candidate.memoryType)
    .update("\n")
    .update(candidate.memoryKey)
    .update("\n")
    .update(candidate.content.trim().toLowerCase())
    .digest("hex");
}

/**
 * Things Q must not keep even when the person said them: secrets and
 * identifiers whose only use is impersonation. A structural check on the
 * content, not a judgement about the person; the extractor is told the
 * same rule and this is the deterministic backstop.
 */
export function looksLikeSecret(content: string): boolean {
  const compact = content.replace(/[\s-]/g, "");
  // A long run of digits is a card, account or ID number.
  if (/\d{12,}/.test(compact)) return true;
  // Words that name a credential.
  return /\b(password|passcode|pin code|otp|api key|secret key|private key|bvn|ssn|passport (?:no|number))\b/i.test(
    content,
  );
}

const RECALL_DEFAULT = 40;
const OTHER_CONVERSATIONS = 6;
const RELEVANT_CONVERSATIONS = 4;
export const RECALLED_REHEARSALS = 3;

export function createMemoryService(
  dependencies: MemoryServiceDependencies,
): MemoryService {
  const { sql, transactions, repository, logger } = dependencies;
  const now = dependencies.now ?? (() => Date.now());
  const lapsed = (item: MemoryItem) =>
    item.memoryType === "small_talk" &&
    (item.validTo === null || Date.parse(item.validTo) <= now());

  return {
    smallTalkThread: async (actor, used) => {
      if (actor.actorType !== "HUMAN") return null;
      const items = await repository.listLive(
        sql,
        actor.tenantId,
        personOwner(actor),
        200,
      );
      for (const item of items) {
        if (item.memoryType !== "small_talk" || lapsed(item)) continue;
        if (used.has(item.id)) continue;
        const followUp = smallTalkFollowUp(item);
        if (followUp === null) continue;
        void repository
          .markUsed(sql, actor.tenantId, [item.id])
          .catch((error: unknown) => {
            logger?.debug({ err: error }, "small talk use was not recorded");
          });
        return { memoryItemId: item.id, followUp };
      }
      return null;
    },
    list: async (actor) =>
      (
        await repository.listLive(sql, actor.tenantId, personOwner(actor), 200)
      ).filter((item) => !lapsed(item)),
    recall: async (query) => {
      const owner = personOwner(query.actor);
      const limit = Math.min(Math.max(query.limit ?? RECALL_DEFAULT, 1), 200);
      const items = await repository.listLive(
        sql,
        query.actor.tenantId,
        owner,
        limit,
      );
      const companyIds = new Set(query.companyIds ?? []);
      // Small talk never reaches a prompt through recall (ADR 0062): it is
      // for the silence ladder's one remembered thread, nothing else.
      const person = items.filter(
        (item) =>
          item.memoryType !== "small_talk" &&
          (item.subject === null || item.subject.subjectType === "PERSON"),
      );
      const company = items.filter(
        (item) =>
          item.subject !== null &&
          item.subject.subjectType === "COMPANY" &&
          (companyIds.size === 0 || companyIds.has(item.subject.subjectId)),
      );
      let thisConversation: MemoryBundle["thisConversation"] = null;
      let otherConversations: MemoryBundle["otherConversations"] = [];
      let relevant: MemoryBundle["relevant"] = [];
      // Only for the person themselves, and only when the turn is about
      // their pitch practice. A failed read leaves it absent (unknown),
      // never an empty list, which would say "none on record".
      const held: { rehearsals?: MemoryBundle["rehearsals"] } = {};
      const rehearsalPort = dependencies.rehearsals;
      const rehearsalRead =
        rehearsalPort !== undefined &&
        query.actor.actorType === "HUMAN" &&
        asksAboutRehearsal(query.utterance ?? "")
          ? (async () => {
              try {
                held.rehearsals = (
                  await rehearsalPort.recentForOwner(
                    query.actor,
                    RECALLED_REHEARSALS,
                  )
                ).slice(0, RECALLED_REHEARSALS);
              } catch (error: unknown) {
                logger?.warn(
                  { err: error },
                  "rehearsals were not read for recall",
                );
              }
            })()
          : Promise.resolve();
      // Connected recall: only for the person themselves, only when code
      // reads the turn as asking across linked things, under its budget,
      // and failing on its own. The person's own words come from the live
      // items above (superseded and forgotten ones are never live).
      const graphPort = dependencies.graph;
      const graphPlan =
        graphPort !== undefined && query.actor.actorType === "HUMAN"
          ? planGraphRecall(query.utterance ?? "", [...companyIds])
          : null;
      const graphRead =
        graphPort !== undefined && graphPlan !== null
          ? connectedRecallWithin(
              {
                port: graphPort,
                actor: query.actor,
                plan: graphPlan,
                seedCompanyIds: [...companyIds],
                memories: items.filter((item) => !lapsed(item)),
                conversationId: query.conversationId,
                now: now(),
              },
              dependencies.graphBudgetMs,
            ).catch((error: unknown) => {
              logger?.warn({ err: error }, "connected recall was not read");
              return undefined;
            })
          : Promise.resolve(undefined);
      const conversations = dependencies.conversations;
      if (conversations !== undefined) {
        const recentRead = (async () => {
          try {
            if (query.conversationId !== undefined) {
              const digest = await conversations.digestOf(
                query.actor,
                query.conversationId,
              );
              if (digest?.summary !== null && digest?.summary !== undefined) {
                thisConversation = {
                  title: digest.title,
                  summary: digest.summary,
                };
              }
            }
            otherConversations = await conversations.recentDigests(
              query.actor,
              query.conversationId ?? null,
              OTHER_CONVERSATIONS,
            );
          } catch (error: unknown) {
            logger?.warn(
              { err: error },
              "conversation digests were not read for recall",
            );
          }
        })();
        // In parallel with the recent read and failing on its own: a
        // relevant earlier conversation is a bonus, never a precondition.
        const terms = recallTermsFrom(query.utterance ?? "");
        const relevantRead = (async () => {
          if (
            conversations.relevantDigests === undefined ||
            (companyIds.size === 0 && terms.length === 0)
          ) {
            return;
          }
          try {
            relevant = (
              await conversations.relevantDigests(query.actor, {
                companyIds: [...companyIds],
                terms,
                except:
                  query.conversationId === undefined
                    ? []
                    : [query.conversationId],
                limit: RELEVANT_CONVERSATIONS,
              })
            )
              .filter((c) => c.conversationId !== query.conversationId)
              .slice(0, RELEVANT_CONVERSATIONS);
          } catch (error: unknown) {
            logger?.warn(
              { err: error },
              "relevant conversations were not read for recall",
            );
          }
        })();
        await Promise.all([recentRead, relevantRead]);
        // Each conversation once, in the section that says why it is here.
        const inRelevant = new Set(relevant.map((c) => c.conversationId));
        otherConversations = otherConversations.filter(
          (c) => !inRelevant.has(c.conversationId),
        );
      }
      await rehearsalRead;
      const connected = await graphRead;
      // Bookkeeping, detached: a recall never waits on it.
      void repository
        .markUsed(
          sql,
          query.actor.tenantId,
          [...person, ...company].map((item) => item.id),
        )
        .catch((error: unknown) => {
          logger?.debug({ err: error }, "memory use was not recorded");
        });
      return {
        person,
        company,
        thisConversation,
        relevant,
        otherConversations,
        ...(held.rehearsals === undefined
          ? {}
          : { rehearsals: held.rehearsals }),
        ...(connected === undefined ? {} : { connected }),
      };
    },

    remember: async (command) => {
      const parsed = MemoryCandidateSchema.safeParse(command.candidate);
      if (!parsed.success) {
        return { outcome: "REFUSED", reason: "INVALID_CANDIDATE" };
      }
      const candidate = parsed.data;
      const owner = personOwner(command.actor);
      // Only a person remembers things about themselves through this path.
      if (command.actor.actorType !== "HUMAN") {
        return { outcome: "REFUSED", reason: "NOT_ALLOWED" };
      }
      // Small talk (ADR 0062) is only ever the person's own words about
      // themselves: never a platform write, never about a company, and
      // never without the question Q may ask about it later.
      if (candidate.memoryType === "small_talk") {
        if (
          command.writeMode === "AUTOMATIC_SYSTEM" ||
          candidate.subject !== null ||
          smallTalkFollowUp(candidate) === null
        ) {
          return { outcome: "REFUSED", reason: "INVALID_CANDIDATE" };
        }
      }
      if (command.writeMode !== "AUTOMATIC_SYSTEM") {
        if (candidate.quote === null) {
          return { outcome: "REFUSED", reason: "QUOTE_REQUIRED" };
        }
        const said = command.userTurns.some((turn) =>
          quoteOccursIn(candidate.quote ?? "", turn),
        );
        if (!said) {
          return { outcome: "REFUSED", reason: "QUOTE_NOT_IN_TURNS" };
        }
      }
      if (
        looksLikeSecret(candidate.content) ||
        looksLikeSecret(candidate.quote ?? "")
      ) {
        return { outcome: "REFUSED", reason: "SENSITIVE_CONTENT" };
      }
      const contentSha256 = memoryContentHash(candidate);
      return transactions.run(async (tx) => {
        const same = await repository.findLiveByHash(
          tx.sql,
          command.actor.tenantId,
          owner,
          contentSha256,
        );
        if (same !== null) {
          return {
            outcome: "UNCHANGED",
            reason: "ALREADY_REMEMBERED",
            item: same,
          };
        }
        const earlier = await repository.findLiveByKey(
          tx.sql,
          command.actor.tenantId,
          owner,
          candidate.memoryType,
          candidate.memoryKey,
        );
        // The earlier value goes first, so the partial unique index on
        // live keys never sees two live rows for one key.
        if (earlier !== null) {
          // A placeholder id is not possible here; supersede in two steps:
          // retire the earlier row, insert the new one, then point the
          // retired row at it.
          await tx.sql`
            update q_knowledge.memory_items
               set status = 'archived', valid_to = now(), updated_at = now()
             where id = ${earlier.id}
               and tenant_id = ${command.actor.tenantId}`;
        }
        const item = await repository.insert(tx, {
          tenantId: command.actor.tenantId,
          owner,
          subject: candidate.subject,
          memoryType: candidate.memoryType,
          memoryKey: candidate.memoryKey,
          content: candidate.content,
          structuredValue: candidate.structuredValue,
          quote: candidate.quote,
          contentSha256,
          sourceConversationId: command.source.conversationId,
          sourceRunId: command.source.runId,
          writeMode: command.writeMode,
          // A quote-verified reading of the person's own words is remembered
          // outright; a platform fact likewise. Nothing reaches `candidate`
          // today because nothing writes without one of those two.
          status: "active",
          // Small talk lapses after 90 days (ADR 0062); everything else is
          // kept until it is replaced or forgotten.
          ...(candidate.memoryType === "small_talk"
            ? {
                validTo: new Date(
                  now() + SMALL_TALK_RETENTION_DAYS * 86_400_000,
                ).toISOString(),
              }
            : {}),
        });
        if (earlier !== null) {
          await repository.supersede(
            tx,
            command.actor.tenantId,
            owner,
            earlier.id,
            item.id,
          );
          return { outcome: "REMEMBERED", reason: "SUPERSEDED_EARLIER", item };
        }
        return { outcome: "REMEMBERED", reason: "RECORDED", item };
      });
    },

    forget: async (command) => {
      const owner = personOwner(command.actor);
      return transactions.run((tx) =>
        repository.forget(
          tx,
          command.actor.tenantId,
          owner,
          command.memoryItemId,
        ),
      );
    },
  };
}
