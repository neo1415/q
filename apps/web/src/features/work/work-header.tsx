import Link from "next/link";
import type { ReactNode } from "react";

import { ArrowUpRight, ICON_SIZE } from "@capital-q/ui/icons";

import { serverTNow } from "@/features/i18n/server-now";
import type { OwnContext } from "@/features/q/context";
import type { HubSide } from "@/features/relationships/hub-view";

import { WorkNavigation } from "./work-navigation";
import { WORK_DATA_ROOM_HREF, type WorkView } from "./work-tabs";

/** Which tabs a person's own context shows: Pitch is a founder's. */
export function workSideOf(context: OwnContext | null): HubSide {
  if (context?.kind === "FOUNDER") return "COMPANY";
  if (context?.kind === "INVESTOR") return "INVESTOR";
  return "NONE";
}

/**
 * Work's one header, as the CRM's (`HubHeader`): the title "Work" and any
 * page action on one line, an optional line of description, then the
 * tabs. One h1; a tab never repeats its own name as a heading. On the
 * founder's Pitch tab, their data room and deck sit beside the title, so
 * the data room is reached from Pitch (it opens on their company page).
 */
export function WorkHeader({
  view,
  side,
  description,
  actions = null,
}: {
  readonly view: WorkView;
  readonly side: HubSide;
  readonly description?: string | undefined;
  readonly actions?: ReactNode;
}) {
  const t = serverTNow();
  const dataRoom = view === "pitch" && side === "COMPANY";
  return (
    <header className="flex flex-col gap-2 pb-6">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h1 className="cq-title-xl min-w-0 text-(--cq-text-primary)">
          {t("Work")}
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          {dataRoom ? (
            <Link
              href={WORK_DATA_ROOM_HREF}
              data-work-link="data-room"
              className="cq-body-sm inline-flex min-h-11 items-center gap-1 px-2 text-(--cq-text-secondary) transition-colors duration-(--cq-motion-fast) hover:bg-(--cq-surface-subtle) hover:text-(--cq-text-primary) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)"
            >
              {t("Data room & deck")}
              <ArrowUpRight
                size={ICON_SIZE.compact}
                aria-hidden="true"
                className="text-(--cq-text-tertiary)"
              />
            </Link>
          ) : null}
          {actions}
        </div>
      </div>
      <WorkNavigation view={view} side={side} />
      {description === undefined ? null : (
        <p className="cq-body max-w-(--cq-layout-reading) pt-2 text-(--cq-text-secondary)">
          {description}
        </p>
      )}
    </header>
  );
}
