import type { QRunId } from "@capital-q/contracts";

/**
 * QRunId → engine thread identity (packet §16).
 *
 * The run id itself: unique, 36 characters, server-generated, never chosen
 * by a client, never derived from a person, a company or any content. It
 * is a storage key and nothing more — knowing a thread id grants nothing,
 * because every orchestration operation authorises the actor against the
 * canonical run before the engine is asked for anything, and no API ever
 * accepts a thread id from outside.
 *
 * The checkpoint namespace is the root namespace. Subgraphs, if they ever
 * appear, get their own namespaces under the same thread.
 */
export type QThreadId = string & { readonly __brand: "QThreadId" };

export function threadIdForRun(runId: QRunId): QThreadId {
  return runId as unknown as QThreadId;
}

export const Q_CHECKPOINT_NAMESPACE = "" as const;
