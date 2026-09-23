"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { cx } from "@capital-q/ui";
import { buttonClassName } from "@capital-q/ui/button";
import { SheetContent, SheetRoot } from "@capital-q/ui/sheet";
import { Tooltip } from "@capital-q/ui/tooltip";

import { QPresence, type QPresenceState } from "@/features/q-presence";
import { QSheetConversation } from "@/features/q/q-sheet";
import {
  QSubjectProvider,
  useQSubject,
  type QSubject,
} from "@/features/q/q-subject";

/**
 * Q, present in the chrome on every page (doc 17 §§6-8: never a fifth
 * tab, never a floating bubble — a place in the sidebar and the header).
 *
 * The small presence is Q's own, idle until the sheet is doing something;
 * a press opens Q beside the page, about whatever the page is looking at.
 * On Home, where the page is Q, the press goes to Q's own surface instead
 * of opening a second one. Nothing here touches the microphone until the
 * person asks to talk inside the sheet.
 */

type GlobalQValue = {
  readonly open: boolean;
  readonly setOpen: (open: boolean) => void;
  readonly activity: QPresenceState;
  readonly setActivity: (state: QPresenceState) => void;
  readonly connected: boolean;
};

const GlobalQContext = createContext<GlobalQValue>({
  open: false,
  setOpen: () => undefined,
  activity: "IDLE",
  setActivity: () => undefined,
  connected: false,
});

export function GlobalQProvider({
  subject,
  connected,
  children,
}: {
  /** The person's own subject, resolved on the server. */
  readonly subject: QSubject;
  /** False when this build has no Q API. */
  readonly connected: boolean;
  readonly children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [activity, setActivity] = useState<QPresenceState>("IDLE");
  const value = useMemo<GlobalQValue>(
    () => ({ open, setOpen, activity, setActivity, connected }),
    [open, activity, connected],
  );
  return (
    <QSubjectProvider own={subject}>
      <GlobalQContext.Provider value={value}>
        {children}
        <GlobalQSheet />
      </GlobalQContext.Provider>
    </QSubjectProvider>
  );
}

/**
 * Open Q beside the page, from the page.
 *
 * `QPageSubject` says what Q is looking at; this says when to show it. A
 * surface that offers its own "Ask Q" — a Discover card, a profile —
 * needs both, and neither grants anything: the subject is still resolved
 * and authorised again by the Q API on every run.
 */
export function useGlobalQ(): {
  readonly open: boolean;
  readonly setOpen: (open: boolean) => void;
} {
  const { open, setOpen } = useContext(GlobalQContext);
  return { open, setOpen };
}

const QUIET_ROUTES = ["/home"];

export function GlobalQTrigger({
  variant,
}: {
  readonly variant: "sidebar" | "header";
}) {
  const pathname = usePathname();
  const { open, setOpen, activity } = useContext(GlobalQContext);
  const onHome = QUIET_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}?`),
  );
  const presence = (
    <QPresence
      state={open ? activity : "IDLE"}
      size={variant === "sidebar" ? 28 : 32}
    />
  );
  if (onHome) {
    // Home is Q. The press lands on the composer rather than opening a
    // second Q beside the first.
    return (
      <Link
        href="/home#home-q"
        aria-label="Ask Q"
        className={cx(
          buttonClassName(
            "secondary",
            "regular",
            variant === "sidebar" ? "w-full justify-start" : "size-11 p-0",
          ),
        )}
        data-global-q="home"
      >
        {presence}
        {variant === "sidebar" ? "Ask Q" : null}
      </Link>
    );
  }
  const button = (
    <button
      type="button"
      aria-label="Ask Q"
      aria-expanded={open}
      onClick={() => setOpen(true)}
      className={buttonClassName(
        "secondary",
        "regular",
        variant === "sidebar" ? "w-full justify-start" : "size-11 p-0",
      )}
      data-global-q="trigger"
      data-global-q-state={open ? activity : "IDLE"}
    >
      {presence}
      {variant === "sidebar" ? "Ask Q" : null}
    </button>
  );
  return variant === "header" ? (
    <Tooltip content="Ask Q about this page">{button}</Tooltip>
  ) : (
    button
  );
}

function GlobalQSheet() {
  const { open, setOpen, setActivity, connected } = useContext(GlobalQContext);
  const subject = useQSubject();
  const onActivity = useCallback(
    (state: QPresenceState) => setActivity(state),
    [setActivity],
  );
  const about =
    subject.kind === "NONE"
      ? "About what you're looking at."
      : `About ${subject.label ?? "this"}.`;
  return (
    <SheetRoot open={open} onOpenChange={setOpen}>
      {open ? (
        <SheetContent side="side" title="Q" description={about}>
          <QSheetConversation
            subject={subject}
            connected={connected}
            onActivity={onActivity}
          />
        </SheetContent>
      ) : null}
    </SheetRoot>
  );
}
