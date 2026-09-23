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
  | { readonly kind: "NONE"; readonly scope: "unset" };

export const NO_SUBJECT: QSubject = { kind: "NONE", scope: "unset" };

type SubjectContextValue = {
  readonly own: QSubject;
  readonly page: QSubject | null;
  readonly declare: (subject: QSubject | null) => void;
};

const SubjectContext = createContext<SubjectContextValue>({
  own: NO_SUBJECT,
  page: null,
  declare: () => undefined,
});

export function QSubjectProvider({
  own,
  children,
}: {
  readonly own: QSubject;
  readonly children: ReactNode;
}) {
  const [page, setPage] = useState<QSubject | null>(null);
  const value = useMemo<SubjectContextValue>(
    () => ({ own, page, declare: setPage }),
    [own, page],
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
