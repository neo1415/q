"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@capital-q/ui/button";

import { useGlobalQ } from "@/components/app-shell/global-q";
import { useT } from "@/features/i18n/language";

import {
  arrivalNews,
  browserArrivalStore,
  type ArrivalFact,
  type ArrivalNews,
} from "./arrival-news";

/**
 * W5.2: a page's material facts, compared on arrival (arrival-news.ts).
 * Rendered by the page with what it already holds; it shows nothing
 * itself. The one line, if any, is said by `QArrivalNews` in the shell.
 */
export function ArrivalFacts({
  page,
  facts,
}: {
  /** The page's own key: its kind and the record it shows. */
  readonly page: string;
  readonly facts: readonly ArrivalFact[];
}) {
  const latest = useRef(facts);
  // Runs first in each commit, so the arrival below reads this render's.
  useEffect(() => {
    latest.current = facts;
  });
  // On arrival only: once per page shown (a refresh of the same page is
  // not an arrival).
  useEffect(() => {
    const news = arrivalNews(page, latest.current, {
      store: browserArrivalStore(),
      now: Date.now(),
    });
    if (news !== null) publish(news);
  }, [page]);
  return null;
}

const listeners = new Set<(news: ArrivalNews | null) => void>();
let current: ArrivalNews | null = null;
function publish(news: ArrivalNews | null): void {
  current = news;
  for (const listener of listeners) listener(news);
}

/** How long the line stays unless the person answers it. */
const LINE_MS = 15_000;

/** The shell's one place for Q's arrival line (mounted once). */
export function QArrivalNews() {
  const t = useT();
  const { askNow } = useGlobalQ();
  const [news, setNews] = useState<ArrivalNews | null>(current);
  useEffect(() => {
    listeners.add(setNews);
    return () => {
      listeners.delete(setNews);
    };
  }, []);
  useEffect(() => {
    if (news === null) return;
    const timer = setTimeout(() => publish(null), LINE_MS);
    return () => clearTimeout(timer);
  }, [news]);
  if (news === null) return null;
  const words =
    news.subject === null ? t(news.line) : `${news.subject} ${t(news.line)}`;
  return (
    <div
      role="status"
      data-q-arrival-news={news.key}
      className="fixed inset-x-4 top-20 z-(--cq-z-toast) mx-auto flex w-fit max-w-[min(32rem,calc(100vw-2rem))] flex-wrap items-center gap-3 rounded-md border border-(--cq-border-subtle) bg-(--cq-surface-raised) px-4 py-2 shadow-(--cq-shadow-overlay)"
    >
      <p className="m-0 min-w-0 flex-1 cq-body-sm text-(--cq-text-primary)">
        {words}
        {news.more > 0 ? ` ${t("There's more new here too.")}` : null}
      </p>
      <div className="flex gap-2">
        <Button
          variant="quiet"
          className="min-h-11"
          onClick={() => publish(null)}
        >
          {t("Dismiss")}
        </Button>
        {news.ask === null ? null : (
          <Button
            className="min-h-11"
            onClick={() => {
              const question = t(news.ask ?? "");
              publish(null);
              askNow(
                news.subject === null
                  ? question
                  : `${question} (${news.subject})`,
              );
            }}
            data-q-arrival-ask
          >
            {t("Ask Q")}
          </Button>
        )}
      </div>
    </div>
  );
}
