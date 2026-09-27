"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { buttonClassName } from "@capital-q/ui/button";
import { SheetContent, SheetRoot } from "@capital-q/ui/sheet";

import { QAperture } from "@/features/q-aperture";
import { useHomeHref } from "@/features/q/active-conversation";
import {
  describeMoment,
  momentDraft,
  type QMoment,
  type QMomentSource,
} from "@/features/q/q-moment";
import { QSheetConversation } from "@/features/q/q-sheet";
import { setScreenFocusSource } from "@/features/q/screen";
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
  /** Where in a pitch the person was when this opening happened. */
  readonly moment: QMoment | null;
  readonly registerMomentSource: (source: QMomentSource | null) => void;
};

const GlobalQContext = createContext<GlobalQValue>({
  open: false,
  setOpen: () => undefined,
  connected: false,
  seed: null,
  askAbout: () => undefined,
  moment: null,
  registerMomentSource: () => undefined,
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
  const [moment, setMoment] = useState<QMoment | null>(null);
  /**
   * What the page says is on screen, asked at the instant Q opens --
   * whichever way it was opened (the rail, the dock, Ctrl/Cmd+K). Read
   * then and not tracked, because a playback position changes every frame
   * and only the one at the moment of asking means anything.
   */
  const momentSource = useRef<QMomentSource | null>(null);
  const registerMomentSource = useCallback((source: QMomentSource | null) => {
    momentSource.current = source;
    // R21: the same source answers every turn's screen, not just opening.
    setScreenFocusSource(source);
  }, []);
  const openWith = useCallback((explicitSeed: string | null) => {
    const read = momentSource.current?.() ?? null;
    const at = read?.kind === "PITCH_MOMENT" ? read : null;
    setMoment(at);
    setSeed(explicitSeed ?? (at === null ? null : momentDraft(at)));
    setRequested(true);
  }, []);
  // A draft and a moment belong to the opening that asked for them;
  // closing drops both so the next plain "Ask Q" starts empty.
  const setOpen = useCallback(
    (next: boolean) => {
      if (next) {
        openWith(null);
        return;
      }
      setRequested(false);
      setSeed(null);
      setMoment(null);
    },
    [openWith],
  );
  const askAbout = useCallback(
    (next: string) => {
      openWith(next);
    },
    [openWith],
  );
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
      setMoment(null);
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
      openWith(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openWith]);

  const value = useMemo<GlobalQValue>(
    () => ({
      open,
      setOpen,
      connected,
      seed,
      askAbout,
      moment,
      registerMomentSource,
    }),
    [open, setOpen, connected, seed, askAbout, moment, registerMomentSource],
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

/**
 * Let Q know where in a pitch the person is, whenever they open it from
 * this page. The source is read at the instant of opening; it is cleared
 * when the page unmounts.
 */
export function useQMomentSource(source: QMomentSource): void {
  const { registerMomentSource } = useContext(GlobalQContext);
  const latest = useRef(source);
  useEffect(() => {
    latest.current = source;
  }, [source]);
  useEffect(() => {
    registerMomentSource(() => latest.current());
    return () => registerMomentSource(null);
  }, [registerMomentSource]);
}

/** The opening's moment, for the Q surface to show. */
export function useQMoment(): QMoment | null {
  return useContext(GlobalQContext).moment;
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
  const { open, setOpen, connected, seed, moment } = useContext(GlobalQContext);
  const subject = useQSubject();
  const about =
    moment !== null
      ? `${describeMoment(moment)}.`
      : subject.kind === "NONE"
        ? "About what you're looking at."
        : `About ${subject.label ?? "this"}.`;
  return (
    <SheetRoot open={open} onOpenChange={setOpen}>
      {open ? (
        <SheetContent side="side" title="Q" description={about}>
          <QSheetConversation
            connected={connected}
            seed={seed}
            moment={moment}
          />
        </SheetContent>
      ) : null}
    </SheetRoot>
  );
}
