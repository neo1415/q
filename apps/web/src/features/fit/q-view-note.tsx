"use client";

import { useEffect, useState } from "react";

import { Q_VIEW_VERDICT_LABELS, type QViewDto } from "@capital-q/contracts";
import { cx } from "@capital-q/ui";

import { QNavIcon } from "@/components/app-shell/q-nav-icon";

import { fitQViewAction } from "./fit-actions";

/**
 * Q's view (ADR 0052 §7): a labelled Q inference beside the fit. It never
 * changes the fit, the band or any order, and it is asked for after the
 * card has rendered: the card is complete without it, and an unavailable
 * view simply shows nothing.
 */

export type QViewPort = (companyId: string) => Promise<QViewDto | null>;

export function QViewMark({ size = 18 }: { readonly size?: number }) {
  return (
    <QNavIcon
      size={size}
      strokeWidth={2}
      aria-hidden
      className="shrink-0 text-(--cq-q-light)"
    />
  );
}

export function QViewNote({
  view,
  className,
}: {
  readonly view: QViewDto | null;
  readonly className?: string | undefined;
}) {
  if (view === null || view.status !== "READY") return null;
  return (
    <div
      className={cx(
        "relative flex items-start gap-2.5 rounded-xl bg-(--cq-surface-subtle) px-3 py-2.5 text-sm",
        className,
      )}
      data-q-view={view.verdict}
    >
      <span className="mt-px">
        <QViewMark />
      </span>
      <p className="min-w-0">
        <b className="font-semibold text-(--cq-text-primary)">
          Q&apos;s view: {Q_VIEW_VERDICT_LABELS[view.verdict]}.
        </b>{" "}
        <span className="text-(--cq-text-secondary)">
          {view.summary}
          {view.mainRisk === null ? "" : ` Main risk: ${view.mainRisk}`}
        </span>
      </p>
    </div>
  );
}

/** Asks for Q's view once, after mount; renders nothing until it is ready. */
export function useQView(
  companyId: string,
  initial: QViewDto | null | undefined,
  port: QViewPort = fitQViewAction,
): QViewDto | null {
  const [view, setView] = useState<QViewDto | null>(initial ?? null);
  useEffect(() => {
    if (initial !== undefined) return;
    let live = true;
    port(companyId)
      .then((value) => {
        if (live) setView(value);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [companyId, initial, port]);
  return view;
}

/**
 * Q's views for a fixed list of companies, asked once each after mount.
 * `initial` (fixtures, a cache) skips the reads entirely.
 */
export function useQViews(
  companyIds: readonly string[],
  initial: ReadonlyMap<string, QViewDto | null> | undefined,
  port: QViewPort = fitQViewAction,
): ReadonlyMap<string, QViewDto | null> {
  const [views, setViews] = useState<ReadonlyMap<string, QViewDto | null>>(
    initial ?? new Map(),
  );
  const key = companyIds.join(",");
  useEffect(() => {
    if (initial !== undefined) return;
    let live = true;
    for (const id of key.split(",").filter((s) => s.length > 0)) {
      port(id)
        .then((value) => {
          if (live) setViews((prev) => new Map(prev).set(id, value));
        })
        .catch(() => undefined);
    }
    return () => {
      live = false;
    };
  }, [key, initial, port]);
  return views;
}

export function LazyQViewNote({
  companyId,
  initial,
  port,
  className,
}: {
  readonly companyId: string;
  /** A view already in hand (fixtures, a cache); undefined asks the Q API. */
  readonly initial?: QViewDto | null | undefined;
  readonly port?: QViewPort | undefined;
  readonly className?: string | undefined;
}) {
  const view = useQView(companyId, initial, port);
  return <QViewNote view={view} className={className} />;
}
