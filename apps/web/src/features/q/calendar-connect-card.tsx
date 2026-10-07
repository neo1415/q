"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import type { QShowCalendarConnectIntent } from "@capital-q/contracts";
import { buttonClassName } from "@capital-q/ui/button";

import {
  CONNECT_POPUP_CHANNEL,
  CONNECT_POPUP_PATH,
  openConnectWindow,
  readConnectMessage,
  type ConnectOutcome,
} from "../integrations/connect-popup";
import {
  connectGoogleCalendar,
  readGmailConnection,
} from "../integrations/integration-actions";

const NOT_CONNECTED: Readonly<Record<ConnectOutcome, string>> = {
  connected: "Google Calendar isn't connected yet. Try again.",
  denied: "Google Calendar wasn't connected: access wasn't granted.",
  failed: "Google Calendar couldn't be connected. Try again.",
};

/**
 * Deck wave 8 (calendar truthfulness): Google is connected, but the grant
 * does not reach the calendar (the box was unticked on Google's screen,
 * or Google refuses the token for it). Said plainly, never "connected".
 */
const CALENDAR_NOT_GRANTED =
  "Google is connected but Calendar access wasn't granted — reconnect.";

type ConnectionRead = Awaited<ReturnType<typeof readGmailConnection>>;

/** Connected means the calendar itself, not just a Google account. */
function calendarOf(read: ConnectionRead): "GRANTED" | "NOT_GRANTED" | null {
  if (!read.ok || read.value.status !== "CONNECTED") return null;
  return read.value.calendar === "GRANTED" ? "GRANTED" : "NOT_GRANTED";
}

/**
 * Q room R5: the person's Google Calendar is not connected. The times Q
 * suggests (working hours in their zone, never checked against a calendar)
 * and, beside them, the connect card. Nothing is booked from this card.
 *
 * W4b: connecting opens Google in a small window and the room stays; when
 * the window finishes, the room asks the server whether the calendar is
 * now connected and shows it, without a reload. A blocked window falls
 * back to the same-tab flow, which returns to this page.
 */
export function CalendarConnectCard({
  intent,
}: {
  readonly intent: QShowCalendarConnectIntent;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [notGranted, setNotGranted] = useState(false);
  const [pending, startTransition] = useTransition();
  const popupRef = useRef<Window | null>(null);

  // Google may already be connected without the calendar: say so up front.
  useEffect(() => {
    let live = true;
    void readGmailConnection()
      .then((read) => {
        if (live && calendarOf(read) === "NOT_GRANTED") {
          setNotGranted(true);
          setMessage(CALENDAR_NOT_GRANTED);
        }
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  // The window's word is a hint; the connection's state is the server's.
  const settle = useCallback(
    async (outcome: ConnectOutcome) => {
      setWaiting(false);
      popupRef.current = null;
      const status = await readGmailConnection();
      const calendar = calendarOf(status);
      if (calendar === "GRANTED") {
        setConnected(true);
        setMessage(null);
        router.refresh();
      } else if (calendar === "NOT_GRANTED") {
        setNotGranted(true);
        setMessage(CALENDAR_NOT_GRANTED);
      } else {
        setMessage(NOT_CONNECTED[outcome]);
      }
    },
    [router],
  );

  useEffect(() => {
    if (!waiting) return;
    const heard = (data: unknown) => {
      const outcome = readConnectMessage(data);
      if (outcome !== null) void settle(outcome);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.origin === window.location.origin) heard(event.data);
    };
    window.addEventListener("message", onMessage);
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(CONNECT_POPUP_CHANNEL);
      channel.onmessage = (event: MessageEvent) => {
        heard(event.data);
      };
    } catch {
      channel = null;
    }
    // Closed without a word (or the word was lost): check once anyway.
    const watch = window.setInterval(() => {
      if (popupRef.current?.closed === true) void settle("failed");
    }, 1_000);
    return () => {
      window.removeEventListener("message", onMessage);
      channel?.close();
      window.clearInterval(watch);
    };
  }, [waiting, settle]);

  const connect = () => {
    setMessage(null);
    // Opened on the click itself, so a popup blocker lets it through.
    const popup = openConnectWindow();
    startTransition(async () => {
      const result = await connectGoogleCalendar(
        popup === null ? pathname : CONNECT_POPUP_PATH,
      );
      if (!result.ok) {
        popup?.close();
        setMessage(result.message);
        return;
      }
      if (popup === null) {
        // Blocked: the same-tab flow, back to this page.
        window.location.assign(result.value);
        return;
      }
      popup.location.href = result.value;
      popupRef.current = popup;
      setWaiting(true);
    });
  };
  const expired = intent.reason === "REVOKED" || notGranted;
  if (connected) {
    return (
      <section
        aria-label="Google Calendar"
        className="flex flex-col gap-1 rounded-lg border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-4"
        data-q-calendar-connect="connected"
      >
        <p
          role="status"
          className="cq-body font-medium text-(--cq-text-primary)"
        >
          Google Calendar connected
        </p>
        <p className="cq-caption text-(--cq-text-secondary)">
          I can check when you&rsquo;re free now. Ask me again and I&rsquo;ll
          pick times from your calendar.
        </p>
      </section>
    );
  }
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
        {waiting ? (
          <p role="status" className="cq-caption text-(--cq-text-secondary)">
            Finish in the Google window; I&rsquo;ll pick up here.
          </p>
        ) : null}
        {message === null ? null : (
          <p role="status" className="cq-caption text-(--cq-text-secondary)">
            {message}
          </p>
        )}
      </section>
    </div>
  );
}
