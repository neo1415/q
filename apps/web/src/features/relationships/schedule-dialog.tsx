"use client";

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { buttonClassName } from "@capital-q/ui/button";
import { DialogContent, DialogRoot, DialogTrigger } from "@capital-q/ui/dialog";
import { Bell, CalendarDays, ICON_SIZE, Video } from "@capital-q/ui/icons";

import { effectShown } from "@/features/q/control/perform";
import { useQControl } from "@/features/q/control/q-control";
import { useT } from "@/features/i18n/language";

function subscribeHash(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

const KINDS = {
  call: {
    hash: "#calls",
    title: "Book a call",
    Icon: CalendarDays,
    control: "dialog.book-call",
  },
  reminder: {
    hash: "#reminders",
    title: "Set a reminder",
    Icon: Bell,
    control: "dialog.reminder",
  },
  // QA 390 px: only reachable behind Book a call, so nobody found it.
  join: {
    hash: "#join-call",
    title: "Have Q join a call",
    Icon: Video,
    control: "dialog.join-call",
  },
} as const;

/**
 * One job per dialog (founder live 2026-09-29: "it should be obvious what
 * you need to do"): Book a call opens on your free times, Set a reminder on
 * when. Links elsewhere arrive as #calls or #reminders and open the one
 * they name. The contents are the same server-rendered controls, focused.
 */
export function ScheduleDialog({
  kind,
  primary = false,
  children,
}: {
  readonly kind: keyof typeof KINDS;
  /** The page's one next step (Book a call once connected, P0-6). */
  readonly primary?: boolean;
  readonly children: ReactNode;
}) {
  const t = useT();

  const { hash, title, Icon, control } = KINDS[kind];
  const asked = useSyncExternalStore(
    subscribeHash,
    () => window.location.hash === hash,
    () => false,
  );
  const [chosen, setChosen] = useState<boolean | null>(null);
  const open = chosen ?? asked;
  const onOpenChange = (next: boolean) => {
    if (!next && window.location.hash === hash) {
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
    }
    setChosen(next);
  };
  // Q's UI acts (premiere v5): open or close this dialog deterministically.
  // A same-page #calls link is a hash-only move that fires no hashchange,
  // so the tour opens it here instead. Opening books nothing: booking
  // still needs the person's own click on a time and Send.
  const rootRef = useRef<HTMLSpanElement>(null);
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  });
  useQControl({
    id: control,
    kind: "DIALOG",
    ref: rootRef,
    onAct: async (intent) => {
      if (intent.act !== "OPEN" && intent.act !== "CLOSE") {
        return "NOT_APPLICABLE";
      }
      const want = intent.act === "OPEN";
      onOpenChange(want);
      return (await effectShown(() => openRef.current === want, 3_000))
        ? "DONE"
        : "FAILED";
    },
  });
  return (
    <span ref={rootRef} className="contents">
      <DialogRoot open={open} onOpenChange={onOpenChange}>
        <DialogTrigger>
          <button
            type="button"
            className={buttonClassName(primary ? "primary" : "secondary")}
          >
            <Icon size={ICON_SIZE.regular} aria-hidden="true" />
            {t(title)}
          </button>
        </DialogTrigger>
        <DialogContent
          title={t(title)}
          className="max-h-[85vh] max-w-lg overflow-y-auto"
        >
          {children}
        </DialogContent>
      </DialogRoot>
    </span>
  );
}
