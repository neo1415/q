"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { buttonClassName } from "@capital-q/ui/button";
import { SheetContent, SheetRoot } from "@capital-q/ui/sheet";

import { QAperture } from "@/features/q-aperture";
import { useHomeHref } from "@/features/q/active-conversation";
import { QSheetConversation } from "@/features/q/q-sheet";
import { QSessionProvider, useQSessionOptional } from "@/features/q/q-session";
import {
  QSubjectProvider,
  useQSubject,
  type QSubject,
} from "@/features/q/q-subject";

/**
 * Q, present on every page (ADR 0017 F1): the one conversation store, the
 * sidebar's Q entry, the floating dock (features/q-dock) and the panel it
 * opens, all around the same conversation.
 *
 * The panel is Q beside the page, about whatever the page is looking at.
 * On the Q page, which is Q, it never opens: the page is the full view of
 * the same conversation. Nothing here touches the microphone until the
 * person asks to talk.
 */

type GlobalQValue = {
  readonly open: boolean;
  readonly setOpen: (open: boolean) => void;
  readonly connected: boolean;
  /** A draft question the panel opens with; null for an empty composer. */
  readonly seed: string | null;
  readonly askAbout: (seed: string) => void;
};

const GlobalQContext = createContext<GlobalQValue>({
  open: false,
  setOpen: () => undefined,
  connected: false,
  seed: null,
  askAbout: () => undefined,
});

const Q_PAGE = "/home";

export function GlobalQProvider({
  subject,
  connected,
  children,
  dock,
}: {
  /** The person's own subject, resolved on the server. */
  readonly subject: QSubject;
  /** False when this build has no Q API. */
  readonly connected: boolean;
  readonly children: ReactNode;
  /** The floating presence, rendered inside the store. */
  readonly dock?: ReactNode | undefined;
}) {
  const pathname = usePathname();
  const onQPage = pathname === Q_PAGE;
  const [requested, setRequested] = useState(false);
  const [seed, setSeed] = useState<string | null>(null);
  // A draft belongs to the opening that asked for it; closing drops it so
  // the next plain "Ask Q" starts empty.
  const setOpen = useCallback((next: boolean) => {
    setRequested(next);
    if (!next) setSeed(null);
  }, []);
  const askAbout = useCallback((next: string) => {
    setSeed(next);
    setRequested(true);
  }, []);
  // Arriving on the Q page closes the panel: the page is the same
  // conversation in full. Derived, so the panel is gone in the very
  // render that shows the page -- which is what lets the aperture morph
  // from one to the other in the navigation's transition.
  const open = requested && !onQPage;
  const [closedFor, setClosedFor] = useState(pathname);
  if (closedFor !== pathname) {
    setClosedFor(pathname);
    if (onQPage && requested) {
      setRequested(false);
      setSeed(null);
    }
  }

  // Control/Command+K opens Q from anywhere (doc 17 §164); on the Q page
  // it goes to the command bar.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k") return;
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      event.preventDefault();
      if (window.location.pathname === Q_PAGE) {
        document.getElementById("home-q")?.focus();
        return;
      }
      setRequested(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const value = useMemo<GlobalQValue>(
    () => ({ open, setOpen, connected, seed, askAbout }),
    [open, setOpen, connected, seed, askAbout],
  );
  return (
    <QSubjectProvider own={subject}>
      <QSessionProvider connected={connected}>
        <GlobalQContext.Provider value={value}>
          {children}
          <GlobalQSheet />
          {dock}
        </GlobalQContext.Provider>
      </QSessionProvider>
    </QSubjectProvider>
  );
}

/**
 * Open Q beside the page, from the page.
 *
 * `QPageSubject` says what Q is looking at; this says when to show it.
 * Neither grants anything: the subject is resolved and authorised again
 * by the Q API on every run. `askAbout` opens with a draft question the
 * person edits or sends, never a message sent for them (CQ-WEB-024).
 */
export function useGlobalQ(): {
  readonly open: boolean;
  readonly setOpen: (open: boolean) => void;
  readonly askAbout: (seed: string) => void;
} {
  const { open, setOpen, askAbout } = useContext(GlobalQContext);
  return { open, setOpen, askAbout };
}

/** The sidebar's Q entry: it stays beside the dock (ADR 0017 F1). */
export function GlobalQTrigger({
  variant,
}: {
  readonly variant: "sidebar" | "header";
}) {
  const pathname = usePathname();
  const { open, setOpen } = useContext(GlobalQContext);
  const session = useQSessionOptional();
  const home = useHomeHref();
  const presence = (
    <QAperture
      state={session?.presence.state ?? "IDLE"}
      size={variant === "sidebar" ? "chrome" : 32}
    />
  );
  if (pathname === Q_PAGE) {
    // The Q page is Q. The press lands on the command bar rather than
    // opening a second Q beside the first.
    return (
      <Link
        href={`${home}#home-q`}
        aria-label="Ask Q"
        className={buttonClassName(
          "secondary",
          "regular",
          variant === "sidebar" ? "w-full justify-start" : "size-11 p-0",
        )}
        data-global-q="home"
      >
        {presence}
        {variant === "sidebar" ? "Ask Q" : null}
      </Link>
    );
  }
  return (
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
      data-global-q-state={session?.presence.state ?? "IDLE"}
    >
      {presence}
      {variant === "sidebar" ? "Ask Q" : null}
    </button>
  );
}

function GlobalQSheet() {
  const { open, setOpen, connected, seed } = useContext(GlobalQContext);
  const subject = useQSubject();
  const about =
    subject.kind === "NONE"
      ? "About what you're looking at."
      : `About ${subject.label ?? "this"}.`;
  return (
    <SheetRoot open={open} onOpenChange={setOpen}>
      {open ? (
        <SheetContent side="side" title="Q" description={about}>
          <QSheetConversation connected={connected} seed={seed} />
        </SheetContent>
      ) : null}
    </SheetRoot>
  );
}
