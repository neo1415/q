"use client";

import { useState, useTransition } from "react";

import { Button } from "@capital-q/ui/button";

import { unsendDoneForYouAction } from "./work-page-actions";

/**
 * Scoped delegation: a message Q sent on its own can be unsent from Work
 * for a short while (the chat's own unsend, as the person). The server
 * offers it only inside that window (`until`, read when the page loads);
 * once unsent, the words say so.
 */
export function DoneForYouUndo({
  relationshipId,
  messageId,
  until,
}: {
  readonly relationshipId: string;
  readonly messageId: string;
  readonly until: string;
}) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<"OPEN" | "UNSENT">("OPEN");
  const [message, setMessage] = useState<string | null>(null);
  if (state === "UNSENT") {
    return (
      <span className="cq-caption text-(--cq-text-secondary)" role="status">
        Unsent.
      </span>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Button
        variant="quiet"
        size="compact"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setMessage(null);
            const result = await unsendDoneForYouAction(
              relationshipId,
              messageId,
            ).catch(() => null);
            if (result?.ok === true) setState("UNSENT");
            else setMessage(result?.message ?? "That didn't go through.");
          })
        }
      >
        Unsend
      </Button>
      <span className="cq-caption cq-numeric text-(--cq-text-tertiary)">
        until{" "}
        <time dateTime={until}>
          {new Intl.DateTimeFormat("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
            timeZone: "UTC",
            timeZoneName: "short",
          }).format(new Date(until))}
        </time>
      </span>
      {message === null ? null : (
        <span className="cq-caption text-(--cq-text-secondary)" role="status">
          {message}
        </span>
      )}
    </span>
  );
}
