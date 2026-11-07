"use client";

import { useEffect } from "react";

import { engagementReporter } from "./engagement-reporter";

/**
 * Q Workspace §8 A1: a signed-in participant viewed a company's Q Card.
 * The card carries only its handle; the server resolves it to the company
 * and applies the viewer's visibility. Renders nothing.
 */
export function QCardViewBeacon({ handle }: { readonly handle: string }) {
  useEffect(() => {
    engagementReporter().report({ type: "Q_CARD_VIEW", handle });
  }, [handle]);
  return null;
}
