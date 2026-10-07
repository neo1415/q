"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { announceConnectOutcome, type ConnectOutcome } from "./connect-popup";

const SAID: Readonly<Record<ConnectOutcome, string>> = {
  connected: "Google Calendar is connected. You can close this window.",
  denied: "Google Calendar wasn't connected: access wasn't granted.",
  failed: "Google Calendar couldn't be connected. Try again from the room.",
};

/** The connect window's last step: tell the room, then close (W4b). */
export function ConnectReturn({
  outcome,
}: {
  readonly outcome: ConnectOutcome;
}) {
  const [stayed, setStayed] = useState(false);
  useEffect(() => {
    announceConnectOutcome(outcome);
    window.close();
    // Not a window the room opened (or the browser kept it): say so.
    const timer = window.setTimeout(() => {
      setStayed(true);
    }, 400);
    return () => {
      window.clearTimeout(timer);
    };
  }, [outcome]);
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-4 px-4 py-10">
      <p role="status" className="cq-body text-(--cq-text-primary)">
        {SAID[outcome]}
      </p>
      {stayed ? (
        <Link
          href="/home"
          className="cq-body text-(--cq-text-secondary) underline"
        >
          Back to Capital Q
        </Link>
      ) : null}
    </main>
  );
}
