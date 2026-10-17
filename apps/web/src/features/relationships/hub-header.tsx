import type { ReactNode } from "react";

import { HubNavigation } from "./hub-navigation";
import { hubTitle, type HubSide, type HubView } from "./hub-view";
import { serverTNow } from "@/features/i18n/server-now";

/**
 * The CRM's one header (redesign 2026-10-15): the Hub's name and any page
 * action on one line, then the workspace's tabs (GateQ is one of them
 * since 2026-10-17, so no separate link beside the title). One h1; a tab never repeats its own name as a heading.
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
  const t = serverTNow();

  return (
    <header className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h1 className="cq-title-lg text-(--cq-text-primary)">
          {t(hubTitle(side))}
        </h1>
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      </div>
      <HubNavigation view={view} side={side} />
    </header>
  );
}
