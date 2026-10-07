"use client";

import { useCallback, useState, useSyncExternalStore } from "react";

import { isActiveRoute, type NavigationGroup } from "./navigation";

/**
 * Whether each labelled navigation group (Workspace, You, Admin) is open
 * (founder direction 2026-10-07: "let all of those be collapsible, and the
 * default should be that it is closed").
 *
 * - Closed by default, for everyone, on a first visit.
 * - The group holding the current page opens on arrival, so the person
 *   never loses where they are; that is not saved as their choice, and they
 *   may still close it.
 * - A choice the person makes is remembered per group in this browser.
 *   Storage is a convenience: blocked or absent, groups simply start
 *   closed again.
 *
 * The desktop sidebar and the phone's More sheet read the same choices.
 */
export type GroupLabel = Exclude<NavigationGroup["label"], null>;
export type GroupChoices = Readonly<Partial<Record<GroupLabel, boolean>>>;

export const NAV_GROUPS_STORAGE_KEY = "cq.nav.groups.v1";
const LABELS: readonly GroupLabel[] = ["Workspace", "You", "Admin"];
const EMPTY: GroupChoices = Object.freeze({});

/** Reads the saved choices; anything malformed reads as no choice. */
export function parseGroupChoices(raw: string | null): GroupChoices {
  if (raw === null) return EMPTY;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return EMPTY;
  }
  if (typeof value !== "object" || value === null) return EMPTY;
  const out: Partial<Record<GroupLabel, boolean>> = {};
  for (const label of LABELS) {
    const v: unknown = (value as Record<string, unknown>)[label];
    if (typeof v === "boolean") out[label] = v;
  }
  return out;
}

/** The labelled group that holds the current page, if any. */
export function groupHoldingPage(
  groups: readonly NavigationGroup[],
  pathname: string,
): GroupLabel | null {
  for (const group of groups) {
    if (group.label === null) continue;
    if (group.items.some((item) => isActiveRoute(pathname, item.href))) {
      return group.label;
    }
  }
  return null;
}

/**
 * Open when the page is inside it and the person has not closed it on
 * this page, otherwise the saved choice, otherwise closed.
 */
export function groupIsOpen(
  label: GroupLabel,
  choices: GroupChoices,
  revealed: GroupLabel | null,
): boolean {
  if (revealed === label) return true;
  return choices[label] ?? false;
}

// One in-memory copy, shared by every reader in the tab, so the sidebar
// and the More sheet agree even where storage is unavailable.
let current: GroupChoices | null = null;
const listeners = new Set<() => void>();

function read(): GroupChoices {
  if (current !== null) return current;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(NAV_GROUPS_STORAGE_KEY);
  } catch {
    raw = null;
  }
  current = parseGroupChoices(raw);
  return current;
}

function write(next: GroupChoices) {
  current = next;
  try {
    window.localStorage.setItem(NAV_GROUPS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Blocked storage: the choice lasts for this tab only.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test seam: forget the in-memory copy so storage is read afresh. */
export function resetGroupChoicesForTest() {
  current = null;
}

export function useNavGroups(
  groups: readonly NavigationGroup[],
  pathname: string,
): {
  readonly isOpen: (label: GroupLabel) => boolean;
  readonly toggle: (label: GroupLabel) => void;
} {
  const choices = useSyncExternalStore(subscribe, read, () => EMPTY);
  const holding = groupHoldingPage(groups, pathname);
  // The page's group is revealed once per page; closing it here is
  // honoured until the person moves to another page.
  const [dismissed, setDismissed] = useState<string | null>(null);
  const revealed = dismissed === pathname ? null : holding;

  const isOpen = useCallback(
    (label: GroupLabel) => groupIsOpen(label, choices, revealed),
    [choices, revealed],
  );
  const toggle = useCallback(
    (label: GroupLabel) => {
      const open = groupIsOpen(label, read(), revealed);
      if (open && revealed === label) setDismissed(pathname);
      write({ ...read(), [label]: !open });
    },
    [pathname, revealed],
  );
  return { isOpen, toggle };
}
