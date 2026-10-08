"use client";

import { useEffect, useState } from "react";

import type { QSubjectRef } from "@capital-q/contracts";

import { referenceNamesAction } from "../room/reference-names";

/**
 * Names for the records a Q answer refers to, read once per page load and
 * shared by every card (E4, audit E-08). Unknown or not visible: null,
 * and the card keeps its plain label.
 */
const known = new Map<string, string | null>();

function keyOf(subject: QSubjectRef): string | null {
  if (subject.kind === "COMPANY") return `c:${subject.companyId}`;
  if (subject.kind === "INVESTOR_ORGANISATION") {
    return `i:${subject.investorOrganisationId}`;
  }
  return null;
}

/** The subject's name where the reader may see it; null otherwise. */
export function useSubjectNames(
  subjects: readonly QSubjectRef[],
): (subject: QSubjectRef) => string | null {
  const keys = [
    ...new Set(
      subjects.map(keyOf).filter((key): key is string => key !== null),
    ),
  ].sort();
  const joined = keys.join(",");
  const [, setRead] = useState(0);
  useEffect(() => {
    const missing = (joined.length === 0 ? [] : joined.split(",")).filter(
      (key) => !known.has(key),
    );
    if (missing.length === 0) return;
    let live = true;
    const ids = (prefix: string) =>
      missing
        .filter((key) => key.startsWith(prefix))
        .map((key) => key.slice(2))
        .slice(0, 12);
    void referenceNamesAction({ investors: ids("i:"), companies: ids("c:") })
      .then((read) => {
        for (const key of missing) {
          const id = key.slice(2);
          known.set(
            key,
            (key.startsWith("i:") ? read.investors[id] : read.companies[id]) ??
              null,
          );
        }
        if (live) setRead((n) => n + 1);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [joined]);
  return (subject) => {
    const key = keyOf(subject);
    return key === null ? null : (known.get(key) ?? null);
  };
}

/** For tests: forget the names read. */
export function forgetSubjectNames(): void {
  known.clear();
}
