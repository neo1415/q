"use client";

import type { ReactNode } from "react";

import { PageContainer } from "@/components/app-shell/page-container";
import { useT } from "@/features/i18n/language";
import {
  LoadingTabStrip,
  loadingTabsFor,
  useOwnSide,
} from "@/features/relationships/hub-loading-tabs";

import { workTabs, type WorkView } from "./work-tabs";

const bar =
  "block animate-pulse bg-(--cq-surface-strong) motion-reduce:animate-none";

/** Work's tab strip while a tab loads: the tab just chosen underlined. */
export function WorkLoadingTabs({ view }: { readonly view: WorkView }) {
  const side = useOwnSide();
  return (
    <LoadingTabStrip tabs={loadingTabsFor(side, view, workTabs)} open={view} />
  );
}

/**
 * A Work tab while it loads (instant tabs 2026-10-18): Work's header line
 * and tabs where `WorkHeader` draws them, then the tab's own shape (rows
 * unless the page passes one). Moving between Work's tabs (each its own
 * route) keeps the header and strip in place instead of the app's frame.
 */
export function WorkLoading({
  view,
  label,
  width = "content",
  children,
}: {
  readonly view: WorkView;
  readonly label: string;
  readonly width?: "content" | "reading";
  readonly children?: ReactNode;
}) {
  const t = useT();
  return (
    <PageContainer width={width}>
      <div role="status" aria-busy="true" aria-label={t(label)}>
        <div className="flex flex-col gap-2 pb-6">
          {/* The h1's line box and the tab strip at their real heights. */}
          <span className="flex min-h-10 items-center">
            <span className={`${bar} h-8 w-28`} />
          </span>
          <WorkLoadingTabs view={view} />
        </div>
        {children ?? (
          <ul
            aria-hidden="true"
            data-loading-rows={view}
            className="flex flex-col divide-y divide-(--cq-border-subtle) border-y border-(--cq-border-subtle)"
          >
            {[0, 1, 2, 3].map((n) => (
              <li key={n} className="flex min-h-16 items-center gap-3 py-3">
                <span className="flex flex-1 flex-col gap-2">
                  <span className={`${bar} h-3.5 w-2/5`} />
                  <span className={`${bar} h-3 w-3/5`} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PageContainer>
  );
}
