"use client";

import { useState, useSyncExternalStore } from "react";

import type { QNavigationOfferBlock } from "@capital-q/contracts";
import { buttonClassName } from "@capital-q/ui/button";

import { useT } from "@/features/i18n/language";

import { openOfferedPage } from "./client-actions";
import { offerAnsweredLater, offerKey } from "./navigation-offers";
import { useQSessionOptional } from "./q-session";
import { setPane } from "@/features/workspace/layout-store";
import { setWorkspacePinned } from "@/features/workspace/workspace-pin";
import { useWorkspacePlace } from "@/features/workspace/workspace-place";

/**
 * N1 (owner 2026-11-04): Q answered where the person is and offers the page
 * that holds the rest -- "Open pipeline" / "Stay here". Open makes the move
 * through the one navigation lifecycle (the conversation stays in the
 * dock); Stay settles the offer without moving. Either way the offer is
 * done: settled per message on this device, so it does not come back on a
 * re-render, a remount or a reload of the same conversation, and (N3) once
 * a later Q message answered it, everywhere.
 */

const SETTLED_PREFIX = "cq.q.offer.";
/** This tab's settled offers, for when storage is blocked. */
const settledHere = new Set<string>();
/** N3: every view of the same offer (stage, Chat, dock) settles together. */
const listeners = new Set<() => void>();

function isSettled(key: string): boolean {
  if (settledHere.has(key)) return true;
  try {
    return window.localStorage.getItem(SETTLED_PREFIX + key) !== null;
  } catch {
    return false;
  }
}

function settle(key: string, how: "OPENED" | "STAYED"): void {
  settledHere.add(key);
  try {
    window.localStorage.setItem(SETTLED_PREFIX + key, how);
  } catch {
    // Private window or blocked storage: this tab still remembers.
  }
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test seam: forget every settled offer. */
export function resetSettledOffers(): void {
  settledHere.clear();
  for (const listener of [...listeners]) listener();
}

const NO_TURNS: readonly never[] = [];

export function NavigationOfferCard({
  block,
  href,
  turnId,
}: {
  readonly block: QNavigationOfferBlock;
  /** The registered route for the offered move; null renders nothing. */
  readonly href: string | null;
  /** The Q message this offer belongs to; absent: this mount only. */
  readonly turnId?: string | undefined;
}) {
  const t = useT();
  const settleKey = turnId === undefined ? undefined : offerKey(turnId, block);
  const [settledHereNow, setSettledHereNow] = useState(false);
  const settledOnDevice = useSyncExternalStore(
    subscribe,
    () => settleKey !== undefined && isSettled(settleKey),
    () => false,
  );
  // N3: a typed or spoken yes/no is answered by a later Q message; from the
  // durable conversation, so the card goes on every device and on reload.
  const turns = useQSessionOptional()?.turns ?? NO_TURNS;
  const answered = turnId !== undefined && offerAnsweredLater(turns, turnId);
  // Q Workspace: the page pane is already on the offered place.
  const place = useWorkspacePlace(href);
  if (
    href === null ||
    settledHereNow ||
    settledOnDevice ||
    answered ||
    place === "SHOWN"
  ) {
    return null;
  }
  const done = (how: "OPENED" | "STAYED") => {
    if (settleKey !== undefined) settle(settleKey, how);
    setSettledHereNow(true);
  };
  // Pinned workspace: they asked to go while the workspace was pinned.
  // One tap unpins, then opens the place; an ordinary offer's Open is a
  // move of their own and leaves a pin as it is.
  const unpin = block.unpin === true;
  const openLabel = unpin
    ? t(`Unpin and open ${t(block.place)}`)
    : t(block.openLabel);
  return (
    <section
      className="flex flex-col gap-3 rounded-lg border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-4"
      data-q-result-card
      data-q-navigation-offer
      aria-label={t("Where this lives")}
      {...(unpin ? { "data-q-navigation-offer-unpin": "" } : {})}
    >
      <div className="flex flex-col gap-1">
        <span className="cq-label text-(--cq-text-tertiary)">
          {unpin ? t("Workspace pinned") : t("Where this lives")}
        </span>
        <p className="cq-body font-medium text-(--cq-text-primary)">
          {t(block.place)}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={buttonClassName("secondary", "compact")}
          onClick={() => {
            done("OPENED");
            if (unpin) setWorkspacePinned(false);
            // Folded over the same place: show it rather than move.
            if (place === "COLLAPSED") setPane("pagePane", "open");
            else openOfferedPage(href);
          }}
        >
          {place === "COLLAPSED" ? t("Show the page") : openLabel}
        </button>
        <button
          type="button"
          className={buttonClassName("quiet", "compact")}
          onClick={() => {
            done("STAYED");
          }}
        >
          {t("Stay here")}
        </button>
      </div>
    </section>
  );
}
