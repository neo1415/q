"use client";

import { useEffect, type ReactNode } from "react";

import type {
  QManifestDialogKind,
  QManifestRef,
  QManifestSectionKind,
  QManifestTab,
} from "@capital-q/contracts";

import {
  registerQDialog,
  registerQSection,
  setQFilters,
  setQFocus,
  setQTab,
} from "./manifest";

/**
 * Q room R1: a section of the page Q can see, whether or not it is
 * scrolled into view. Server pages render it with the ids they already
 * fetched for the person; only the ids and the kind travel to Q.
 */
export function QSection({
  id,
  kind,
  refs = [],
  total,
  label,
  className,
  children,
}: {
  readonly id: string;
  readonly kind: QManifestSectionKind;
  readonly refs?: readonly QManifestRef[] | undefined;
  readonly total?: number | undefined;
  /** The person's own "Q can see" words; never sent. */
  readonly label?: string | undefined;
  readonly className?: string | undefined;
  readonly children?: ReactNode;
}) {
  useQSection(id, kind, refs, total ?? refs.length, label);
  return (
    <div data-q-section={id} className={className}>
      {children}
    </div>
  );
}

export function useQSection(
  id: string,
  kind: QManifestSectionKind,
  refs: readonly QManifestRef[],
  total: number,
  label?: string,
): void {
  const key = JSON.stringify([id, kind, refs, total, label ?? null]);
  useEffect(() => {
    const [entryId, entryKind, entryRefs, entryTotal, entryLabel] = JSON.parse(
      key,
    ) as [
      string,
      QManifestSectionKind,
      QManifestRef[],
      number,
      string | null,
    ];
    return registerQSection({
      id: entryId,
      kind: entryKind,
      refs: entryRefs,
      total: entryTotal,
      label: entryLabel ?? undefined,
    });
  }, [key]);
}

/** A dialog or sheet while it is open: on top of the stack Q sees. */
export function useQDialog(
  open: boolean,
  id: string,
  kind: QManifestDialogKind,
  refs: readonly QManifestRef[] = [],
  label?: string,
): void {
  const key = JSON.stringify([id, kind, refs, label ?? null]);
  useEffect(() => {
    if (!open) return;
    const [entryId, entryKind, entryRefs, entryLabel] = JSON.parse(key) as [
      string,
      QManifestDialogKind,
      QManifestRef[],
      string | null,
    ];
    return registerQDialog({
      id: entryId,
      kind: entryKind,
      refs: entryRefs,
      label: entryLabel ?? undefined,
    });
  }, [open, key]);
}

/** The page's tab, filters and focused record, while it is mounted. */
export function QPageState({
  tab,
  filters,
  focus,
}: {
  readonly tab?: QManifestTab | undefined;
  readonly filters?: Partial<Record<string, string>> | undefined;
  readonly focus?: QManifestRef | undefined;
}) {
  const key = JSON.stringify([tab ?? null, filters ?? {}, focus ?? null]);
  useEffect(() => {
    const [nextTab, nextFilters, nextFocus] = JSON.parse(key) as [
      QManifestTab | null,
      Partial<Record<string, string>>,
      QManifestRef | null,
    ];
    setQTab(nextTab);
    setQFilters(nextFilters);
    setQFocus(nextFocus);
    return () => {
      setQTab(null);
      setQFilters({});
      setQFocus(null);
    };
  }, [key]);
  return null;
}
