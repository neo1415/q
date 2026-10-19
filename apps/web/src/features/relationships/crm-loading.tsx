"use client";

import { Suspense } from "react";

import { PageContainer } from "@/components/app-shell/page-container";

import { PageLoading } from "@/components/app-shell/page-loading";

import { HubLoadingTabs, useOwnSide } from "./hub-loading-tabs";
import type { HubSide, HubView } from "./hub-view";
import { useT } from "@/features/i18n/language";

/**
 * Loading shapes for the CRM (research 2026-10-15 §3.4): each block at its
 * final size, so nothing moves when the page arrives (CLS 0). No spinner,
 * no text that changes; the pulse stops under reduced motion.
 */
const bar =
  "block animate-pulse bg-(--cq-surface-strong) motion-reduce:animate-none";

function Rows({
  count,
  label,
  ruled = true,
}: {
  readonly count: number;
  readonly label: string;
  /** Hairlines above and below; a panel draws its own edges. */
  readonly ruled?: boolean;
}) {
  return (
    <ul
      className={`flex flex-col divide-y divide-(--cq-border-subtle) ${ruled ? "border-y border-(--cq-border-subtle)" : ""}`}
      aria-hidden="true"
      data-loading-rows={label}
    >
      {Array.from({ length: count }, (_, n) => (
        <li key={n} className="flex min-h-16 items-center gap-3 py-3">
          <span className={`${bar} size-8 flex-none rounded-full`} />
          <span className="flex flex-1 flex-col gap-2">
            <span className={`${bar} h-3.5 w-2/5`} />
            <span className={`${bar} h-3 w-3/5`} />
          </span>
          <span className={`${bar} h-8 w-20 flex-none max-sm:hidden`} />
        </li>
      ))}
    </ul>
  );
}

/** A panel's shape: its header bar, then rows (the Overview's grammar). */
function PanelShape({
  rows,
  label,
  lead = false,
}: {
  readonly rows: number;
  readonly label: string;
  readonly lead?: boolean;
}) {
  const t = useT();

  return (
    <div
      className={`border border-(--cq-border-subtle) bg-(--cq-surface) ${lead ? "border-s-[3px] border-s-(--cq-border-strong)" : ""}`}
    >
      <span className="flex min-h-[3.25rem] items-center border-b border-(--cq-border-subtle) px-4 sm:px-5">
        <span className={`${bar} h-4 w-28`} />
      </span>
      <div className="px-4 sm:px-5">
        <Rows count={rows} label={t(label)} ruled={false} />
      </div>
    </div>
  );
}

/**
 * One Overview panel while its own read streams in (instant tabs
 * 2026-10-18): the header and tabs are already on screen above it.
 */
export function HubPanelLoading({
  rows,
  label,
  lead = false,
}: {
  readonly rows: number;
  readonly label: string;
  readonly lead?: boolean;
}) {
  return <PanelShape rows={rows} label={label} lead={lead} />;
}

/** The Pipeline list's rows while they stream in under the real header. */
export function HubListLoading() {
  return <Rows count={6} label="list" />;
}

/**
 * The CRM header and tabs, then the open tab's shape. The tab just chosen
 * is underlined at once (HubLoadingTabs reads the new address), so a
 * switch answers the click before the server does.
 */
export function HubLoading({ view }: { readonly view?: HubView } = {}) {
  const t = useT();

  return (
    <PageContainer className="flex flex-col gap-6 sm:gap-8">
      <div
        className="flex flex-col gap-2"
        role="status"
        aria-busy="true"
        aria-label={t("Loading your CRM")}
      >
        {/* The h1's line box and the tab strip at their real heights. */}
        <span className="flex min-h-8 items-center">
          <span className={`${bar} h-7 w-56`} />
        </span>
        <Suspense
          fallback={
            <span className="flex min-h-11 border-b border-(--cq-border-subtle)" />
          }
        >
          <HubLoadingTabs {...(view === undefined ? {} : { view })} />
        </Suspense>
      </div>
      <PanelShape rows={3} label="queue" lead />
      <PanelShape rows={4} label="list" />
    </PageContainer>
  );
}

/**
 * A CRM tab that is a page of its own (GateQ, company requests): the CRM's
 * strip first, its tab underlined, then that page's title line and rows,
 * as the page draws them (instant tabs 2026-10-18).
 */
export function HubRouteLoading({
  view,
  label,
  only,
}: {
  readonly view: HubView;
  readonly label: string;
  /** The page is this CRM tab for this side only (a founder's /investors is a directory). */
  readonly only?: HubSide;
}) {
  const t = useT();
  const side = useOwnSide();
  if (only !== undefined && side !== only) return <PageLoading />;
  return (
    <PageContainer>
      <div
        className="flex flex-col gap-4"
        role="status"
        aria-busy="true"
        aria-label={t(label)}
      >
        <Suspense
          fallback={
            <span className="flex min-h-11 border-b border-(--cq-border-subtle)" />
          }
        >
          <HubLoadingTabs view={view} />
        </Suspense>
        <span className="flex min-h-9 items-center">
          <span className={`${bar} h-7 w-40`} />
        </span>
        <Rows count={4} label={view} />
      </div>
    </PageContainer>
  );
}

/** A relationship record: back link, name and state line, tabs, two columns. */
export function RecordLoading() {
  const t = useT();

  return (
    <PageContainer>
      <div
        className="flex flex-col gap-6"
        role="status"
        aria-busy="true"
        aria-label={t("Loading the relationship")}
      >
        <span className="flex min-h-11 items-center">
          <span className={`${bar} h-4 w-36`} />
        </span>
        <div className="flex items-center gap-4">
          <span className={`${bar} size-14 flex-none`} />
          <span className="flex flex-1 flex-col gap-2.5">
            <span className={`${bar} h-7 w-1/2`} />
            <span className={`${bar} h-3.5 w-1/3`} />
          </span>
        </div>
        <span className={`${bar} h-4 w-2/3 max-w-md`} />
        <span className="flex min-h-11 items-end gap-1 border-b border-(--cq-border-subtle)">
          <span className={`${bar} mb-3 ms-3 h-3.5 w-16`} />
          <span className={`${bar} mb-3 ms-6 h-3.5 w-16`} />
        </span>
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="flex flex-col gap-3 border-t border-(--cq-border-subtle) pt-5">
            <span className={`${bar} h-5 w-32`} />
            <Rows count={3} label="record" />
          </div>
          <div className="flex flex-col gap-3 border-t border-(--cq-border-subtle) pt-5 max-lg:order-first">
            <span className={`${bar} h-5 w-16`} />
            <span className={`${bar} h-11 w-full`} />
          </div>
        </div>
      </div>
    </PageContainer>
  );
}
