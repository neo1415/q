"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { YourCompaniesPageDto } from "@capital-q/contracts";

import { useQControlGroup } from "@/features/q/control/q-control";

import {
  setDiscoverTab,
  useDiscoverTab,
  type DiscoverTab,
} from "./discover-tab";
import { YourCompaniesFeed } from "./your-companies";

/**
 * Discover's two tabs at the top of the stage (founder decision
 * 2026-10-04), like TikTok's For You and Following: "For you", the
 * recommended feed, and "Your companies". Switching is instant and keeps
 * both feeds where they were: each stays mounted once opened, the one not
 * showing is hidden and inert, and its player holds. The address follows
 * (`/discover?tab=yours`) without a navigation, so a reload or a link
 * from Q lands on the same tab.
 */

const TABS: readonly { readonly tab: DiscoverTab; readonly label: string }[] = [
  { tab: "FOR_YOU", label: "For you" },
  { tab: "YOURS", label: "Your companies" },
];

/** Q's ids for the tabs (literal, for the capability parity matrix). */
const Q_DISCOVER_TABS: Readonly<Record<string, string>> = {
  "tab.for-you": '[data-discover-tab-button="FOR_YOU"]',
  "tab.yours": '[data-discover-tab-button="YOURS"]',
};

const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

export function DiscoverTabs({
  initialTab,
  forYou,
  yoursInitial,
  focusCompanyId,
}: {
  readonly initialTab: DiscoverTab;
  /** The recommended feed, rendered by the page. */
  readonly forYou: ReactNode;
  /** Your companies' first page, when the page read it. */
  readonly yoursInitial: YourCompaniesPageDto | null;
  /** A company to open on in Your companies ("show me Nixo's pitch"). */
  readonly focusCompanyId: string | null;
}) {
  // Set before paint, so neither feed starts under the wrong tab.
  useIsomorphicLayoutEffect(() => {
    setDiscoverTab(initialTab);
    return () => setDiscoverTab("FOR_YOU");
  }, [initialTab]);
  const tab = useDiscoverTab(initialTab);
  // Your companies mounts the first time it is opened, then stays.
  const [yoursOpened, setYoursOpened] = useState(initialTab === "YOURS");

  // RECOVERY-2026-10 (C1): the two tabs, for Q, by their own markers.
  const tabsRef = useRef<HTMLElement>(null);
  useQControlGroup({ kind: "TAB", ref: tabsRef, ids: Q_DISCOVER_TABS });
  const choose = (next: DiscoverTab) => {
    if (next === "YOURS") setYoursOpened(true);
    setDiscoverTab(next);
    const url = new URL(window.location.href);
    if (next === "YOURS") url.searchParams.set("tab", "yours");
    else url.searchParams.delete("tab");
    url.searchParams.delete("company");
    window.history.replaceState(window.history.state, "", url);
  };

  return (
    <div className="cq-discover" data-discover-tab={tab}>
      <nav aria-label="Discover" className="cq-discover-tabs" ref={tabsRef}>
        {TABS.map((entry) => {
          const selected = entry.tab === tab;
          return (
            <button
              key={entry.tab}
              type="button"
              className="cq-discover-tab"
              aria-pressed={selected}
              aria-current={selected ? "page" : undefined}
              onClick={() => choose(entry.tab)}
              data-discover-tab-button={entry.tab}
            >
              {entry.label}
            </button>
          );
        })}
      </nav>
      <div hidden={tab !== "FOR_YOU"} inert={tab !== "FOR_YOU"}>
        {forYou}
      </div>
      {yoursOpened ? (
        <div
          hidden={tab !== "YOURS"}
          inert={tab !== "YOURS"}
          className="cq-stage"
          data-feed-immersive={tab === "YOURS" ? "" : undefined}
        >
          <YourCompaniesFeed
            initial={yoursInitial}
            focusCompanyId={focusCompanyId}
          />
        </div>
      ) : null}
    </div>
  );
}
