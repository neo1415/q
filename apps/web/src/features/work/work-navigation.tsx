"use client";

import { useRef } from "react";

import { IntentLink } from "@/components/app-shell/intent-link";
import { LinkPending } from "@/components/link-pending";
import { useT } from "@/features/i18n/language";
import { useQControlGroup } from "@/features/q/control/q-control";
import {
  TAB_STRIP_CLASS,
  tabClass,
  useChosenTab,
  useOpenTabInView,
} from "@/features/relationships/hub-navigation";
import type { HubSide } from "@/features/relationships/hub-view";

import { useWaitingOnYou } from "./notice-store";
import { workTabs, type WorkView } from "./work-tabs";

/**
 * Work's one strip of tabs (owner-approved 2026-10-18), built as the CRM's
 * (`HubNavigation`): links own the state, so refresh, back and forward
 * recover the same tab, and on a phone the strip scrolls sideways with the
 * open tab kept in view. Tasks carries the count of what waits for the
 * person, from the shell's one notice read (no extra call).
 */
export function WorkNavigation({
  view,
  side = "NONE",
}: {
  readonly view: WorkView;
  readonly side?: HubSide;
}) {
  const t = useT();
  const ref = useRef<HTMLElement>(null);
  useQControlGroup({
    kind: "TAB",
    ref,
    ids: {
      "tab.work-tasks": '[data-work-tab="tasks"]',
      "tab.work-board": '[data-work-tab="board"]',
      "tab.work-documents": '[data-work-tab="documents"]',
      "tab.work-pitch": '[data-work-tab="pitch"]',
      "tab.work-rehearsals": '[data-work-tab="rehearsals"]',
      "tab.work-daily": '[data-work-tab="daily"]',
    },
  });
  // The tab just clicked is drawn open at once, until its page arrives.
  const chosen = useChosenTab(view);
  useOpenTabInView(ref, chosen.open);

  const needsYou = useWaitingOnYou();

  return (
    <nav ref={ref} aria-label={t("Work")} className={TAB_STRIP_CLASS}>
      {workTabs(side).map((entry) => {
        const open = chosen.open === entry.view;
        const waiting = entry.view === "tasks" && needsYou > 0 ? needsYou : 0;
        return (
          <IntentLink
            key={entry.view}
            href={entry.href}
            data-work-tab={entry.view}
            aria-current={open ? "page" : undefined}
            aria-label={
              waiting === 0
                ? undefined
                : `${t(entry.label)}, ${t(`${String(waiting)} waiting for you`)}`
            }
            className={tabClass(open)}
            onClick={chosen.choose(entry.view)}
          >
            {t(entry.label)}
            {waiting === 0 ? null : (
              <span
                aria-hidden="true"
                className="cq-label cq-numeric font-semibold text-(--cq-accent)"
              >
                {waiting}
              </span>
            )}
            <LinkPending />
          </IntentLink>
        );
      })}
    </nav>
  );
}
