import type {
  QManifestDialogKind,
  QManifestRef,
  QManifestSectionKind,
  QManifestTab,
  QPageManifest,
} from "@capital-q/contracts";

import { wireNow, type WireContracts } from "./wire";
import {
  Q_MANIFEST_DIALOGS_MAX,
  Q_MANIFEST_DIALOG_REFS_MAX,
  Q_MANIFEST_SECTIONS_MAX,
  Q_MANIFEST_SECTION_REFS_MAX,
} from "./wire-constants";

/**
 * Q room R1: what the whole page shows, kept by the page itself (one
 * registry per tab, like the screen focus source).
 *
 * A page registers each section while it is mounted -- the whole page, not
 * only what is scrolled into view -- with the record ids it lists, and any
 * dialog or sheet it opens. Only ids and closed kinds leave the browser
 * (`currentManifest`); the labels kept here are for the person's own
 * "Q can see" line and never travel. The Q API reads every id back as the
 * person, so a section can only name what the page already showed them.
 */

export type QSectionEntry = {
  readonly id: string;
  readonly kind: QManifestSectionKind;
  readonly refs: readonly QManifestRef[];
  readonly total: number;
  /** For the person's own "Q can see" line; never sent. */
  readonly label?: string | undefined;
};

export type QDialogEntry = {
  readonly id: string;
  readonly kind: QManifestDialogKind;
  readonly refs: readonly QManifestRef[];
  readonly label?: string | undefined;
};

const sections = new Map<string, QSectionEntry>();
const dialogs: QDialogEntry[] = [];
let tab: QManifestTab | null = null;
let filters: Partial<Record<string, string>> = {};
let focus: QManifestRef | null = null;
let seq = 0;
const listeners = new Set<() => void>();

let notifying = false;

/**
 * R9: a page mounting registers its sections one by one in a single
 * commit; listeners hear once per batch (a microtask later), not once per
 * section, so "Q can see" reads the page once instead of N times. The
 * sequence moves at once, so what travels with a turn is never stale.
 */
function changed(): void {
  seq += 1;
  if (notifying) return;
  notifying = true;
  queueMicrotask(() => {
    notifying = false;
    for (const listener of listeners) listener();
  });
}

export function subscribeManifest(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** A number that moves whenever the manifest does (useSyncExternalStore). */
export function manifestVersion(): number {
  return seq;
}

const SLUG = /^[a-z][a-z0-9-]{0,39}$/;

export function registerQSection(entry: QSectionEntry): () => void {
  if (!SLUG.test(entry.id)) return () => undefined;
  sections.set(entry.id, entry);
  changed();
  return () => {
    if (sections.get(entry.id) === entry) {
      sections.delete(entry.id);
      changed();
    }
  };
}

export function registerQDialog(entry: QDialogEntry): () => void {
  if (!SLUG.test(entry.id)) return () => undefined;
  dialogs.push(entry);
  changed();
  return () => {
    const at = dialogs.indexOf(entry);
    if (at >= 0) {
      dialogs.splice(at, 1);
      changed();
    }
  };
}

export function setQTab(next: QManifestTab | null): void {
  if (tab === next) return;
  tab = next;
  changed();
}

export function setQFilters(next: Partial<Record<string, string>>): void {
  if (JSON.stringify(filters) === JSON.stringify(next)) return;
  filters = { ...next };
  changed();
}

export function setQFocus(next: QManifestRef | null): void {
  if (JSON.stringify(focus) === JSON.stringify(next)) return;
  focus = next;
  changed();
}

/** Clears everything (tests; a page that leaves without unmounting). */
export function resetManifest(): void {
  sections.clear();
  dialogs.length = 0;
  tab = null;
  filters = {};
  focus = null;
  changed();
}

function elementOf(id: string): Element | null {
  if (typeof document === "undefined") return null;
  return document.querySelector(`[data-q-section="${id}"]`);
}

/** A section inside a part the person hid from Q never travels. */
function hidden(id: string): boolean {
  return elementOf(id)?.closest("[data-q-hidden]") != null;
}

function inViewport(id: string): boolean {
  const element = elementOf(id);
  if (element === null || typeof window === "undefined") return false;
  // A `display: contents` marker has no box of its own: its children do.
  const boxes = [element, ...element.children].map((one) =>
    one.getBoundingClientRect(),
  );
  return boxes.some(
    (rect) =>
      rect.width + rect.height > 0 &&
      rect.bottom > 0 &&
      rect.top < window.innerHeight &&
      rect.right > 0 &&
      rect.left < window.innerWidth,
  );
}

/**
 * Dialogs open on the page that no code registered: any open modal is in
 * the stack as a window of unknown kind, so "what's in this window?" is
 * never answered as if it were not there. Q's own dock is not one.
 */
function domDialogs(): { readonly label: string | null }[] {
  if (typeof document === "undefined") return [];
  const found: { label: string | null }[] = [];
  for (const element of document.querySelectorAll(
    '[role="dialog"], [role="alertdialog"]',
  )) {
    if (element.querySelector("[data-q-self]") !== null) continue;
    if (element.closest("[data-q-hidden]") !== null) continue;
    if (!(element instanceof HTMLElement) || element.hidden) continue;
    const labelledBy = element.getAttribute("aria-labelledby");
    const label =
      element.getAttribute("aria-label") ??
      (labelledBy === null
        ? null
        : (document.getElementById(labelledBy)?.textContent ?? null));
    found.push({ label: label?.trim().slice(0, 80) ?? null });
  }
  return found;
}

function bounded(
  wire: WireContracts,
  refs: readonly QManifestRef[],
  max: number,
): QManifestRef[] {
  const seen = new Set<string>();
  const out: QManifestRef[] = [];
  for (const ref of refs) {
    // One malformed id (a raw URL segment) drops that ref, not the page.
    if (!wire.QManifestRefSchema.safeParse(ref).success) continue;
    const key = `${ref.kind}:${ref.id.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: ref.kind, id: ref.id.toLowerCase() });
    if (out.length >= max) break;
  }
  return out;
}

/** The registered dialogs, then any other open window (top last). */
function dialogStack(): QDialogEntry[] {
  const registered = [...dialogs];
  if (registered.length > 0) return registered;
  return domDialogs().map((dialog, index) => ({
    id: `window-${String(index + 1)}`,
    kind: "OTHER" as const,
    refs: [],
    label: dialog.label ?? undefined,
  }));
}

/**
 * What travels with a turn: ids and closed kinds only, bounded, and
 * validated against the contract; undefined when the page registered
 * nothing and no window is open. W7: undefined too in the moment before
 * the wire's contracts are in -- a turn then goes without a manifest
 * rather than with an unchecked one.
 */
export function currentManifest(): QPageManifest | undefined {
  const wire = wireNow();
  if (wire === null) return undefined;
  const shown = [...sections.values()].filter((entry) => !hidden(entry.id));
  const stack = dialogStack();
  if (
    shown.length === 0 &&
    stack.length === 0 &&
    tab === null &&
    focus === null
  ) {
    return undefined;
  }
  const kept = shown.slice(0, Q_MANIFEST_SECTIONS_MAX);
  const manifest = {
    v: 2 as const,
    seq,
    ...(tab === null ? {} : { tab }),
    ...(Object.keys(filters).length === 0 ? {} : { filters }),
    inView: kept.filter((entry) => inViewport(entry.id)).map((e) => e.id),
    sections: kept.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      refs: bounded(wire, entry.refs, Q_MANIFEST_SECTION_REFS_MAX),
      total: Math.max(0, Math.min(10_000, Math.round(entry.total))),
    })),
    dialogs: stack.slice(-Q_MANIFEST_DIALOGS_MAX).map((dialog) => ({
      id: dialog.id,
      kind: dialog.kind,
      refs: bounded(wire, dialog.refs, Q_MANIFEST_DIALOG_REFS_MAX),
    })),
    ...(focus === null ? {} : { focus }),
  };
  const parsed = wire.QPageManifestSchema.safeParse(manifest);
  return parsed.success ? parsed.data : undefined;
}

/**
 * The person's own "Q can see" line: the page's sections and the top
 * window, in the page's own words. Local only; never sent to Q.
 */
export function seeingNow(): {
  readonly parts: readonly string[];
  readonly window: string | null;
} {
  const parts = [...sections.values()]
    .filter((entry) => !hidden(entry.id))
    .map((entry) => entry.label)
    .filter((label): label is string => label !== undefined && label !== "");
  const top = dialogStack().at(-1);
  return {
    parts,
    window: top === undefined ? null : (top.label ?? "a window"),
  };
}
