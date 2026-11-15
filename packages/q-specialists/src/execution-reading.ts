import type { TurnExecutionClass } from "@capital-q/contracts";
import type { QTurnReading } from "@capital-q/model-gateway/q";
import { turnExecutionClassOf, type ExecutionReading } from "@capital-q/q-core";

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
  };
}

export function executionClassOfTurn(
  input: Parameters<typeof executionReadingOf>[0],
): TurnExecutionClass {
  return turnExecutionClassOf(executionReadingOf(input));
}
