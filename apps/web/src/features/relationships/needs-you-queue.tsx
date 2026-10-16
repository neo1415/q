"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { buttonClassName } from "@capital-q/ui/button";
import { Bell, ICON_SIZE, Upload, X } from "@capital-q/ui/icons";

import { PagedList } from "@/components/paged-list";
import { Panel } from "@/components/panel";

import {
  dismissReminderAction,
  markNoticesReadAction,
} from "@/features/schedule/schedule-actions";

import { CounterpartAvatar } from "./relationships-board";
import { since, type NeedsYouCard } from "./relationships-view";

/** Five rows answer "what needs me now"; "See all" pages the rest. */
export const NEEDS_YOU_SHOWN = 5;
/** Rows per page once the whole queue is open. */
export const NEEDS_YOU_PAGE = 10;

/**
 * The CRM Overview's work queue (research 2026-10-15 §3.3; redesign
 * 2026-10-16): what needs the person now, one row per relationship and
 * kind, newest first, before any figure. It is the page's lead panel, the
 * one marked with the accent rule. Each row says who, what and when, with
 * the one action that does it; the first row's action is primary. A row's
 * action opens where it is done and clears the notice; the cross clears it
 * without opening. "See all" opens the queue a page at a time, by cursor.
 * `unavailable`: the notices could not be read, which is said, never
 * shown as "nothing".
 */
export function NeedsYouQueue({
  cards,
  now,
  unavailable = false,
}: {
  readonly cards: readonly NeedsYouCard[];
  readonly now: number;
  readonly unavailable?: boolean;
}) {
  const router = useRouter();
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const [all, setAll] = useState(false);
  const [, startClearing] = useTransition();
  const left = cards.filter((card) => !gone.has(card.key));

  const clear = (card: NeedsYouCard) => {
    // Optimistic: the row leaves at once; the server marks it after.
    setGone((current) => new Set([...current, card.key]));
    startClearing(async () => {
      if (card.noticeIds.length > 0) {
        await markNoticesReadAction([...card.noticeIds]);
      }
      if (card.reminderId !== null) {
        await dismissReminderAction(card.reminderId);
      }
    });
  };

  const row = (card: NeedsYouCard, index: number) => (
    <div
      className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:flex-nowrap sm:px-5"
      data-needs-you-card
    >
      <div className="flex min-w-0 flex-1 basis-56 items-center gap-3">
        {card.relationship === null ? (
          <span
            aria-hidden="true"
            className="flex size-8 flex-none items-center justify-center bg-(--cq-surface-subtle) text-(--cq-text-tertiary)"
          >
            <Bell size={ICON_SIZE.compact} />
          </span>
        ) : (
          <CounterpartAvatar item={card.relationship} size={32} />
        )}
        {/* Who, then what: two short lines that wrap on a phone instead of
            one line cut mid-word. When sits apart, right-aligned. */}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="cq-body-sm truncate font-semibold text-(--cq-text-primary)">
            {card.relationship === null
              ? card.title
              : card.relationship.counterpart.name}
          </p>
          <p className="cq-body-sm line-clamp-2 text-(--cq-text-secondary)">
            {card.relationship === null ? null : card.title}
            {card.count > 1 ? (
              <span className="cq-numeric text-(--cq-text-tertiary)">
                {card.relationship === null ? "" : " · "}
                {`${String(card.count)} updates`}
              </span>
            ) : null}
          </p>
        </div>
      </div>
      <div className="ml-11 flex flex-none items-center gap-1 sm:ml-0">
        <span className="cq-caption cq-numeric mr-2 w-10 text-right text-(--cq-text-tertiary)">
          <time dateTime={card.latestAt}>{since(card.latestAt, now)}</time>
        </span>
        {card.action.href === null ? (
          <button
            type="button"
            onClick={() => clear(card)}
            className={buttonClassName("secondary", "compact")}
          >
            {card.action.label}
          </button>
        ) : (
          <Link
            href={card.action.href}
            onClick={(event) => {
              event.preventDefault();
              clear(card);
              router.push(card.action.href ?? "/relationships");
            }}
            className={buttonClassName(
              index === 0 ? "primary" : "secondary",
              "compact",
            )}
          >
            {card.action.label === "Upload & share" ? (
              <Upload size={ICON_SIZE.compact} aria-hidden="true" />
            ) : null}
            {card.action.label}
          </Link>
        )}
        {card.step === true ? (
          // A step leaves when it is done, not when it is dismissed; the
          // empty slot keeps the action column aligned.
          <span aria-hidden="true" className="size-11 flex-none" />
        ) : (
          <button
            type="button"
            onClick={() => clear(card)}
            aria-label={`Dismiss ${card.title}`}
            className="inline-flex size-11 flex-none items-center justify-center text-(--cq-text-tertiary) hover:bg-(--cq-surface-subtle) hover:text-(--cq-text-primary) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)"
          >
            <X size={ICON_SIZE.compact} aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );

  const list = "flex flex-col divide-y divide-(--cq-border-subtle)";
  return (
    <Panel
      id="needs-you"
      title="Needs you"
      count={left.length > 0 ? left.length : undefined}
      lead
      flush
      data-needs-you
      action={
        left.length > NEEDS_YOU_SHOWN ? (
          <button
            type="button"
            onClick={() => setAll((open) => !open)}
            className="cq-body-sm inline-flex min-h-11 items-center px-1 font-medium text-(--cq-accent) underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)"
            aria-expanded={all}
          >
            {all ? "Show fewer" : `See all ${String(left.length)}`}
          </button>
        ) : null
      }
    >
      {unavailable ? (
        <p
          className="cq-body-sm px-4 py-4 text-(--cq-text-secondary) sm:px-5"
          data-state="unavailable"
        >
          What needs you couldn&apos;t be read just now. Your relationships
          below are unchanged.
        </p>
      ) : left.length === 0 ? (
        <p
          className="cq-body-sm px-4 py-4 text-(--cq-text-secondary) sm:px-5"
          data-state="empty"
        >
          Nothing needs you right now. New interest, messages and requests
          arrive here first.
        </p>
      ) : all ? (
        <PagedList
          items={left.map((card, index) => ({
            key: card.key,
            node: row(card, index),
          }))}
          pageSize={NEEDS_YOU_PAGE}
          noun="items"
          className={list}
          footerClassName="border-t border-(--cq-border-subtle) px-4 py-2 sm:px-5"
        />
      ) : (
        <ul className={list}>
          {left.slice(0, NEEDS_YOU_SHOWN).map((card, index) => (
            <li key={card.key}>{row(card, index)}</li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
