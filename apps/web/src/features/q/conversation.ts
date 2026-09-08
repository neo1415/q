import {
  Q_VISIBLE_STAGE_LABELS,
  type QMessage,
  type QResultBlock,
} from "@capital-q/contracts";
import type { QStreamState } from "@capital-q/api-client";

/**
 * From Q stream state to what a person sees (CQ-C5-R1 §14, §17, §18).
 *
 * A pure projection, deliberately separate from the hook that drives it, so
 * the rules below can be tested without a browser or a network:
 *
 *   - The server's messages are the conversation. A turn the person just
 *     typed is shown immediately, but it is a placeholder for a message the
 *     server has not confirmed yet — and it disappears the moment the real
 *     one arrives, rather than sitting beside it as a duplicate.
 *   - Streaming text is provisional. When `q.message.completed` lands, the
 *     persisted message replaces the buffer; the final message wins.
 *   - Nothing here invents a stage, a status or an answer. What the server
 *     did not say is not shown.
 */

export type QTurn =
  | {
      readonly kind: "PERSON";
      readonly id: string;
      readonly text: string;
      /** True while the server has not yet confirmed this turn. */
      readonly unconfirmed: boolean;
    }
  | {
      readonly kind: "Q";
      readonly id: string;
      readonly text: string;
      /** True while more text may still arrive for this message. */
      readonly streaming: boolean;
      /**
       * How many recorded sources this answer cites. A count, never an
       * identifier: an evidence reference carries only ids, and whether a
       * person may see the document behind one is disclosure's decision at
       * render time — not something this projection may pre-empt (§18).
       */
      readonly sourceCount: number;
    };

/** What a person typed, before the server has a message id for it. */
export type PendingTurn = {
  readonly id: string;
  readonly text: string;
  /** When it was typed. Keeps it in sequence with the server's own turns. */
  readonly at: string;
};

function textOf(message: QMessage): string {
  return message.role === "USER" ? message.text : (message.text ?? "");
}

function sourceCountOf(blocks: readonly QResultBlock[] | undefined): number {
  if (blocks === undefined) {
    return 0;
  }
  return blocks.reduce(
    (total, block) =>
      block.kind === "EVIDENCE" ? total + block.evidenceRefs.length : total,
    0,
  );
}

export function turnsFrom(
  state: QStreamState,
  pending: readonly PendingTurn[],
): readonly QTurn[] {
  // Ordered by when each turn happened, not by which list it came from.
  // The two sources interleave: a run may persist Q's answer as a durable
  // event before the person's own turn has been confirmed, and rendering
  // the reply above the question it answers is a conversation nobody had.
  const dated: { readonly at: string; readonly turn: QTurn }[] = [];
  const confirmed = new Set<string>();

  for (const message of state.messages) {
    const text = textOf(message);
    if (text.length === 0) {
      continue;
    }
    if (message.role === "USER") {
      confirmed.add(text.trim());
      dated.push({
        at: message.createdAt,
        turn: {
          kind: "PERSON",
          id: message.messageId,
          text,
          unconfirmed: false,
        },
      });
      continue;
    }
    dated.push({
      at: message.createdAt,
      turn: {
        kind: "Q",
        id: message.messageId,
        text,
        streaming: false,
        sourceCount: sourceCountOf(message.blocks),
      },
    });
  }

  // Anything the server has now confirmed stops being a placeholder. Text
  // is the only thing the two sides share before a message id exists.
  for (const turn of pending) {
    if (!confirmed.has(turn.text.trim())) {
      dated.push({
        at: turn.at,
        turn: {
          kind: "PERSON",
          id: turn.id,
          text: turn.text,
          unconfirmed: true,
        },
      });
    }
  }

  // A stable sort: two turns recorded in the same millisecond keep the
  // order they were produced in, which is the order they happened in.
  const turns = dated
    .map((entry, index) => ({ ...entry, index }))
    .sort((a, b) => (a.at === b.at ? a.index - b.index : a.at < b.at ? -1 : 1))
    .map((entry) => entry.turn);

  // Live text, only while the message it belongs to has not been persisted.
  // The reducer already drops deltas for a completed message, so reaching
  // here means the answer is genuinely still arriving — and it is always
  // the most recent thing in the conversation.
  if (state.partial !== null && state.partial.text.length > 0) {
    turns.push({
      kind: "Q",
      id: state.partial.messageId,
      text: state.partial.text,
      streaming: true,
      sourceCount: 0,
    });
  }

  return turns;
}

/**
 * The one line under the Q mark while a run is live (§17).
 *
 * Only stages the server actually emitted, rendered through the contract's
 * own plain-English labels. There is no fallback that guesses at a stage:
 * saying nothing is honest, and "Reviewing the company" when nothing was
 * reviewed is not.
 */
export function workingLabel(state: QStreamState): string | undefined {
  return state.stage === null ? undefined : Q_VISIBLE_STAGE_LABELS[state.stage];
}

/**
 * What a person reads when a run ends without an answer (§19).
 *
 * The contract already carries the sentence: `QPublicFailure.message` is
 * the public projection's own plain wording, chosen server-side from a
 * closed list, and rewording it here would be a second vocabulary drifting
 * from the first. The fallback covers a transport failure, where no public
 * projection exists because nothing was received.
 */
export function failureMessage(
  failure: { readonly message?: string | undefined } | null,
): string {
  const message = failure?.message;
  return message !== undefined && message.length > 0
    ? message
    : "I couldn't answer that right now. Please try again.";
}
