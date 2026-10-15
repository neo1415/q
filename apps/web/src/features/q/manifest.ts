import type {
  QManifestDialogKind,
  QManifestDrawnKind,
  QManifestNotice,
  QManifestNoticeCode,
  QManifestNoticeKind,
  QManifestRefKind,
  QManifestRef,
  QManifestSectionKind,
  QManifestTab,
  QPageManifest,
} from "@capital-q/contracts";

import { renderedObject, subscribeRendered } from "./artifact-rendered-store";
import { manifestControls, subscribeControls } from "./control/registry";
import { mediaNow } from "./screen-media";
import {
  isLookedAt,
  isOnScreen,
  observeInViewport,
  pruneViewport,
} from "./viewport";
import { wireNow, type WireContracts } from "./wire";
import {
  isUuid,
  MANIFEST_FILTER_VALUE,
  Q_MANIFEST_DIALOGS_MAX,
  Q_MANIFEST_DIALOG_REFS_MAX,
  Q_MANIFEST_FILTER_KEYS,
  Q_MANIFEST_NOTICES_MAX,
  Q_MANIFEST_VISIBLE_REFS_MAX,
  Q_MANIFEST_SECTIONS_MAX,
  Q_MANIFEST_SECTION_REFS_MAX,
  type QManifestFilterKey,
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
 *
 * Lane W (2026-10-15) adds, still as ids and closed kinds: which records
 * of a section are visible now (`[data-q-ref]`, one shared observer), the
 * error, empty, loading and toast states showing, and the pitch video on
 * screen. The privacy line: what the person is typing and has not saved
 * or sent is never read here -- no field values, no "has typed" flag, no
 * page text, no screenshots. Q says it cannot see unsaved typing.
 */

export type QSectionEntry = {
  readonly id: string;
  readonly kind: QManifestSectionKind;
  readonly refs: readonly QManifestRef[];
  readonly total: number;
  /** For the person's own "Q can see" line; never sent. */
  readonly label?: string | undefined;
};

/** Lane W: a state the page shows, by closed kind and code. */
type QNoticeEntry = {
  readonly kind: QManifestNoticeKind;
  readonly code?: QManifestNoticeCode | undefined;
  readonly section?: string | undefined;
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

// RECOVERY-2026-10 (C1): a control registering or leaving moves the
// sequence like a section does, so a receipt's seq reads the new page.
subscribeControls(changed);
// Lane A: an object drawn on (or leaving) the Q stage changes the page.
subscribeRendered(changed);

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
  // Lane W: watched from now on, so a turn reads the observer's report.
  queueMicrotask(() => {
    for (const box of boxesOf(entry.id)) observeInViewport(box);
  });
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

/** A `display: contents` marker has no box of its own: its children do. */
function boxesOf(id: string): Element[] {
  const element = elementOf(id);
  return element === null ? [] : [element, ...element.children];
}

function inViewport(id: string): boolean {
  if (typeof window === "undefined") return false;
  return boxesOf(id).some(isOnScreen);
}

const REF_KINDS: ReadonlySet<string> = new Set<QManifestRefKind>([
  "COMPANY",
  "INVESTOR_ORGANISATION",
  "ARTIFACT",
  "UPLOADED_DOCUMENT",
  "MEETING",
  "REMINDER",
  "APPROVAL",
  "Q_WORK",
  "CAPITAL_ROUND",
  "GATEQ_APPLICATION",
  "MEDIA",
]);

/**
 * Lane W: the section's records visible now, in screen order, from the
 * `[data-q-ref]` marks its rows carry (q-ref.ts). A mark inside a part
 * hidden from Q, or of a kind the contract does not know, is skipped.
 */
function visibleRefs(id: string): QManifestRef[] {
  const element = elementOf(id);
  if (element === null) return [];
  const out: QManifestRef[] = [];
  for (const marked of element.querySelectorAll("[data-q-ref]")) {
    if (out.length >= Q_MANIFEST_VISIBLE_REFS_MAX) break;
    if (marked.closest("[data-q-hidden]") !== null) continue;
    const [kind = "", refId = ""] = (
      marked.getAttribute("data-q-ref") ?? ""
    ).split(":");
    if (!REF_KINDS.has(kind) || !isUuid(refId)) continue;
    if (!isLookedAt(marked)) continue;
    out.push({ kind: kind as QManifestRefKind, id: refId.toLowerCase() });
  }
  return out;
}

const NOTICE_KINDS: ReadonlySet<string> = new Set<QManifestNoticeKind>([
  "ERROR",
  "EMPTY",
  "LOADING",
  "TOAST",
]);
const NOTICE_CODES: ReadonlySet<string> = new Set<QManifestNoticeCode>([
  "PAGE_FAILED",
  "NOT_FOUND",
  "OFFLINE",
  "PLAYBACK_FAILED",
  "DONE",
  "FAILED",
]);

/**
 * Lane W: the states the page shows, read from
 * the closed marks the shared components already carry (`data-state` on
 * EmptyState and ErrorState, the page skeleton) or `data-q-notice`
 * ("KIND" or "KIND:CODE", on toasts and status pages). The element's text
 * is never read.
 */
function domNotices(shownIds: ReadonlySet<string>): QNoticeEntry[] {
  if (typeof document === "undefined") return [];
  const found: QNoticeEntry[] = [];
  for (const element of document.querySelectorAll(
    '[data-state="error"], [data-state="empty"], [data-page-skeleton], [data-q-notice]',
  )) {
    if (element.closest("[data-q-self], [data-q-hidden]") !== null) continue;
    if (element instanceof HTMLElement && element.hidden) continue;
    const marked = element.getAttribute("data-q-notice");
    const state = element.getAttribute("data-state");
    const [kind, code] =
      marked !== null
        ? marked.split(":")
        : element.hasAttribute("data-page-skeleton")
          ? ["LOADING"]
          : [state === "error" ? "ERROR" : "EMPTY"];
    if (kind === undefined || !NOTICE_KINDS.has(kind)) continue;
    const section = element
      .closest("[data-q-section]")
      ?.getAttribute("data-q-section");
    found.push({
      kind: kind as QManifestNoticeKind,
      ...(code !== undefined && NOTICE_CODES.has(code)
        ? { code: code as QManifestNoticeCode }
        : {}),
      ...(section != null && shownIds.has(section) ? { section } : {}),
    });
  }
  return found;
}

/** The page's notices, distinct and bounded. */
function noticesNow(shownIds: ReadonlySet<string>): QManifestNotice[] {
  const seen = new Set<string>();
  const out: QManifestNotice[] = [];
  for (const notice of domNotices(shownIds)) {
    const section =
      notice.section !== undefined && shownIds.has(notice.section)
        ? notice.section
        : undefined;
    const key = `${notice.kind}:${notice.code ?? ""}:${section ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      kind: notice.kind,
      ...(notice.code === undefined ? {} : { code: notice.code }),
      ...(section === undefined ? {} : { section }),
    });
    if (out.length >= Q_MANIFEST_NOTICES_MAX) break;
  }
  return out;
}

/** Lane W: the pitch on screen, with ids the contract can carry. */
function mediaManifest(): QPageManifest["media"] {
  const now = mediaNow();
  if (now === undefined) return undefined;
  return {
    kind: "PITCH",
    ...(now.companyId !== null && isUuid(now.companyId)
      ? { companyId: now.companyId.toLowerCase() }
      : {}),
    ...(now.mediaAssetId !== null && isUuid(now.mediaAssetId)
      ? { mediaAssetId: now.mediaAssetId.toLowerCase() }
      : {}),
    state: now.state,
    ...(now.position === undefined ? {} : { position: now.position }),
    ...(now.muted === undefined ? {} : { muted: now.muted }),
  };
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
  wire: WireContracts | null,
  refs: readonly QManifestRef[],
  max: number,
): QManifestRef[] {
  const seen = new Set<string>();
  const out: QManifestRef[] = [];
  for (const ref of refs) {
    // One malformed id (a raw URL segment) drops that ref, not the page.
    // W7: before the contracts are in, the id is checked as they would
    // (the kind is the page's own, typed in code).
    const valid =
      wire === null
        ? isUuid(ref.id)
        : wire.QManifestRefSchema.safeParse(ref).success;
    if (!valid) continue;
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
 * nothing and no window is open.
 *
 * W7: in the moment before the wire's contracts are in, the manifest is
 * built with the same checks by hand on what the page itself does not
 * type -- ids, filter keys and values -- and checked in full once they
 * are; the server checks it in full either way.
 */
export function currentManifest(): QPageManifest | undefined {
  const wire = wireNow();
  const shown = [...sections.values()].filter((entry) => !hidden(entry.id));
  const stack = dialogStack();
  const controls = manifestControls();
  const drawn = drawnNow();
  pruneViewport();
  const kept = shown.slice(0, Q_MANIFEST_SECTIONS_MAX);
  const keptIds = new Set(kept.map((entry) => entry.id));
  const states = noticesNow(keptIds);
  const media = mediaManifest();
  if (
    shown.length === 0 &&
    stack.length === 0 &&
    tab === null &&
    focus === null &&
    controls.length === 0 &&
    drawn === undefined &&
    states.length === 0 &&
    media === undefined
  ) {
    return undefined;
  }
  const inView = new Set(
    kept.filter((entry) => inViewport(entry.id)).map((entry) => entry.id),
  );
  const manifest = {
    v: 2 as const,
    seq,
    ...(tab === null ? {} : { tab }),
    ...(Object.keys(filters).length === 0
      ? {}
      : { filters: wire === null ? manifestFilters(filters) : filters }),
    inView: [...inView],
    sections: kept.map((entry) => {
      const visible = inView.has(entry.id)
        ? bounded(wire, visibleRefs(entry.id), Q_MANIFEST_VISIBLE_REFS_MAX)
        : [];
      return {
        id: entry.id,
        kind: entry.kind,
        refs: bounded(wire, entry.refs, Q_MANIFEST_SECTION_REFS_MAX),
        total: Math.max(0, Math.min(10_000, Math.round(entry.total))),
        ...(visible.length === 0 ? {} : { visible }),
      };
    }),
    dialogs: stack.slice(-Q_MANIFEST_DIALOGS_MAX).map((dialog) => ({
      id: dialog.id,
      kind: dialog.kind,
      refs: bounded(wire, dialog.refs, Q_MANIFEST_DIALOG_REFS_MAX),
    })),
    ...(focus === null || (wire === null && !isUuid(focus.id))
      ? {}
      : { focus }),
    ...(controls.length === 0 ? {} : { controls }),
    ...(drawn === undefined ? {} : { drawn }),
    ...(states.length === 0 ? {} : { notices: states }),
    ...(media === undefined ? {} : { media }),
  };
  if (wire === null) return manifest;
  const parsed = wire.QPageManifestSchema.safeParse(manifest);
  return parsed.success ? parsed.data : undefined;
}

const DRAWN_KINDS: ReadonlySet<string> = new Set([
  "ANSWER_CARDS",
  "COMPARISON",
  "COMPARISON_CARDS",
  "TABLE",
  "CHART",
  "MAP",
  "TIMELINE",
  "ARTIFACT_REFERENCE",
  "CLARIFICATION_REQUEST",
]);

/**
 * Lane A: the Q object this tab has drawn (artifact-rendered-store), in
 * the contract's closed kinds; undefined when none, or when its run has
 * no id the contract can carry.
 */
function drawnNow():
  | {
      readonly run: string;
      readonly kinds: QManifestDrawnKind[];
    }
  | undefined {
  const now = renderedObject();
  if (now === null || !isUuid(now.run)) return undefined;
  const kinds = [
    ...new Set(
      now.kinds.filter((kind): kind is QManifestDrawnKind =>
        DRAWN_KINDS.has(kind),
      ),
    ),
  ].slice(0, 8);
  return kinds.length === 0 ? undefined : { run: now.run, kinds };
}

/** The filters the contract allows, before the contracts are in (W7). */
function manifestFilters(
  all: Partial<Record<string, string>>,
): Partial<Record<QManifestFilterKey, string>> {
  const out: Partial<Record<QManifestFilterKey, string>> = {};
  for (const key of Q_MANIFEST_FILTER_KEYS) {
    const value = all[key];
    if (value !== undefined && MANIFEST_FILTER_VALUE.test(value)) {
      out[key] = value;
    }
  }
  return out;
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
