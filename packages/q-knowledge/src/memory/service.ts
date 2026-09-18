import { createHash } from "node:crypto";

import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";
import type { Logger } from "@capital-q/observability";
import type { ActorContext } from "@capital-q/security";

import { quoteOccursIn } from "../q/statement-recorder.js";
import {
  MemoryCandidateSchema,
  type MemoryBundle,
  type MemoryCandidate,
  type MemoryItem,
  type MemoryOwner,
  type MemoryWriteMode,
  type MemoryWriteResult,
} from "./contracts.js";
import type { MemoryRepository } from "./postgres-memory-repository.js";

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
  ) => Promise<
    readonly {
      readonly conversationId: string;
      readonly title: string | null;
      readonly summary: string;
      readonly lastMessageAt: string;
    }[]
  >;
};

export type MemoryServiceDependencies = {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
  readonly repository: MemoryRepository;
  /** Conversation working memory, read from the runtime's own store. */
  readonly conversations?: MemoryConversationDigestPort | undefined;
  readonly logger?: Logger | undefined;
};

export type RecallQuery = {
  readonly actor: ActorContext;
  /** The conversation the run belongs to, when known. */
  readonly conversationId?: string | undefined;
  /** Companies the run is about, for company-subject memory. */
  readonly companyIds?: readonly string[] | undefined;
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
  readonly remember: (command: RememberCommand) => Promise<MemoryWriteResult>;
  readonly forget: (command: ForgetCommand) => Promise<MemoryItem | null>;
};

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

export function createMemoryService(
  dependencies: MemoryServiceDependencies,
): MemoryService {
  const { sql, transactions, repository, logger } = dependencies;

  return {
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
      const person = items.filter(
        (item) =>
          item.subject === null || item.subject.subjectType === "PERSON",
      );
      const company = items.filter(
        (item) =>
          item.subject !== null &&
          item.subject.subjectType === "COMPANY" &&
          (companyIds.size === 0 || companyIds.has(item.subject.subjectId)),
      );
      let thisConversation: MemoryBundle["thisConversation"] = null;
      let otherConversations: MemoryBundle["otherConversations"] = [];
      const conversations = dependencies.conversations;
      if (conversations !== undefined) {
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
      }
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
      return { person, company, thisConversation, otherConversations };
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
