"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { cx } from "@capital-q/ui";

import "@/features/relationships/crm.css";
import { TAB_STRIP_CLASS } from "@/features/relationships/hub-navigation";

/**
 * The investor page's three tabs (app prototype "investor", option 2):
 * Overview, What they look for, Their gate. Every panel is rendered on the
 * server and stays in the page; the strip only shows one at a time, so a
 * link to `#apply` or a Q Pitch line about a section in another tab still
 * finds it: when the tour lights a section inside a hidden panel, that
 * panel opens and the section is brought into view, as a person would by
 * pressing its tab. The chosen tab is kept in the address (`?tab=`) so a
 * refresh or Back returns to it.
 */

export type InvestorTab = {
  readonly key: string;
  readonly label: string;
  readonly panel: ReactNode;
};

export function InvestorTabs({
  tabs,
  initial,
  label,
}: {
  readonly tabs: readonly InvestorTab[];
  readonly initial?: string | undefined;
  readonly label: string;
}) {
  const first = tabs[0]?.key ?? "";
  const [open, setOpen] = useState(
    tabs.some((tab) => tab.key === initial) ? (initial ?? first) : first,
  );
  const root = useRef<HTMLDivElement>(null);

  const choose = (key: string) => {
    setOpen(key);
    const url = new URL(window.location.href);
    if (key === first) url.searchParams.delete("tab");
    else url.searchParams.set("tab", key);
    url.hash = "";
    window.history.replaceState(window.history.state, "", url);
  };

  // A section lit by the tour, or reached by a hash, inside a hidden panel
  // opens that panel (read-only: it only follows what is already asked).
  useEffect(() => {
    const element = root.current;
    if (element === null) return;
    const reveal = (target: Element | null) => {
      const panel = target?.closest<HTMLElement>("[data-investor-panel]");
      const key = panel?.dataset.investorPanel;
      if (panel === null || panel === undefined || key === undefined) return;
      if (!panel.hidden) return;
      setOpen(key);
      requestAnimationFrame(() =>
        target?.scrollIntoView({ block: "start", behavior: "auto" }),
      );
    };
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (
          record.target instanceof HTMLElement &&
          record.target.hasAttribute("data-qp-lit")
        ) {
          reveal(record.target);
        }
      }
    });
    observer.observe(element, {
      subtree: true,
      attributes: true,
      attributeFilter: ["data-qp-lit"],
    });
    const onHash = () => {
      const id = window.location.hash.slice(1);
      if (id.length > 0) reveal(document.getElementById(id));
    };
    onHash();
    window.addEventListener("hashchange", onHash);
    return () => {
      observer.disconnect();
      window.removeEventListener("hashchange", onHash);
    };
  }, []);

  return (
    <div ref={root} className="flex flex-col">
      <nav aria-label={label} className={cx(TAB_STRIP_CLASS, "mb-[18px]")}>
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            aria-current={open === tab.key ? "page" : undefined}
            onClick={() => choose(tab.key)}
            className={cx(
              "cq-body-sm relative -mb-px inline-flex min-h-11 flex-none items-center border-b-2 px-3 whitespace-nowrap transition-colors duration-(--cq-motion-fast) focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--cq-focus-ring)",
              open === tab.key
                ? "border-[var(--cq-tile,var(--cq-accent))] font-semibold text-(--cq-text-primary)"
                : "border-transparent font-medium text-(--cq-text-secondary) hover:text-(--cq-text-primary)",
            )}
            data-investor-tab={tab.key}
          >
            {tab.label}
          </button>
        ))}
      </nav>
      {tabs.map((tab) => (
        <div
          key={tab.key}
          hidden={open !== tab.key}
          className={
            open === tab.key
              ? "cq-crm-stagger flex flex-col gap-3.5"
              : undefined
          }
          data-investor-panel={tab.key}
        >
          {tab.panel}
        </div>
      ))}
    </div>
  );
}
