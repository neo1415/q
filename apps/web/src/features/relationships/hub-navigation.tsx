"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type RefObject,
} from "react";

import { IntentLink } from "@/components/app-shell/intent-link";

import { cx } from "@capital-q/ui";
import { ArrowUpRight, ICON_SIZE } from "@capital-q/ui/icons";

import { useQControlGroup } from "@/features/q/control/q-control";
import { QPageState } from "@/features/q/q-section";
import { LinkPending } from "@/components/link-pending";

import {
  hubDestinations,
  hubTabs,
  type HubSide,
  type HubView,
} from "./hub-view";
import { useT } from "@/features/i18n/language";

/**
 * One tab strip for every workspace that has tabs (the CRM, Work): a
 * bottom-ruled row that scrolls sideways on a phone, bleeding to the
 * gutter, with no visible scrollbar and no page-level sideways scroll.
 */
export const TAB_STRIP_CLASS =
  "relative -mx-4 flex items-stretch gap-1 overflow-x-auto border-b border-(--cq-border-subtle) px-4 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden";

/** A tab in that strip: 44 px tall, the open one ruled and bold. */
export function tabClass(open: boolean): string {
  return cx(
    "cq-body-sm relative -mb-px inline-flex min-h-11 flex-none items-center gap-1.5 border-b-2 px-3 whitespace-nowrap transition-colors duration-(--cq-motion-fast) focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--cq-focus-ring)",
    open
      ? "border-(--cq-accent) font-semibold text-(--cq-text-primary)"
      : "border-transparent font-medium text-(--cq-text-secondary) hover:text-(--cq-text-primary)",
  );
}

/**
 * The tab drawn as open (instant tabs 2026-10-18): the one just clicked,
 * at once, until the server's view arrives; then the server's again. A
 * chosen tab belongs to the view it was chosen from, so it resets by
 * itself the moment the page's view changes, and back/forward drops it.
 * Drawing only: what the page shows is still the server's read, and Q's
 * tab confirmation still waits for the route to settle.
 */
export function useChosenTab<V extends string>(
  view: V,
): {
  readonly open: V;
  readonly choose: (next: V) => (event: MouseEvent<HTMLElement>) => void;
} {
  const [chosen, setChosen] = useState<{
    readonly from: V;
    readonly to: V;
  } | null>(null);
  useEffect(() => {
    const drop = () => {
      setChosen(null);
    };
    window.addEventListener("popstate", drop);
    return () => {
      window.removeEventListener("popstate", drop);
    };
  }, []);
  const open = chosen !== null && chosen.from === view ? chosen.to : view;
  const choose = useCallback(
    (next: V) => (event: MouseEvent<HTMLElement>) => {
      // Only a plain click navigates here; a new tab or window does not.
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      setChosen({ from: view, to: next });
    },
    [view],
  );
  return { open, choose };
}

/** Keeps the open tab in view on a narrow, scrolling strip. */
export function useOpenTabInView(
  ref: RefObject<HTMLElement | null>,
  key: string,
): void {
  useEffect(() => {
    const strip = ref.current;
    const open = strip?.querySelector<HTMLElement>('[aria-current="page"]');
    if (strip === null || open === null || open === undefined) return;
    // Measured on screen, so it holds right to left (Arabic) as well:
    // a relative scrollLeft step moves the same way in both directions.
    const box = open.getBoundingClientRect();
    const frame = strip.getBoundingClientRect();
    if (box.right > frame.right)
      strip.scrollLeft += box.right - frame.right + 16;
    else if (box.left < frame.left)
      strip.scrollLeft -= frame.left - box.left + 16;
  }, [ref, key]);
}

/**
 * The CRM workspace's own tabs. Links own the state, so refresh, back and
 * forward recover the same area. Only the workspace's views are tabs; the
 * modules a relationship's work continues in are HubRelated links beside
 * the title (redesign 2026-10-15: they read as tabs and were not). On a
 * phone the strip scrolls sideways and keeps the open tab in view.
 */
export function HubNavigation({
  view,
  side = "NONE",
}: {
  readonly view: HubView;
  readonly side?: HubSide;
}) {
  const t = useT();

  const ref = useRef<HTMLElement>(null);
  useQControlGroup({
    kind: "TAB",
    ref,
    ids: {
      "tab.overview": '[data-hub-view="overview"]',
      "tab.pipeline": '[data-hub-view="pipeline"]',
      // Capital is the CRM's own tab (owner 2026-10-16).
      "tab.capital": '[data-hub-view="capital"]',
      // Kept for Q (catalog-stable): the Relationships tab became the
      // Pipeline's List layout, so its id selects the Pipeline tab.
      "tab.relationships": '[data-hub-view="pipeline"]',
      // GateQ, requests and applications are CRM tabs (owner 2026-10-17);
      // the old GateQ link's id selects whichever this side has.
      "tab.gateq": '[data-hub-view="gateq"]',
      "tab.requests": '[data-hub-view="requests"]',
      "tab.applications": '[data-hub-view="applications"]',
    },
  });
  // The old GateQ link's id (catalog-stable) now acts on this side's tab.
  useQControlGroup({
    kind: "BUTTON",
    ref,
    ids: {
      "button.hub-gateq":
        '[data-hub-view="gateq"], [data-hub-view="applications"]',
    },
  });

  const chosen = useChosenTab(view);
  useOpenTabInView(ref, chosen.open);

  return (
    <nav ref={ref} aria-label={t("CRM")} className={TAB_STRIP_CLASS}>
      {/* Q's page state is the server's view, never the optimistic one. */}
      <QPageState
        {...(view === "overview" ? { tab: "overview" as const } : {})}
        filters={{ view }}
      />
      {hubTabs(side).map((entry) => {
        // The tab just clicked is drawn open at once (useChosenTab); its
        // pending mark is LinkPending (perf lane) while the view is read.
        // Hover, focus or touch prefetches it in full (IntentLink).
        const open = chosen.open === entry.view;
        return (
          <IntentLink
            key={entry.view}
            href={entry.href}
            data-hub-view={entry.view}
            aria-current={open ? "page" : undefined}
            className={tabClass(open)}
            onClick={chosen.choose(entry.view)}
          >
            {t(entry.label)}
            <LinkPending />
          </IntentLink>
        );
      })}
    </nav>
  );
}

/**
 * Where a relationship's work continues outside the CRM (GateQ): a quiet
 * link beside the title, marked as leaving the workspace. Q keeps
 * `button.hub-gateq`; the sidebar's own entries are not repeated here.
 */
export function HubRelated({ side }: { readonly side: HubSide }) {
  const t = useT();

  const ref = useRef<HTMLElement>(null);
  useQControlGroup({
    kind: "BUTTON",
    ref,
    ids: {
      "button.hub-gateq": '[data-hub-link="gateq"]',
    },
  });
  const destinations = hubDestinations(side);
  if (destinations.length === 0) return null;
  return (
    <nav
      ref={ref}
      aria-label={t("Related")}
      className="flex flex-wrap items-center gap-x-1"
    >
      {destinations.map((entry) => (
        <Link
          key={entry.id}
          href={entry.href}
          data-hub-link={entry.id}
          className="cq-body-sm inline-flex min-h-11 items-center gap-1 px-2 text-(--cq-text-secondary) transition-colors duration-(--cq-motion-fast) hover:bg-(--cq-surface-subtle) hover:text-(--cq-text-primary) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)"
        >
          {t(entry.label)}
          <ArrowUpRight
            size={ICON_SIZE.compact}
            aria-hidden="true"
            className="text-(--cq-text-tertiary)"
          />
        </Link>
      ))}
    </nav>
  );
}
