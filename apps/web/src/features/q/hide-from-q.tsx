"use client";

import { useState } from "react";

import {
  EyeOff,
  ICON_SIZE,
  ICON_STROKE,
  MoreHorizontal,
} from "@capital-q/ui/icons";
import {
  MenuContent,
  MenuItem,
  MenuRoot,
  MenuTrigger,
} from "@capital-q/ui/menu";

import { hideQMessageAction } from "./actions";
import { useT } from "@/features/i18n/language";

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
  const t = useT();
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
        {t("Hidden from Q. It stays in your history.")}
      </span>
    );
  }
  // Owner 2026-11-06 (like ChatGPT's message actions): no link under every
  // line. A small "More actions" button sits beside the message; it shows
  // on hover or keyboard focus on a desktop and stays quietly visible on a
  // touch screen (globals.css `.cq-q-msg-actions`). It is a real button, so
  // Tab reaches it and opens the menu. What hiding does is unchanged.
  return (
    <div className="cq-q-msg-actions self-end" data-q-msg-actions>
      {state === "FAILED" ? (
        <span className="cq-caption text-(--cq-text-secondary)" role="status">
          {t("Couldn't hide that. Try again")}
        </span>
      ) : null}
      <MenuRoot>
        <MenuTrigger>
          <button
            type="button"
            className="cq-stage-quiet cq-q-msg-actions-trigger"
            aria-label={t("Message actions")}
            title={t("Message actions")}
            disabled={state === "PENDING"}
            data-q-msg-actions-trigger
          >
            <MoreHorizontal
              aria-hidden="true"
              size={ICON_SIZE.compact}
              strokeWidth={ICON_STROKE}
            />
          </button>
        </MenuTrigger>
        <MenuContent align="end" className="min-w-44">
          <MenuItem
            onClick={() => {
              setState("PENDING");
              void hideQMessageAction(conversationId, messageId).then(
                (result) => {
                  setState(result.ok ? "HIDDEN" : "FAILED");
                },
              );
            }}
          >
            <EyeOff
              aria-hidden="true"
              size={ICON_SIZE.compact}
              strokeWidth={ICON_STROKE}
            />
            <span data-q-hide-from-q>{t("Hide from Q")}</span>
          </MenuItem>
        </MenuContent>
      </MenuRoot>
    </div>
  );
}
