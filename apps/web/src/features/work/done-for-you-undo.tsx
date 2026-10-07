"use client";

import { useState, useTransition } from "react";

import { Button } from "@capital-q/ui/button";

import { unsendDoneForYouAction } from "./work-page-actions";

/**
 * Scoped delegation: a message Q sent on its own can be unsent from Work
 * for a short while (the chat's own unsend, as the person). After that,
 * or once unsent, the button is gone and the words say why.
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
  if (Date.parse(until) <= Date.now()) return null;
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
      {message === null ? null : (
        <span className="cq-caption text-(--cq-text-secondary)" role="status">
          {message}
        </span>
      )}
    </span>
  );
}
