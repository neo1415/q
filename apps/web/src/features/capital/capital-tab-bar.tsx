"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import {
  CAPITAL_TABS,
  capitalTabHref,
  tabForHash,
  type CapitalTab,
} from "./capital-tabs";

/**
 * The Capital tab bar (design: docs/design/2026-10-08/capital-tabs). Each
 * tab is a link to its own URL, so back and forward move between tabs and
 * the server reads only the open tab's data. ARIA tabs with a roving
 * tabindex: arrows move between tabs, Home and End jump, Enter or Space
 * opens. On a phone the bar scrolls sideways and keeps the open tab in view.
 * Badges arrive on their own, after the bar has painted.
 */
export function CapitalTabBar({
  active,
  hadTabParam,
  badges = {},
}: {
  readonly active: CapitalTab;
  /** Whether the URL named a tab; an old `#anchor` link is mapped only when not. */
  readonly hadTabParam: boolean;
  readonly badges?: Partial<Record<CapitalTab, ReactNode>>;
}) {
  const router = useRouter();
  const listRef = useRef<HTMLDivElement>(null);
  // The underline moves on the tap; the panel follows when the server answers.
  // A pick made while another tab was open; once the server answers with
  // a new active tab, the pick no longer applies.
  const [pick, setPick] = useState<{
    readonly tab: CapitalTab;
    readonly from: CapitalTab;
  } | null>(null);
  const chosen = pick !== null && pick.from === active ? pick.tab : active;

  // Links from before the tabs (/capital#action-plan) still open their tab.
  useEffect(() => {
    if (hadTabParam) return;
    const wanted = tabForHash(window.location.hash);
    if (wanted === null || wanted === active) return;
    const search = new URLSearchParams(window.location.search);
    search.set("tab", wanted);
    router.replace(`/capital?${search.toString()}${window.location.hash}`, {
      scroll: false,
    });
  }, [active, hadTabParam, router]);

  // Keep the open tab in view on a narrow, scrolling bar.
  useEffect(() => {
    const list = listRef.current;
    const tab = list?.querySelector<HTMLElement>(`[data-tab="${chosen}"]`);
    if (
      list === null ||
      list === undefined ||
      tab === null ||
      tab === undefined
    )
      return;
    const left = tab.offsetLeft - list.offsetLeft;
    if (left < list.scrollLeft) list.scrollLeft = left - 16;
    else if (left + tab.offsetWidth > list.scrollLeft + list.clientWidth)
      list.scrollLeft = left + tab.offsetWidth - list.clientWidth + 16;
  }, [chosen]);

  function onKeyDown(event: KeyboardEvent<HTMLAnchorElement>) {
    const tabs = Array.from(
      listRef.current?.querySelectorAll<HTMLAnchorElement>('[role="tab"]') ??
        [],
    );
    const at = tabs.indexOf(event.currentTarget);
    const last = tabs.length - 1;
    const next =
      event.key === "ArrowRight"
        ? at === last
          ? 0
          : at + 1
        : event.key === "ArrowLeft"
          ? at === 0
            ? last
            : at - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (next !== null) {
      event.preventDefault();
      tabs[next]?.focus();
      return;
    }
    if (event.key === " ") {
      event.preventDefault();
      event.currentTarget.click();
    }
  }

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label="Capital"
      className="-mx-4 flex gap-1 overflow-x-auto border-b border-(--cq-border-subtle) px-4 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden"
    >
      {CAPITAL_TABS.map((tab) => {
        const selected = tab.key === chosen;
        return (
          <Link
            key={tab.key}
            id={`capital-tab-${tab.key}`}
            data-tab={tab.key}
            href={capitalTabHref(tab.key)}
            scroll={false}
            role="tab"
            aria-selected={selected}
            aria-controls="capital-panel"
            tabIndex={selected ? 0 : -1}
            onKeyDown={onKeyDown}
            onClick={() => setPick({ tab: tab.key, from: active })}
            className={`cq-body-sm -mb-px inline-flex min-h-11 flex-none items-center gap-2 border-b-2 px-3 whitespace-nowrap focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--cq-focus-ring) ${selected ? "border-(--cq-accent) font-semibold text-(--cq-text-primary)" : "border-transparent font-medium text-(--cq-text-secondary) hover:text-(--cq-text-primary)"}`}
          >
            {tab.label}
            {badges[tab.key] ?? null}
          </Link>
        );
      })}
    </div>
  );
}

/** A count on a tab: neutral, never red; read with the tab's name. */
export function TabBadge({
  text,
  spoken,
}: {
  readonly text: string;
  readonly spoken: string;
}) {
  return (
    <span className="cq-caption cq-numeric rounded-full bg-(--cq-surface-subtle) px-2 py-0.5 font-medium text-(--cq-text-secondary)">
      <span aria-hidden="true">{text}</span>
      <span className="sr-only">{`, ${spoken}`}</span>
    </span>
  );
}
