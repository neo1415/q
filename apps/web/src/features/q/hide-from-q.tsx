"use client";

import { useState } from "react";

import { hideQMessageAction } from "./actions";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * "Hide from Q" on one of the person's own lines (founder live 2026-10-01:
 * an open microphone stored speech meant for someone else, and Q kept
 * using it). The line stays in their history; Q no longer reads it back,
 * and nothing is learned from it. The Q API checks it is theirs.
 */
export function HideFromQ({
  conversationId,
  messageId,
}: {
  readonly conversationId: string | null | undefined;
  readonly messageId: string;
}) {
  const [state, setState] = useState<"IDLE" | "PENDING" | "HIDDEN" | "FAILED">(
    "IDLE",
  );
  if (
    conversationId === null ||
    conversationId === undefined ||
    !UUID.test(messageId)
  ) {
    return null;
  }
  if (state === "HIDDEN") {
    return (
      <span
        className="cq-caption self-end text-(--cq-text-secondary)"
        role="status"
      >
        Hidden from Q. It stays in your history.
      </span>
    );
  }
  return (
    <button
      type="button"
      className="cq-stage-quiet min-h-11 self-end"
      disabled={state === "PENDING"}
      onClick={() => {
        setState("PENDING");
        void hideQMessageAction(conversationId, messageId).then((result) => {
          setState(result.ok ? "HIDDEN" : "FAILED");
        });
      }}
    >
      {state === "FAILED" ? "Couldn't hide that. Try again" : "Hide from Q"}
    </button>
  );
}
