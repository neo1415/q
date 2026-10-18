"use client";

import { useSearchParams } from "next/navigation";

import { cx } from "@capital-q/ui";

import { hubTabs, hubViewOf, type HubSide, type HubView } from "./hub-view";
import { useT } from "@/features/i18n/language";
import { useOwnSubject } from "@/features/q/q-subject";

/**
 * The side the shell already resolved for this person, for drawing a
 * loading strip with the same tabs the page will show (an investor's CRM
 * has five, a founder's four). Null outside the shell: the strip is then
 * neutral. Never authority; a loading state reads nothing.
 */
export function useOwnSide(): HubSide | null {
  const own = useOwnSubject();
  if (own === null) return null;
  return own.kind === "COMPANY"
    ? "COMPANY"
    : own.kind === "INVESTOR_ORGANISATION"
      ? "INVESTOR"
      : "NONE";
}

/**
 * A strip of tab names while a page loads, in the same place and size as
 * the real strip, the destination underlined. Drawn only, never a second
 * set of links.
 */
export function LoadingTabStrip({
  tabs,
  open,
}: {
  readonly tabs: readonly { readonly key: string; readonly label: string }[];
  readonly open: string;
}) {
  const t = useT();
  return (
    <span
      aria-hidden="true"
      data-loading-tabs
      className="-mx-4 flex items-stretch gap-1 overflow-hidden border-b border-(--cq-border-subtle) px-4 sm:mx-0 sm:px-0"
    >
      {tabs.map((entry) => (
        <span
          key={entry.key}
          data-loading-tab={entry.key}
          data-open={entry.key === open ? "" : undefined}
          className={cx(
            "cq-body-sm -mb-px inline-flex min-h-11 flex-none items-center border-b-2 px-3 whitespace-nowrap",
            entry.key === open
              ? "border-(--cq-accent) font-semibold text-(--cq-text-primary)"
              : "border-transparent font-medium text-(--cq-text-secondary)",
          )}
        >
          {t(entry.label)}
        </span>
      ))}
    </span>
  );
}

/**
 * The tabs a loading strip draws: this side's, or, when the side is not
 * known, the tabs every side has plus the destination itself.
 */
export function loadingTabsFor<V extends string>(
  side: HubSide | null,
  view: V,
  tabsOf: (
    side: HubSide,
  ) => readonly { readonly view: V; readonly label: string }[],
): readonly { readonly key: V; readonly label: string }[] {
  const keyed = (
    list: readonly { readonly view: V; readonly label: string }[],
  ) => list.map((entry) => ({ key: entry.view, label: entry.label }));
  if (side !== null) return keyed(tabsOf(side));
  const common = keyed(tabsOf("NONE"));
  if (common.some((entry) => entry.key === view)) return common;
  const destination = [...tabsOf("INVESTOR"), ...tabsOf("COMPANY")].find(
    (entry) => entry.view === view,
  );
  return destination === undefined
    ? common
    : [...common, { key: destination.view, label: destination.label }];
}

/**
 * The CRM's tab strip while a tab loads (owner 2026-10-16: tab switching
 * felt slow). The loading shape already carries the new address, so the
 * tab just chosen is underlined at once, in the same place and size as the
 * real strip; the real strip replaces it when the page arrives. A route of
 * its own (GateQ, company requests) names its tab; the CRM's own views
 * read it from the address.
 */
export function HubLoadingTabs({ view }: { readonly view?: HubView }) {
  const side = useOwnSide();
  const fromAddress = hubViewOf(useSearchParams().get("view") ?? undefined);
  const wanted = view ?? fromAddress;
  // GateQ is "applications" on a founder's strip, "gateq" on an investor's.
  const open: HubView =
    side === "COMPANY" && wanted === "gateq" ? "applications" : wanted;
  return (
    <LoadingTabStrip tabs={loadingTabsFor(side, open, hubTabs)} open={open} />
  );
}
