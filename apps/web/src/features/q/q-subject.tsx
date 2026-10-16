"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { ContextScope } from "@capital-q/ui/tokens";

/**
 * What Q is looking at, wherever the person is.
 *
 * Two layers. The person's own subject — a founder's company, an
 * investor's organisation — is resolved on the server once per request
 * and handed to the shell. A page may then declare something narrower
 * while it is on screen: the company a Discover entry names, the person
 * on a profile. The narrower one wins while it is mounted and falls away
 * when it is not.
 *
 * Nothing here is authority. A subject is an input the Q API resolves and
 * authorises again on every run; declaring one grants nothing (CQ-PRE-
 * REC-001 §7).
 */

export type QSubject =
  | {
      readonly kind: "COMPANY";
      readonly companyId: string;
      readonly label?: string | undefined;
      readonly scope: ContextScope;
    }
  | {
      readonly kind: "INVESTOR_ORGANISATION";
      readonly investorOrganisationId: string;
      readonly label?: string | undefined;
      readonly scope: ContextScope;
    }
  | {
      /**
       * A relationship itself, for either party. The Q API resolves it only
       * for its two parties and answers from the asker's own side.
       */
      readonly kind: "RELATIONSHIP";
      readonly relationshipId: string;
      readonly label?: string | undefined;
      readonly scope: ContextScope;
    }
  | { readonly kind: "NONE"; readonly scope: "unset" };

export const NO_SUBJECT: QSubject = { kind: "NONE", scope: "unset" };

type SubjectContextValue = {
  readonly own: QSubject;
  readonly page: QSubject | null;
  readonly declare: (subject: QSubject | null) => void;
  /** The record open on the page, by name, when it is no subject kind. */
  readonly focus: string | null;
  readonly focusOn: (label: string | null) => void;
};

const SubjectContext = createContext<SubjectContextValue>({
  own: NO_SUBJECT,
  page: null,
  declare: () => undefined,
  focus: null,
  focusOn: () => undefined,
});

export function QSubjectProvider({
  own,
  children,
}: {
  readonly own: QSubject;
  readonly children: ReactNode;
}) {
  const [page, setPage] = useState<QSubject | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const value = useMemo<SubjectContextValue>(
    () => ({ own, page, declare: setPage, focus, focusOn: setFocus }),
    [own, page, focus],
  );
  return (
    <SubjectContext.Provider value={value}>{children}</SubjectContext.Provider>
  );
}

/** The subject Q should look at right now: the page's if it declared one, else the person's own. */
export function useQSubject(): QSubject {
  const { own, page } = useContext(SubjectContext);
  return page ?? own;
}

/**
 * Declare what this page is about, for as long as it is on screen. Drop
 * it anywhere in a page that shows one entity:
 *
 *   <QPageSubject subject={{ kind: "COMPANY", companyId, label, scope }} />
 */
export function QPageSubject({ subject }: { readonly subject: QSubject }) {
  const { declare } = useContext(SubjectContext);
  const key = JSON.stringify(subject);
  useEffect(() => {
    declare(JSON.parse(key) as QSubject);
    return () => declare(null);
  }, [declare, key]);
  return null;
}

/**
 * What Q's panel says it is about, in words: the record open on the page
 * (live check 2026-10-16: on a GateQ application the panel said "About
 * Savanna Seed Partners", the reader's own organisation), else the
 * subject's name. Words only: the record itself reaches Q through the
 * page's manifest focus, resolved and authorised by the Q API as ever.
 */
export function useQAboutLabel(): string | null {
  const { own, page, focus } = useContext(SubjectContext);
  if (focus !== null) return focus;
  const subject = page ?? own;
  return subject.kind === "NONE" ? null : (subject.label ?? null);
}

/**
 * Name the record open on the page for Q's panel, for as long as it is
 * open (a GateQ application: no subject kind, so a name alone).
 */
export function QPageFocus({ label }: { readonly label: string | null }) {
  const { focusOn } = useContext(SubjectContext);
  useEffect(() => {
    focusOn(label);
    return () => focusOn(null);
  }, [focusOn, label]);
  return null;
}
