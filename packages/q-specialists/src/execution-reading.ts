import type { TurnExecutionClass } from "@capital-q/contracts";
import type { QTurnReading } from "@capital-q/model-gateway/q";
import {
  followsUpPreviousAnswer,
  turnExecutionClassOf,
  type ExecutionReading,
} from "@capital-q/q-core";

/**
 * RC3 (Q voice audit, 15 Nov 2026): the turn reader's structured reading,
 * plus what code knows of the conversation, as the execution class's input.
 * Read from fields only -- never from the words.
 */
export function executionReadingOf(input: {
  readonly read: QTurnReading | null;
  /** The conversation's stored messages, the latest user turn included. */
  readonly history: readonly {
    readonly id: string;
    readonly role: "USER" | "Q";
    readonly content: string;
  }[];
  readonly latestId: string;
  /** This turn carries attached documents (they must be read). */
  readonly carriesDocuments: boolean;
}): ExecutionReading | null {
  const { read } = input;
  if (read === null) return null;
  const earlierQ = input.history
    .filter((message) => message.role === "Q" && message.id !== input.latestId)
    .map((message) => message.content);
  const said = earlierQ.join("\n").toLowerCase();
  const named = read.aboutNamedOther === true ? read.namedOther : null;
  const toolKind = read.tool?.kind;
  return {
    kind: read.kind,
    confidence: read.confidence,
    answerKind: read.answerKind ?? null,
    partsCount: read.parts?.length ?? 0,
    questionKind: read.question?.kind ?? null,
    preparedSubject:
      read.kind === "QUESTION_TO_Q" ? (read.question?.subject ?? null) : null,
    replyTo: read.replyTo?.kind ?? null,
    workFromEarlier: read.workFromEarlier === true,
    asksAction:
      (read.appAction ?? null) !== null ||
      (typeof read.askedAction === "string" && read.askedAction.length > 0) ||
      toolKind === "SET_VISIBILITY",
    handOver:
      (read.handOver ?? null) !== null || (read.meetingPrep ?? null) !== null,
    navigates:
      toolKind === "NAVIGATE" || (read.reference?.open ?? null) !== null,
    compare: (read.compare ?? null) !== null,
    fromShown: (read.fromShown ?? null) !== null,
    asksForWeb: read.asksForWeb === true,
    delegatesWork: read.teamJob === true || (read.planAsk ?? null) !== null,
    // A name Q has not said in this conversation needs reading: no reuse.
    namesSomethingNew:
      named !== null &&
      named !== undefined &&
      !said.includes(named.name.trim().toLowerCase()),
    hasPriorResult: earlierQ.length > 0,
    carriesDocuments: input.carriesDocuments,
    // v77/v79: the reader bound a pointing phrase ("that", "it", "the
    // second one") to something this conversation already holds.
    refersBack: (read.references ?? []).some(
      (reference) =>
        reference.entityIds.length > 0 || (reference.named ?? null) !== null,
    ),
  };
}

export function executionClassOfTurn(
  input: Parameters<typeof executionReadingOf>[0],
): TurnExecutionClass {
  return turnExecutionClassOf(executionReadingOf(input));
}

/**
 * Live 17 Nov 2026 (conversation ff20af7e, "Why does that matter for an
 * investor like me?", "And what is the biggest risk in that?"): a turn
 * that points back at the answer Q just gave, about the same subject. The
 * fast path is tried for it, and it does no outside research unless the
 * reading asks for the web. See followsUpPreviousAnswer.
 */
export function followsUpAnswer(
  input: Parameters<typeof executionReadingOf>[0],
): boolean {
  const reading = executionReadingOf(input);
  return (
    reading !== null &&
    followsUpPreviousAnswer(reading, turnExecutionClassOf(reading))
  );
}

/**
 * Live 17 Nov 2026 (run 0f483277): "What does Halyard Security do and how
 * is it doing commercially?" was answered only with an Express Interest
 * card. A turn the reader reads as a question to Q that asks Q to do
 * nothing -- no action, tool, hand-over, team job, plan or board ask -- and
 * takes up no offer or waiting card of Q's in this conversation, is
 * answered; no approval card is prepared on it. From the reading's fields
 * only, never its words. Unknown stays unknown: no reading, or a
 * low-confidence one, sets no limit.
 */
export function asksNoActionOf(read: QTurnReading | null): boolean {
  if (read === null || read.confidence === "LOW") return false;
  if (read.kind !== "QUESTION_TO_Q" || read.addressedToQ === false) {
    return false;
  }
  const asked =
    (read.appAction ?? null) !== null ||
    (typeof read.askedAction === "string" && read.askedAction.length > 0) ||
    (read.tool ?? null) !== null ||
    (read.handOver ?? null) !== null ||
    (read.meetingPrep ?? null) !== null ||
    read.teamJob === true ||
    (read.planAsk ?? null) !== null ||
    (read.boardAsk ?? null) !== null ||
    read.directsWork === true ||
    read.saveToOwnProfile === true;
  const takesUp =
    read.acceptsOffer === true ||
    read.workFromEarlier === true ||
    read.replyTo?.kind === "WAITING_CARD";
  return !asked && !takesUp;
}

/**
 * ADR 0081 (owner decision 105): whether this turn's words may be taken as
 * the person's own statement, so a founder's figure about their own
 * company can be recorded at once with no card. From the reading's fields
 * only, never its words: a reading exists, it is not at LOW confidence, the
 * words came through (not UNCLEAR_TRANSCRIPT, not a FRAGMENT; a spoken
 * turn only when its transcript is CLEAR and it was not re-heard by sound
 * -- the `:heard` message holds Q's guess, not their words), it was said
 * to Q, and it is about no named other company or person. Anything else
 * is false, and the card stays.
 */
export function ownStatementClearOf(
  read: QTurnReading | null,
  latest: { readonly utteranceRef?: string | undefined },
): boolean {
  if (read === null || read.confidence === "LOW") return false;
  if (read.kind === "UNCLEAR_TRANSCRIPT" || read.transcript === "FRAGMENT") {
    return false;
  }
  if (read.addressedToQ === false) return false;
  if (read.aboutNamedOther || (read.namedOther ?? null) !== null) return false;
  const spoken = latest.utteranceRef !== undefined;
  if (!spoken) return true;
  return (
    read.transcript === "CLEAR" &&
    !(latest.utteranceRef ?? "").endsWith(":heard")
  );
}
