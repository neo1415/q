"use client";

import { ICON_SIZE, ICON_STROKE, Pin } from "@capital-q/ui/icons";

import { useT } from "@/features/i18n/language";

import { setWorkspacePinned, useWorkspacePinned } from "./workspace-pin";

/**
 * Pin / Unpin for the page pane (owner addendum, 13 Nov 2026). One toggle
 * button (aria-pressed), 44 px, beside the pane's own controls: its foot on
 * a desktop (the owner's "one small icon at each pane's foot"), the sheet's
 * top bar on a phone. Pinned reads without colour: the pin fills in, the
 * word "Pinned" shows beside it, and a polite status says "Workspace
 * pinned" to a screen reader.
 */
export function WorkspacePinToggle({
  place,
}: {
  readonly place: "foot" | "sheet";
}) {
  const t = useT();
  const pinned = useWorkspacePinned();
  return (
    <>
      <button
        type="button"
        className="cq-ws-toggle cq-ws-pin"
        aria-pressed={pinned}
        aria-label={t("Pin workspace")}
        title={
          pinned ? t("Workspace pinned. Select to unpin.") : t("Pin workspace")
        }
        onClick={() => setWorkspacePinned(!pinned)}
        data-ws-pin={place}
        {...(pinned ? { "data-pinned": "" } : {})}
      >
        <Pin
          size={ICON_SIZE.regular}
          strokeWidth={ICON_STROKE}
          fill={pinned ? "currentColor" : "none"}
          aria-hidden="true"
        />
        {pinned ? (
          <span className="cq-ws-pin-word" aria-hidden="true">
            {t("Pinned")}
          </span>
        ) : null}
      </button>
      <span className="sr-only" role="status">
        {pinned ? t("Workspace pinned") : ""}
      </span>
    </>
  );
}
