"use client";

import { useEffect, useState, useTransition } from "react";

import { buttonClassName } from "@capital-q/ui/button";
import type { InboundEmailAddressDto } from "@capital-q/contracts";

import { readQEmailAddress, rotateQEmailAddress } from "./integration-actions";

/**
 * "Your Q email address" on Settings (inbound email): the address people
 * can write to so Q sees it for this person, a copy button, and a new
 * address when the old one has spread too far. A new address stops the
 * old one at once, so it asks once before doing it. Q reads what arrives
 * as data and never acts on it without the person's approval.
 */
export function QEmailAddress() {
  const [address, setAddress] = useState<InboundEmailAddressDto | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    void readQEmailAddress().then((result) => {
      if (result.ok) setAddress(result.value);
      else setMessage(result.message);
    });
  }, []);

  const copy = (value: string) => {
    void navigator.clipboard.writeText(value).then(
      () => setMessage("Copied."),
      () => setMessage("Couldn't copy. Select the address to copy it."),
    );
  };

  const rotate = (current: string) =>
    startTransition(async () => {
      const result = await rotateQEmailAddress(current);
      setConfirming(false);
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      setAddress(result.value);
      setMessage("New address ready. The old one no longer receives email.");
    });

  return (
    <div
      className="flex min-w-0 flex-col gap-2"
      data-q-email-address={address?.status ?? "LOADING"}
    >
      {address === null ? (
        message === null ? (
          <p className="cq-body-sm text-(--cq-text-tertiary)">Checking…</p>
        ) : null
      ) : address.status === "UNAVAILABLE" ? (
        <p className="cq-body-sm text-(--cq-text-secondary)">
          Receiving email isn&apos;t available yet.
        </p>
      ) : (
        <>
          <p className="cq-body-sm text-(--cq-text-secondary)">
            Email sent here reaches Q for you. Q tells you, and replies only
            when you approve.
          </p>
          <p className="cq-body-sm break-all font-mono text-(--cq-text-primary)">
            {address.address}
          </p>
          {confirming ? (
            <div className="flex flex-col items-start gap-2">
              <p className="cq-body-sm text-(--cq-text-primary)">
                Anyone with the old address won&apos;t reach you any more.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={buttonClassName("secondary", "compact")}
                  disabled={pending}
                  onClick={() => rotate(address.address)}
                >
                  Get a new address
                </button>
                <button
                  type="button"
                  className={buttonClassName("quiet", "compact")}
                  disabled={pending}
                  onClick={() => setConfirming(false)}
                >
                  Keep this one
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={buttonClassName("secondary", "compact")}
                onClick={() => copy(address.address)}
              >
                Copy
              </button>
              <button
                type="button"
                className={buttonClassName("quiet", "compact")}
                onClick={() => {
                  setMessage(null);
                  setConfirming(true);
                }}
              >
                New address
              </button>
            </div>
          )}
        </>
      )}
      {message !== null ? (
        <p role="status" className="cq-caption text-(--cq-text-secondary)">
          {message}
        </p>
      ) : null}
    </div>
  );
}
