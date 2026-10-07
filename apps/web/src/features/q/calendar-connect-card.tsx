"use client";

import { usePathname } from "next/navigation";
import { useState, useTransition } from "react";

import type { QShowCalendarConnectIntent } from "@capital-q/contracts";
import { buttonClassName } from "@capital-q/ui/button";

import { connectGoogleCalendar } from "../integrations/integration-actions";

/**
 * Q room R5: the person's Google Calendar is not connected. The times Q
 * suggests (working hours in their zone, never checked against a calendar)
 * and, beside them, the connect card. Connecting runs the existing Google
 * connect flow and brings them back to this same page, where Q picks up.
 * Nothing is booked from this card.
 */
export function CalendarConnectCard({
  intent,
}: {
  readonly intent: QShowCalendarConnectIntent;
}) {
  const pathname = usePathname();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const connect = () => {
    startTransition(async () => {
      const result = await connectGoogleCalendar(pathname);
      if (result.ok) window.location.assign(result.value);
      else setMessage(result.message);
    });
  };
  const expired = intent.reason === "REVOKED";
  return (
    <div className="flex flex-col gap-3" data-q-calendar-connect>
      {intent.suggested.length === 0 ? null : (
        <section
          aria-label="Suggested times"
          className="flex flex-col gap-3 rounded-lg border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-4"
        >
          <div className="flex flex-col gap-1">
            <span className="cq-label text-(--cq-text-tertiary)">
              Suggested without your calendar
            </span>
            {intent.counterpartName === undefined ? null : (
              <p className="cq-body font-medium text-(--cq-text-primary)">
                Call with {intent.counterpartName}
              </p>
            )}
          </div>
          <ul className="grid gap-2 sm:grid-cols-3">
            {intent.suggested.map((slot) => (
              <li
                key={slot.startsAt}
                className="flex flex-col gap-0.5 rounded-md border border-(--cq-border-subtle) px-3 py-2"
              >
                <span className="cq-body text-(--cq-text-primary) tabular-nums">
                  {slot.local}
                </span>
                <span className="cq-caption text-(--cq-text-tertiary)">
                  Not checked
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section
        aria-label="Connect Google Calendar"
        className="flex flex-col gap-3 rounded-lg border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-4"
      >
        <div className="flex flex-col gap-1">
          <p className="cq-body font-medium text-(--cq-text-primary)">
            {expired ? "Reconnect Google Calendar" : "Connect Google Calendar"}
          </p>
          <p className="cq-caption text-(--cq-text-secondary)">
            So I can check when you&rsquo;re free and add the invite. Calendar
            events only; disconnect any time in Settings.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={connect}
            disabled={pending}
            className={buttonClassName("primary", "compact")}
          >
            {pending
              ? "Opening Google…"
              : expired
                ? "Reconnect Google Calendar"
                : "Connect Google Calendar"}
          </button>
        </div>
        {message === null ? null : (
          <p role="status" className="cq-caption text-(--cq-text-secondary)">
            {message}
          </p>
        )}
      </section>
    </div>
  );
}
