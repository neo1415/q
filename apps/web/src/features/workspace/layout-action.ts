"use client";

import type { PaneState } from "./layout-rules";
import { setLayout } from "./layout-store";

/**
 * Q's `LAYOUT_SET` (W1.5, approval class NONE): open or collapse the
 * workspace panes, exactly as the pane controls do. The shape is the one
 * proposed to W3 for `ui-intent.ts`; client-actions.ts routes it here once
 * W3 lands the schema.
 *
 * Outside the workspace (flag off) there are no panes: nothing changes and
 * the action still counts as handled, so Q never reports a failure for it.
 * (Producers emit it only when the workspace is on.)
 */
export type LayoutSetAction = {
  readonly qPane?: PaneState | undefined;
  readonly pagePane?: PaneState | undefined;
};

export function performLayoutSet(action: LayoutSetAction): boolean {
  if (action.qPane === undefined && action.pagePane === undefined) {
    return false;
  }
  if (document.querySelector(".cq-shell[data-workspace]") === null) {
    return true;
  }
  setLayout(action);
  return true;
}
