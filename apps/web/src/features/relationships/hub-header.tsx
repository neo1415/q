import type { ReactNode } from "react";

import { HubNavigation, HubRelated } from "./hub-navigation";
import { hubTitle, type HubSide, type HubView } from "./hub-view";

/**
 * The CRM's one header (redesign 2026-10-15): the Hub's name, the modules
 * the work continues in and any page action on one line, then the
 * workspace's tabs. One h1; a tab never repeats its own name as a heading.
 */
export function HubHeader({
  side,
  view,
  actions = null,
}: {
  readonly side: HubSide;
  readonly view: HubView;
  readonly actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h1 className="cq-title-lg text-(--cq-text-primary)">
          {hubTitle(side)}
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <HubRelated side={side} />
          {actions}
        </div>
      </div>
      <HubNavigation view={view} />
    </header>
  );
}
