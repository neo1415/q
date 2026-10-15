"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { buttonClassName } from "@capital-q/ui/button";
import { ICON_SIZE, Upload, X } from "@capital-q/ui/icons";

import {
  dismissReminderAction,
  markNoticesReadAction,
} from "@/features/schedule/schedule-actions";

import { CounterpartAvatar } from "./relationships-board";
import { since, type NeedsYouCard } from "./relationships-view";

/** Five rows answer "what needs me now"; the rest open on request. */
export const NEEDS_YOU_SHOWN = 5;

/**
 * The CRM Overview's work queue (research 2026-10-15 §3.3): what needs the
 * person now, one row per relationship and kind, newest first, before any
 * figure. Rows on one surface with hairline dividers, not a card each. A
 * row's action opens where it is done and clears the notice; the cross
 * clears it without opening. `unavailable`: the notices could not be read,
 * which is said, never shown as "nothing".
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
  const shown = all ? left : left.slice(0, NEEDS_YOU_SHOWN);

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

  return (
    <section
      aria-labelledby="needs-you"
      className="flex flex-col gap-2"
      data-needs-you
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="needs-you" className="cq-title-sm text-(--cq-text-primary)">
          Needs you
          {left.length > 0 ? (
            <span className="cq-numeric ml-2 font-normal text-(--cq-text-tertiary)">
              {left.length}
            </span>
          ) : null}
        </h2>
        {left.length > NEEDS_YOU_SHOWN ? (
          <button
            type="button"
            onClick={() => setAll((open) => !open)}
            className="cq-body-sm inline-flex min-h-11 items-center text-(--cq-text-secondary) hover:text-(--cq-text-primary) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)"
            aria-expanded={all}
          >
            {all ? "Show fewer" : `See all ${String(left.length)}`}
          </button>
        ) : null}
      </div>
      {unavailable ? (
        <p
          className="cq-body-sm border-y border-(--cq-border-subtle) py-3 text-(--cq-text-secondary)"
          data-state="unavailable"
        >
          What needs you couldn&apos;t be read just now. Your relationships
          below are unchanged.
        </p>
      ) : left.length === 0 ? (
        <p
          className="cq-body-sm border-y border-(--cq-border-subtle) py-3 text-(--cq-text-secondary)"
          data-state="empty"
        >
          Nothing needs you right now.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-(--cq-border-subtle) border-y border-(--cq-border-subtle)">
          {shown.map((card, index) => (
            <li
              key={card.key}
              className="flex min-w-0 items-center gap-3 py-3"
              data-needs-you-card
            >
              {card.relationship === null ? null : (
                <CounterpartAvatar item={card.relationship} size={32} />
              )}
              {/* Who, then what and when: two short lines that wrap on a
                  phone instead of one line cut mid-word. */}
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                {card.relationship === null ? null : (
                  <p className="cq-body-sm truncate font-semibold text-(--cq-text-primary)">
                    {card.relationship.counterpart.name}
                  </p>
                )}
                <p className="cq-body-sm line-clamp-2 text-(--cq-text-secondary)">
                  <span
                    className={
                      card.relationship === null
                        ? "text-(--cq-text-primary)"
                        : undefined
                    }
                  >
                    {card.title}
                  </span>
                  <span className="cq-caption cq-numeric text-(--cq-text-tertiary)">
                    {" · "}
                    {card.count > 1
                      ? `${String(card.count)} updates · ${since(card.latestAt, now)}`
                      : since(card.latestAt, now)}
                  </span>
                </p>
              </div>
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
              <button
                type="button"
                onClick={() => clear(card)}
                aria-label={`Dismiss ${card.title}`}
                className="inline-flex size-11 flex-none items-center justify-center text-(--cq-text-tertiary) hover:text-(--cq-text-primary) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)"
              >
                <X size={ICON_SIZE.compact} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
