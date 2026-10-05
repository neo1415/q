"use client";

import Link from "next/link";
import { useState } from "react";

import type { FitComparisonDto, QViewDto } from "@capital-q/contracts";
import { Button, buttonClassName } from "@capital-q/ui/button";
import { ICON_SIZE, X } from "@capital-q/ui/icons";
import { EmptyState, ErrorState, Skeleton } from "@capital-q/ui/states";

import {
  comparisonTitle,
  FitComparisonView,
  WhyTheseSheet,
} from "./fit-comparison";
import { QViewMark, type QViewPort } from "./q-view-note";

/**
 * "Q, give me the top three" as a page (brief B2; match.html "top3"):
 * the investor's own candidates ranked by fit, side by side. The same
 * comparison is what Q's `fit_top_candidates` tool returns for the Q
 * page's answer canvas.
 */

export type FitTopState =
  | { readonly kind: "LOADING" }
  | { readonly kind: "ERROR" }
  /** No active mandate: there is nothing to fit against yet. */
  | { readonly kind: "NO_MANDATE" }
  | { readonly kind: "READY"; readonly comparison: FitComparisonDto };

const timeFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

export function FitTopView({
  state,
  closeHref = "/investors",
  qViews,
  qViewPort,
  retryHref = "/investors/top",
  defaultWhyOpen = false,
}: {
  readonly defaultWhyOpen?: boolean | undefined;
  readonly state: FitTopState;
  readonly closeHref?: string | undefined;
  readonly qViews?: ReadonlyMap<string, QViewDto | null> | undefined;
  readonly qViewPort?: QViewPort | undefined;
  readonly retryHref?: string | undefined;
}) {
  const [why, setWhy] = useState(defaultWhyOpen);
  const comparison = state.kind === "READY" ? state.comparison : null;
  const n = comparison?.entries.length ?? 3;
  const considered = comparison?.considered;
  return (
    <div
      className="flex max-w-[1180px] flex-col gap-5"
      data-fit-top={state.kind}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-3">
          <span className="hidden lg:inline-flex">
            <QViewMark size={32} />
          </span>
          <div>
            <h1 className="cq-title-lg text-(--cq-text-primary)">
              {comparisonTitle(n === 0 ? 3 : n)}
            </h1>
            <p className="cq-body-sm text-(--cq-text-secondary)">
              {considered === undefined
                ? "Ranked by fit with your mandate."
                : `Ranked by fit with your mandate, from ${String(considered)} ${considered === 1 ? "company" : "companies"} of yours.`}
            </p>
          </div>
        </div>
        <span className="flex gap-2">
          {comparison === null ? null : (
            <Button variant="quiet" size="compact" onClick={() => setWhy(true)}>
              Why {n === 3 ? "these three" : "these"}?
            </Button>
          )}
          <Link
            href={closeHref}
            aria-label="Close"
            className={buttonClassName("quiet", "compact")}
          >
            <X size={ICON_SIZE.prominent} aria-hidden="true" />
          </Link>
        </span>
      </div>

      {state.kind === "LOADING" ? (
        <>
          <div
            className="flex items-center gap-3 rounded-[14px] bg-(--cq-surface-subtle) p-4"
            role="status"
          >
            <QViewMark size={24} />
            <span className="cq-body-sm">
              Ranking your companies against your mandate…
            </span>
          </div>
          <Skeleton lines={8} />
        </>
      ) : state.kind === "ERROR" ? (
        <ErrorState
          title="The comparison didn't load"
          description="The connection dropped before it finished. Nothing you did was lost."
          action={
            <Link href={retryHref} className={buttonClassName("secondary")}>
              Try again
            </Link>
          }
        />
      ) : state.kind === "NO_MANDATE" ? (
        <EmptyState
          title="Set your mandate to see fit"
          description="Q ranks companies against what you tell it: stage, sectors, countries and cheque size. It takes about two minutes, and you can skip anything."
          action={
            <Link href="/profile" className={buttonClassName("primary")}>
              Set your mandate
            </Link>
          }
        />
      ) : state.comparison.entries.length === 0 ? (
        <EmptyState
          title="No companies fit your mandate yet"
          description={`None of the ${String(state.comparison.considered)} companies of yours can be ranked yet: they sit outside your rules or have shared too little. Widen one rule, or look in Discover.`}
          action={
            <Link href="/discover" className={buttonClassName("primary")}>
              Open Discover
            </Link>
          }
        />
      ) : (
        <>
          <FitComparisonView
            comparison={state.comparison}
            qViews={qViews}
            qViewPort={qViewPort}
          />
          <p className="cq-caption text-(--cq-text-tertiary)">
            Q picks by fit only, then explains. Fit rules version{" "}
            {state.comparison.configLabel} · updated{" "}
            {timeFormat.format(new Date(state.comparison.computedAt))}.
          </p>
          <WhyTheseSheet
            comparison={state.comparison}
            open={why}
            onOpenChange={setWhy}
          />
        </>
      )}
    </div>
  );
}
