"use client";

import { useSyncExternalStore } from "react";

import { setViewerDocument } from "../q/screen";

/**
 * Documents that just became ready, for the one toast owner on every page
 * (DOCS spec §3 F2).
 *
 * A tiny store rather than a context so anything may announce or ask the
 * centre to watch closely (a card still preparing, Q's "preparing the
 * document" stage) without a provider in between. One toast per document
 * version: the same version announced twice shows once.
 */

export type ReadyDocument = {
  readonly artifactId: string;
  readonly type: string;
  readonly title: string;
  /** 0: not known here (the current version is what opens). */
  readonly version: number;
  readonly status: "READY" | "FAILED";
  /**
   * Owner 2026-10-28: work Q promised, delivered while the person was on
   * another page. It stays until they open or dismiss it (no 12 s fade).
   */
  readonly persist?: boolean | undefined;
};

/** At most this many toasts at once; the newest is on top. */
export const READY_TOASTS_MAX = 3;

let toasts: readonly ReadyDocument[] = [];
const announced = new Set<string>();
const listeners = new Set<() => void>();
let watchUntil = 0;

function emit(): void {
  for (const listener of listeners) listener();
}

const keyOf = (document: ReadyDocument): string =>
  `${document.artifactId}:${String(document.version)}:${document.status}`;

/**
 * QA U2 (24 Oct 2026): a brief Q put on the stage was shown again, at the
 * same moment, as a "Ready" toast. A document on the stage is already in
 * front of them: it raises no toast, and one already up for it goes.
 */
let onStage: ReadonlySet<string> = new Set();

export function documentsOnStage(artifactIds: readonly string[]): void {
  onStage = new Set(artifactIds);
  for (const artifactId of artifactIds) dismissDocument(artifactId);
}

export function announceDocument(document: ReadyDocument): void {
  const key = keyOf(document);
  const persist = document.persist === true;
  // Promised work is announced even when the listing already raised (and
  // faded) its toast, and whatever the last stage showed: it is not on
  // the screen they are on now.
  if (announced.has(key) && !persist) return;
  announced.add(key);
  if (
    !persist &&
    document.status === "READY" &&
    onStage.has(document.artifactId)
  ) {
    return;
  }
  const before = toasts.find(
    (shown) => shown.artifactId === document.artifactId,
  );
  const next =
    before?.persist === true && !persist
      ? { ...document, persist: true }
      : document;
  toasts = [
    next,
    ...toasts.filter((shown) => shown.artifactId !== document.artifactId),
  ].slice(0, READY_TOASTS_MAX);
  emit();
}

export function dismissDocument(artifactId: string): void {
  const next = toasts.filter((shown) => shown.artifactId !== artifactId);
  if (next.length === toasts.length) return;
  toasts = next;
  emit();
}

/**
 * Something is being prepared: the centre checks often for a few minutes
 * instead of at its resting pace.
 */
export function expectDocument(now: number = Date.now()): void {
  watchUntil = Math.max(watchUntil, now + 3 * 60_000);
  emit();
}

export function watching(now: number = Date.now()): boolean {
  return now < watchUntil;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getToasts = () => toasts;
const EMPTY: readonly ReadyDocument[] = [];

export function useReadyDocuments(): readonly ReadyDocument[] {
  return useSyncExternalStore(subscribe, getToasts, () => EMPTY);
}

/** Re-render when watching starts, so the poll speeds up at once. */
export function useWatchSignal(): number {
  return useSyncExternalStore(
    subscribe,
    () => watchUntil,
    () => 0,
  );
}

let viewing: string | null = null;

/** Open a document in the one viewer the centre owns, from any page. */
export function openDocumentViewer(artifactId: string | null): void {
  viewing = artifactId;
  // What the viewer shows is on screen for Q too (voiceq-63).
  setViewerDocument(artifactId);
  emit();
}

/** The document open in the viewer now (Lane 7: "close it", tests). */
export function viewingDocumentNow(): string | null {
  return viewing;
}

export function useViewingDocument(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => viewing,
    () => null,
  );
}

/** Tests only: a clean store. */
export function resetReadyDocuments(): void {
  toasts = [];
  announced.clear();
  onStage = new Set();
  watchUntil = 0;
  viewing = null;
  setViewerDocument(null);
  emit();
}

export type ListedDocument = {
  readonly artifactId: string;
  readonly type: string;
  readonly status: string;
  readonly title: string;
  readonly currentVersion: number;
  readonly updatedAt: string;
};

export type KnownDocuments = ReadonlyMap<
  string,
  { readonly version: number; readonly status: string }
>;

/**
 * What a fresh listing says became ready (or failed) since the last one.
 *
 * A document the centre has not seen before is announced only when it
 * changed after the page was opened: the first listing is a baseline, not
 * a flood of old documents. A new version, or PREPARING turning READY,
 * is announced; PREPARING turning FAILED is announced as a failure.
 */
export function readyChanges(
  known: KnownDocuments,
  items: readonly ListedDocument[],
  openedAt: number,
): {
  readonly announce: readonly ReadyDocument[];
  readonly known: KnownDocuments;
} {
  const next = new Map(known);
  const announce: ReadyDocument[] = [];
  for (const item of items) {
    const before = known.get(item.artifactId);
    next.set(item.artifactId, {
      version: item.currentVersion,
      status: item.status,
    });
    const fresh = before === undefined && Date.parse(item.updatedAt) > openedAt;
    if (item.status === "READY" && item.currentVersion >= 1) {
      if (
        fresh ||
        (before !== undefined &&
          (before.version < item.currentVersion || before.status !== "READY"))
      ) {
        announce.push({
          artifactId: item.artifactId,
          type: item.type,
          title: item.title,
          version: item.currentVersion,
          status: "READY",
        });
      }
    } else if (
      item.status === "FAILED" &&
      (fresh || before?.status === "PREPARING")
    ) {
      announce.push({
        artifactId: item.artifactId,
        type: item.type,
        title: item.title,
        version: item.currentVersion,
        status: "FAILED",
      });
    }
  }
  return { announce, known: next };
}
