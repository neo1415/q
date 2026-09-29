"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";

import { buttonClassName } from "@capital-q/ui/button";
import { DialogContent, DialogRoot, DialogTrigger } from "@capital-q/ui/dialog";
import { Bell, CalendarDays, ICON_SIZE } from "@capital-q/ui/icons";

const SCHEDULE_HASHES = new Set(["#calls", "#reminders"]);

function subscribeHash(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

/**
 * Calls and reminders open over the page from the button that asks for
 * them (founder direction 2026-09-29: a modal, not a block always on the
 * page). The contents are the same server-rendered controls.
 */
export function ScheduleDialog({
  canCall,
  children,
}: {
  /** Calls open once connected; reminders are always offered. */
  readonly canCall: boolean;
  readonly children: ReactNode;
}) {
  // Links elsewhere ("Book a call" on a relationship card) arrive as
  // #calls or #reminders and open the dialog straight away.
  const asked = useSyncExternalStore(
    subscribeHash,
    () => SCHEDULE_HASHES.has(window.location.hash),
    () => false,
  );
  const [chosen, setChosen] = useState<boolean | null>(null);
  const open = chosen ?? asked;
  const onOpenChange = (next: boolean) => {
    if (!next && SCHEDULE_HASHES.has(window.location.hash)) {
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
      {canCall ? (
        <DialogTrigger>
          <button type="button" className={buttonClassName("secondary")}>
            <CalendarDays size={ICON_SIZE.regular} aria-hidden="true" />
            Book a call
          </button>
        </DialogTrigger>
      ) : null}
      <DialogTrigger>
        <button type="button" className={buttonClassName("secondary")}>
          <Bell size={ICON_SIZE.regular} aria-hidden="true" />
          Set a reminder
        </button>
      </DialogTrigger>
      <DialogContent
        title="Calls and reminders"
        className="max-h-[85vh] max-w-lg overflow-y-auto"
      >
        {children}
      </DialogContent>
    </DialogRoot>
  );
}
