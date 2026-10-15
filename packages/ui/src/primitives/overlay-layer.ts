"use client";

import { createContext, useContext } from "react";

/**
 * Which layer an anchored popup (menu, popover) opens on. Popups portal to
 * the body, so inside a sheet or dialog the page layer (--cq-z-popover)
 * sits beneath the overlay, which then takes the clicks meant for the
 * popup. Sheets and dialogs provide "modal", so anything anchored inside
 * them opens on --cq-z-modal-popover without each caller remembering to.
 */
export type OverlayLayer = "page" | "modal";

export const OverlayLayerContext = createContext<OverlayLayer>("page");

export function useOverlayLayer(): OverlayLayer {
  return useContext(OverlayLayerContext);
}

export const POPUP_LAYER_CLASS: Readonly<Record<OverlayLayer, string>> = {
  page: "z-(--cq-z-popover)",
  modal: "z-(--cq-z-modal-popover)",
};
