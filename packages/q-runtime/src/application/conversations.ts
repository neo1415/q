import {
  Q_CONVERSATION_MESSAGES_MAX,
  Q_CONVERSATIONS_PAGE_MAX,
  QConversationDetailSchema,
  QConversationSummarySchema,
  type CorrelationId,
  type QConversationDetail,
  type QConversationId,
  type QConversationSummary,
  type UtcTimestamp,
} from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

import {
  toQMessage,
  toQRunHandle,
  type QConversation,
  type QConversationMessage,
  type QRunRecord,
} from "../contracts/index.js";
import { ownedConversation } from "./access.js";
import type { QRuntimeDependencies } from "./dependencies.js";

/**
 * A person's conversations (ADR 0012).
 *
 * Three reads and one change, all owner-scoped through the same access
 * rule as a run: a conversation that is not this person's in this tenant
 * is not found. The projection is the allowlist: title, subjects, times
 * and turns; the summary (model-written working memory) stays behind it.
 */

export type ListQConversationsQuery = {
  readonly actor: ActorContext;
  readonly limit?: number | undefined;
  readonly before?: UtcTimestamp | undefined;
};

export type ListQConversationsResult = {
  readonly items: readonly QConversationSummary[];
  readonly nextBefore: UtcTimestamp | undefined;
};

export type GetQConversationQuery = {
  readonly actor: ActorContext;
  readonly conversationId: QConversationId;
  readonly correlationId?: CorrelationId | undefined;
};

export type GetQConversationResult = {
  readonly conversation: QConversation;
  readonly messages: readonly QConversationMessage[];
  readonly latestRun: QRunRecord | null;
  readonly detail: QConversationDetail;
};

export type ArchiveQConversationCommand = {
  readonly actor: ActorContext;
  readonly conversationId: QConversationId;
  readonly correlationId?: CorrelationId | undefined;
};

/** A title to show: the extractor's, else the opening words of the first turn. */
export function conversationTitle(
  conversation: QConversation,
  opening: string | null,
): string {
  const title = conversation.title?.trim();
  if (title !== undefined && title.length > 0) return title.slice(0, 120);
  const words = (opening ?? "").replace(/\s+/g, " ").trim();
  if (words.length === 0) return "New conversation";
  return words.length > 60 ? `${words.slice(0, 57).trimEnd()}…` : words;
}

export function toQConversationSummary(
  conversation: QConversation,
  opening: string | null,
): QConversationSummary {
  return QConversationSummarySchema.parse({
    conversationId: conversation.id,
    title: conversationTitle(conversation, opening),
    subjects: conversation.subjects,
    createdAt: conversation.createdAt,
    lastMessageAt: conversation.lastMessageAt ?? conversation.createdAt,
  });
}

export function createListQConversations(dependencies: QRuntimeDependencies) {
  const { sql, repositories } = dependencies;
  return async (
    query: ListQConversationsQuery,
  ): Promise<ListQConversationsResult> => {
    const limit = Math.min(
      Math.max(query.limit ?? 25, 1),
      Q_CONVERSATIONS_PAGE_MAX,
    );
    const conversations = await repositories.conversations.listForOwner(
      sql,
      query.actor.tenantId,
      query.actor.userId,
      { limit, before: query.before },
    );
    const items: QConversationSummary[] = [];
    for (const conversation of conversations) {
      // The opening turn stands in for a title the extractor has not
      // written yet. One bounded read per untitled conversation; titled
      // ones cost nothing more.
      let opening: string | null = null;
      if (conversation.title === null) {
        const first = await repositories.messages.listRecentForConversation(
          sql,
          conversation.tenantId,
          conversation.id,
          1,
        );
        opening = first[0]?.content ?? null;
      }
      items.push(toQConversationSummary(conversation, opening));
    }
    const last = items.at(-1);
    return {
      items,
      nextBefore:
        items.length === limit && last !== undefined
          ? last.lastMessageAt
          : undefined,
    };
  };
}

export function createGetQConversation(dependencies: QRuntimeDependencies) {
  const { sql, repositories } = dependencies;
  return async (
    query: GetQConversationQuery,
  ): Promise<GetQConversationResult> => {
    const conversation = await ownedConversation(
      dependencies,
      sql,
      query.actor,
      query.conversationId,
      query.correlationId,
    );
    const messages = await repositories.messages.listRecentForConversation(
      sql,
      conversation.tenantId,
      conversation.id,
      Q_CONVERSATION_MESSAGES_MAX,
    );
    const latestRun = await repositories.runs.findLatestForConversation(
      sql,
      conversation.tenantId,
      conversation.userId,
      conversation.id,
    );
    const opening =
      messages.find((message) => message.role === "USER")?.content ?? null;
    return {
      conversation,
      messages,
      latestRun,
      detail: QConversationDetailSchema.parse({
        conversation: toQConversationSummary(conversation, opening),
        messages: messages.map(toQMessage),
        latestRun: latestRun === null ? null : toQRunHandle(latestRun),
      }),
    };
  };
}

export function createArchiveQConversation(dependencies: QRuntimeDependencies) {
  const { sql, transactions, repositories } = dependencies;
  return async (command: ArchiveQConversationCommand): Promise<void> => {
    // Ownership first, with the refusal recorded like any other read.
    await ownedConversation(
      dependencies,
      sql,
      command.actor,
      command.conversationId,
      command.correlationId,
    );
    await transactions.run(async (tx) => {
      await repositories.conversations.archiveForOwner(
        tx,
        command.actor.tenantId,
        command.actor.userId,
        command.conversationId,
      );
    });
  };
}
