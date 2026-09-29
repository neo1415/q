"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";

import { buttonClassName } from "@capital-q/ui/button";
import { DialogContent, DialogRoot, DialogTrigger } from "@capital-q/ui/dialog";
import { Bell, CalendarDays, ICON_SIZE } from "@capital-q/ui/icons";

function subscribeHash(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

const KINDS = {
  call: { hash: "#calls", title: "Book a call", Icon: CalendarDays },
  reminder: { hash: "#reminders", title: "Set a reminder", Icon: Bell },
} as const;

/**
 * One job per dialog (founder live 2026-09-29: "it should be obvious what
 * you need to do"): Book a call opens on your free times, Set a reminder on
 * when. Links elsewhere arrive as #calls or #reminders and open the one
 * they name. The contents are the same server-rendered controls, focused.
 */
export function ScheduleDialog({
  kind,
  children,
}: {
  readonly kind: keyof typeof KINDS;
  readonly children: ReactNode;
}) {
  const { hash, title, Icon } = KINDS[kind];
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
  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogTrigger>
        <button type="button" className={buttonClassName("secondary")}>
          <Icon size={ICON_SIZE.regular} aria-hidden="true" />
          {title}
        </button>
      </DialogTrigger>
      <DialogContent
        title={title}
        className="max-h-[85vh] max-w-lg overflow-y-auto"
      >
        {children}
      </DialogContent>
    </DialogRoot>
  );
}
