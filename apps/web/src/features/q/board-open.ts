"use client";

import { useEffect, useRef } from "react";

import type { QTurn } from "./conversation";

/**
 * The Board opens by itself only when Q makes a file (R24).
 *
 * It is closed by default and otherwise opens on its icon. A document or
 * deck Q produced in this visit is the one thing worth taking the width
 * for, so the first time an artifact appears that was not already in the
 * conversation when it was opened, the Board opens. Restoring an old
 * conversation that contains documents does not open it: those are not
 * new, and the person came back to talk, not to be handed a panel.
 */

/** Every document or deck an answer in this conversation points at. */
export function artifactIdsIn(turns: readonly QTurn[]): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const turn of turns) {
    if (turn.kind !== "Q") continue;
    for (const block of turn.blocks) {
      if (block.kind === "ARTIFACT_REFERENCE") ids.add(block.artifactId);
    }
  }
  return ids;
}

/** An artifact present now that was not in the earlier set, if any. */
export function freshArtifact(
  known: ReadonlySet<string>,
  turns: readonly QTurn[],
): string | undefined {
  for (const id of artifactIdsIn(turns)) {
    if (!known.has(id)) return id;
  }
  return undefined;
}

export function useBoardAutoOpen({
  turns,
  loading,
  conversationId,
  onFresh,
}: {
  readonly turns: readonly QTurn[];
  /** True while a restored conversation is still being read. */
  readonly loading: boolean;
  readonly conversationId: string | null;
  readonly onFresh: (artifactId: string) => void;
}): void {
  // The artifacts the conversation already had when it was opened; null
  // until the restored turns have arrived.
  const known = useRef<Set<string> | null>(null);
  const openedFor = useRef<string | null>(conversationId);
  const onFreshRef = useRef(onFresh);
  useEffect(() => {
    onFreshRef.current = onFresh;
  }, [onFresh]);

  useEffect(() => {
    if (openedFor.current !== conversationId && known.current !== null) {
      // Switching to another saved conversation re-baselines. A new
      // conversation getting its first id (null to an id, on the first
      // answer) is the same visit and keeps what it knew.
      if (openedFor.current !== null) known.current = null;
      openedFor.current = conversationId;
    }
    if (loading) return;
    if (known.current === null) {
      known.current = new Set(artifactIdsIn(turns));
      return;
    }
    const fresh = freshArtifact(known.current, turns);
    if (fresh === undefined) return;
    for (const id of artifactIdsIn(turns)) known.current.add(id);
    onFreshRef.current(fresh);
  }, [turns, loading, conversationId]);
}
