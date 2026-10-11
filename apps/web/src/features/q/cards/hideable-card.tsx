"use client";

import type { ReactNode } from "react";

import { useCardHidden, type CardRef } from "./card-visibility";

/** A card the person can clear: hidden means not rendered, no space. */
export function HideableCard({
  card,
  children,
}: {
  readonly card: CardRef;
  readonly children: ReactNode;
}) {
  return useCardHidden(card) ? null : <>{children}</>;
}
