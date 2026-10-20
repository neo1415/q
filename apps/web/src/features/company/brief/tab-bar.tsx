"use client";

import { useLayoutEffect, useRef } from "react";

import type { ProfileTab } from "../profile-tab";
import { ProfileTabLink, useProfileTab } from "../profile-tabs";

/**
 * The profile's tabs (option 1): words with a count, and one underline
 * that slides to the open tab (transform and width only, on the tab's own
 * measured box, so it follows any language's word lengths). The panel's
 * cross-fade is ProfileTabs'.
 */
export function BriefTabBar({
  label,
  base,
  tabs,
  serverTab,
}: {
  readonly label: string;
  readonly base: string;
  readonly tabs: readonly (readonly [ProfileTab, string, number | null])[];
  readonly serverTab: ProfileTab;
}) {
  const open = useProfileTab() ?? serverTab;
  const nav = useRef<HTMLElement>(null);
  const ink = useRef<HTMLSpanElement>(null);
  const placed = useRef(false);

  useLayoutEffect(() => {
    const bar = nav.current;
    const line = ink.current;
    if (bar === null || line === null) return;
    const place = () => {
      const on = bar.querySelector<HTMLElement>(`[data-profile-tab="${open}"]`);
      if (on === null) return;
      line.style.width = `${String(on.offsetWidth)}px`;
      line.style.transform = `translateX(${String(on.offsetLeft)}px)`;
    };
    // The first placement lands; only a change of tab slides.
    if (!placed.current) {
      line.style.transition = "none";
      place();
      void line.offsetWidth;
      line.style.transition = "";
      placed.current = true;
    } else place();
    if (typeof ResizeObserver !== "function") return;
    const watch = new ResizeObserver(place);
    watch.observe(bar);
    return () => watch.disconnect();
  }, [open]);

  return (
    <nav ref={nav} aria-label={label} className="cq-brief-tabs">
      {tabs.map(([value, words, count]) => (
        <ProfileTabLink
          key={value}
          tab={value}
          fallbackHref={value === "overview" ? base : `${base}?tab=${value}`}
          current={open === value}
          className="cq-brief-tab"
          data-profile-tab={value}
        >
          {words}
          {count === null ? null : (
            <span className="cq-brief-count">{count}</span>
          )}
        </ProfileTabLink>
      ))}
      <span ref={ink} className="cq-brief-ink" aria-hidden="true" />
    </nav>
  );
}
