"use client";

import { useEffect } from "react";

import type { QTurnObjectBlock } from "./conversation";

/**
 * Lane A: which object Q showed is actually drawn on this tab now, as the
 * browser saw it -- set only once the object's own code has loaded and
 * committed (the marker sits inside the object's Suspense boundary), and
 * cleared when it leaves. "Q says it's on screen" is checked against this,
 * never against what the answer merely carried.
 *
 * Browser memory only: ids of the run and closed block kinds, no content.
 */

export type RenderedObject = {
  /** The run whose object is drawn. */
  readonly run: string;
  /** Its block kinds, in the answer's order. */
  readonly kinds: readonly QTurnObjectBlock["kind"][];
};

let rendered: RenderedObject | null = null;
const listeners = new Set<() => void>();

export function renderedObject(): RenderedObject | null {
  return rendered;
}

export function subscribeRendered(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function set(next: RenderedObject | null): void {
  rendered = next;
  for (const listener of [...listeners]) listener();
}

/** Tests: nothing drawn. */
export function clearRendered(): void {
  set(null);
}

/**
 * Mounted beside a drawn object, inside its Suspense boundary: reports it
 * drawn after commit, and gone when it unmounts. Renders a marker an
 * end-to-end check (and a person's tooling) reads.
 */
export function RenderedMark({ run, kinds }: RenderedObject) {
  const signature = kinds.join(",");
  useEffect(
    () => {
      const mine: RenderedObject = { run, kinds: [...kinds] };
      set(mine);
      return () => {
        if (rendered === mine) set(null);
      };
    },
    // The kinds are rebuilt each render; their identity is the signature.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [run, signature],
  );
  return (
    <span
      hidden
      data-q-artifact-rendered={run}
      data-q-artifact-kinds={signature}
    />
  );
}
