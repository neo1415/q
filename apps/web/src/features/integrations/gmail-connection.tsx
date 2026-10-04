"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { buttonClassName } from "@capital-q/ui/button";
import type { GoogleConnectionDto } from "@capital-q/contracts";

import {
  connectGmail,
  disconnectGmail,
  readGmailConnection,
} from "./integration-actions";

/**
 * Google on Settings → Connections (BIZ-007): connect, see which address,
 * and disconnect. Connecting lets Q draft emails to people on your
 * relationships for your approval, notice their replies, and book calls
 * with a Meet link; nothing is ever sent without your approval.
 *
 * meetfix-57: a connection Google ended (REVOKED) says so plainly with a
 * Reconnect button, and the reconnect link from Q or a notice
 * (`reconnect`) starts the reconnect itself -- one tap from the notice.
 */
export function GmailConnection({
  outcome,
  reconnect = false,
}: {
  /** `?google=` from the OAuth return, if any. */
  readonly outcome?: string | undefined;
  /** `?reconnect=google`: start reconnecting when Google isn't connected. */
  readonly reconnect?: boolean | undefined;
}) {
  const [connection, setConnection] = useState<GoogleConnectionDto | null>(
    null,
  );
  const [message, setMessage] = useState<string | null>(
    outcome === "denied"
      ? "Gmail wasn't connected: mail access wasn't granted."
      : outcome === "failed"
        ? "Gmail couldn't be connected. Try again."
        : null,
  );
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    void readGmailConnection().then((result) => {
      if (result.ok) setConnection(result.value);
      else setMessage(result.message);
    });
  }, []);

  const connect = () =>
    startTransition(async () => {
      const result = await connectGmail();
      if (result.ok) window.location.assign(result.value);
      else setMessage(result.message);
    });

  // The reconnect link: once, and only when there is something to fix and
  // the person did not just come back from Google declining it.
  const started = useRef(false);
  useEffect(() => {
    if (
      !reconnect ||
      started.current ||
      outcome !== undefined ||
      connection === null ||
      (connection.status !== "REVOKED" && connection.status !== "NOT_CONNECTED")
    ) {
      return;
    }
    started.current = true;
    connect();
  }, [reconnect, outcome, connection]);
  const disconnect = () =>
    startTransition(async () => {
      const result = await disconnectGmail();
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      setConnection({ status: "NOT_CONNECTED" });
      setMessage(
        "Gmail is disconnected, and Capital Q no longer holds access.",
      );
    });

  return (
    <div
      className="flex flex-col gap-2"
      data-gmail-connection={connection?.status ?? "LOADING"}
    >
      {connection === null ? (
        <p className="cq-body-sm text-(--cq-text-tertiary)">Checking…</p>
      ) : connection.status === "UNAVAILABLE" ? (
        <p className="cq-body-sm text-(--cq-text-secondary)">
          Gmail isn&apos;t available yet.
        </p>
      ) : connection.status === "CONNECTED" ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="cq-body-sm text-(--cq-text-primary)">
            Connected as {connection.email}
          </span>
          <button
            type="button"
            className={buttonClassName("quiet", "compact")}
            disabled={pending}
            onClick={disconnect}
          >
            Disconnect
          </button>
        </div>
      ) : connection.status === "REVOKED" ? (
        <div className="flex flex-col items-start gap-2">
          <p className="cq-body-sm text-(--cq-text-primary)">
            Disconnected by Google
            {connection.revokedAt === undefined
              ? ""
              : ` on ${new Date(connection.revokedAt).toLocaleDateString()}`}
            . Calendar, email and Meet links are paused until you reconnect.
          </p>
          <button
            type="button"
            className={buttonClassName("primary", "compact")}
            disabled={pending}
            onClick={connect}
          >
            Reconnect Google
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-start gap-2">
          <p className="cq-body-sm text-(--cq-text-secondary)">
            Q drafts emails you approve, tells you when they reply, and books
            calls with a Meet link.
          </p>
          <button
            type="button"
            className={buttonClassName("secondary", "compact")}
            disabled={pending}
            onClick={connect}
          >
            Connect Google
          </button>
        </div>
      )}
      {message !== null ? (
        <p role="status" className="cq-caption text-(--cq-text-secondary)">
          {message}
        </p>
      ) : null}
    </div>
  );
}
