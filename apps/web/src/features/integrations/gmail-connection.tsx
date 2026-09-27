"use client";

import { useEffect, useState, useTransition } from "react";

import { buttonClassName } from "@capital-q/ui/button";
import type { GoogleConnectionDto } from "@capital-q/contracts";

import {
  connectGmail,
  disconnectGmail,
  readGmailConnection,
} from "./integration-actions";

/**
 * Gmail on the Settings page (BIZ-007): connect, see which address, and
 * disconnect. Connecting lets Q draft emails to people on your
 * relationships for your approval, and notice their replies; nothing is
 * ever sent without your approval of the exact email.
 */
export function GmailConnection({
  outcome,
}: {
  /** `?google=` from the OAuth return, if any. */
  readonly outcome?: string | undefined;
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
      ) : (
        <div className="flex flex-col items-start gap-2">
          <p className="cq-body-sm text-(--cq-text-secondary)">
            Let Q draft emails to people on your relationships and tell you when
            they reply. Nothing is sent until you approve the exact email.
          </p>
          <button
            type="button"
            className={buttonClassName("secondary", "compact")}
            disabled={pending}
            onClick={connect}
          >
            Connect Gmail
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
