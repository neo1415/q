import type { QTurnObjectBlock } from "./conversation";

/**
 * Lane A: which object Q showed is actually drawn on this tab now, as the
 * browser saw it -- set only once the object's own code has loaded and
 * committed (artifact-rendered.tsx's marker sits inside the object's
 * Suspense boundary), and cleared when it leaves. It travels to the Q API
 * in the page manifest (`drawn`), so Q may refer to an object the person
 * can see, and to nothing else.
 *
 * Plain module, no React: the manifest (server-reachable) reads it.
 * Browser memory only: the run's id and closed block kinds, no content.
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

export function setRendered(next: RenderedObject | null): void {
  rendered = next;
  for (const listener of [...listeners]) listener();
}

/** Clears the record only if it is still this one (a newer one stays). */
export function clearRenderedIf(mine: RenderedObject): void {
  if (rendered === mine) setRendered(null);
}

/** Tests: nothing drawn. */
export function clearRendered(): void {
  setRendered(null);
}
