import {
  QConversationIdSchema,
  type CorrelationId,
} from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

import type { QRuntimeDependencies } from "./dependencies.js";

export type RecordSpokenExchangeCommand = {
  readonly actor: ActorContext;
  readonly conversationId: string;
  /** In the order they were said; the person's words and the voice's. */
  readonly messages: readonly {
    readonly role: "USER" | "Q";
    readonly content: string;
  }[];
  readonly correlationId: CorrelationId;
};

const USER_MAX = 8_000;
const Q_MAX = 32_000;

/**
 * Owner report 2026-11-04: one spoken reply reached the conversation as
 * ten Q messages ("I don't have a task from" / "you yet." / …), each its
 * own row in Chat. Consecutive segments of one side are one turn: they are
 * written as one message, in order, separated by a single space (each
 * segment is a whole stretch of speech, already trimmed by the line).
 */
function joinedTurns(
  segments: RecordSpokenExchangeCommand["messages"],
): { role: "USER" | "Q"; content: string }[] {
  const out: { role: "USER" | "Q"; content: string }[] = [];
  for (const segment of segments) {
    const content = segment.content.trim();
    if (content.length === 0) continue;
    const last = out.at(-1);
    if (last?.role === segment.role)
      last.content = `${last.content} ${content}`;
    else out.push({ role: segment.role, content });
  }
  return out;
}

/**
 * VOICE-BRAIN (founder live 2026-10-08): a turn the realtime voice
 * answered without Q (small talk, a reply to a card) is still part of the
 * conversation. It is written to the conversation's messages, bound to
 * the conversation's newest run of this person's (a message always
 * belongs to a run), so the history the person reads and the history Q
 * reads back both have it. Owner-scoped: a conversation that is not the
 * actor's records nothing. Returns how many messages were written.
 */
export function createRecordSpokenExchange(dependencies: QRuntimeDependencies) {
  const { transactions, repositories } = dependencies;
  return async (command: RecordSpokenExchangeCommand): Promise<number> => {
    const conversationId = QConversationIdSchema.safeParse(
      command.conversationId,
    );
    if (!conversationId.success) return 0;
    const messages = joinedTurns(command.messages)
      .map((m) => ({
        role: m.role,
        content: m.content
          .trim()
          .slice(0, m.role === "USER" ? USER_MAX : Q_MAX),
      }))
      .filter((m) => m.content.length > 0);
    if (messages.length === 0) return 0;
    const { actor } = command;
    return transactions.run(async (tx) => {
      const anchor = await repositories.runs.findLatestForConversation(
        tx.sql,
        actor.tenantId,
        actor.userId,
        conversationId.data,
      );
      if (anchor === null) return 0;
      for (const message of messages) {
        await repositories.messages.insert(tx, {
          tenantId: actor.tenantId,
          conversationId: conversationId.data,
          runId: anchor.id,
          role: message.role,
          content: message.content,
        });
      }
      dependencies.logger?.info(
        {
          qRunId: anchor.id,
          messages: messages.length,
          correlationId: command.correlationId,
        },
        "q spoken exchange recorded",
      );
      return messages.length;
    });
  };
}
