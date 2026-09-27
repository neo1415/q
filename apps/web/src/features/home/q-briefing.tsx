"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { ChevronRight, ICON_SIZE, ICON_STROKE } from "@capital-q/ui/icons";

import type { Briefing, BriefingItem } from "./briefing";
import { decideBriefing } from "./briefing-gate";
import { remindSetupLaterAction } from "./setup-nudge-actions";

/**
 * Q's briefing on arrival (R35): one short line and a few cards, each a
 * fact from an authorised read that opens its real page.
 *
 * The briefing arrives after the page: the server starts building it and
 * streams the answer, so Home and Q are on screen at once and the
 * briefing follows. It is not inside a Suspense boundary (a streamed
 * boundary is revealed on an animation frame, which never fires in a
 * hidden tab); the promise is simply awaited here. Nothing to say, a read
 * that failed, or a briefing already given today: nothing is shown.
 */

const CARD_CLASS = [
  "group flex min-h-11 w-full items-center gap-3 rounded-md border border-(--cq-border-subtle) bg-(--cq-surface) px-3.5 py-2.5 text-left",
  "transition-colors duration-(--cq-motion-fast) hover:border-(--cq-border-strong) hover:bg-(--cq-surface-subtle)",
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--cq-focus-ring)",
].join(" ");

const QUIET_CONTROL_CLASS = [
  "inline-flex min-h-11 items-center rounded-md px-3 cq-body-sm",
  "transition-colors duration-(--cq-motion-fast)",
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--cq-focus-ring)",
].join(" ");

/**
 * The setup reminder (founder directive 2026-09-27): one quiet card, the
 * progress and the time left, Continue and Later. Later puts reminders off
 * for a few days and the card goes at once; nothing waits on the server.
 */
function SetupNudgeCard({
  item,
  onLater,
}: {
  readonly item: BriefingItem;
  readonly onLater: () => void;
}) {
  return (
    <div
      className="flex min-h-11 w-full flex-col gap-2 rounded-md border border-(--cq-border-subtle) bg-(--cq-surface) px-3.5 py-2.5"
      data-briefing-card={item.id}
    >
      <span className="flex min-w-0 flex-col">
        <span className="cq-body-sm font-medium text-(--cq-text-primary)">
          {item.title}
        </span>
        <span className="cq-caption text-(--cq-text-secondary)">
          {item.description}
        </span>
      </span>
      <span className="-mx-3 -mb-1.5 flex items-center gap-1">
        <Link
          href={item.href}
          className={`${QUIET_CONTROL_CLASS} font-medium text-(--cq-text-primary) hover:bg-(--cq-surface-subtle)`}
        >
          Continue
        </Link>
        <button
          type="button"
          onClick={onLater}
          className={`${QUIET_CONTROL_CLASS} text-(--cq-text-secondary) hover:bg-(--cq-surface-subtle) hover:text-(--cq-text-primary)`}
          data-setup-nudge-later
        >
          Later
        </button>
      </span>
    </div>
  );
}

export function QBriefing({
  briefing,
}: {
  readonly briefing: Promise<Briefing | null>;
}) {
  const [shown, setShown] = useState<Briefing | null>(null);
  const [putOff, setPutOff] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    let current = true;
    briefing.then(
      (value) => {
        if (current) setShown(decideBriefing(value));
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [briefing]);

  if (shown === null) return null;
  const items = shown.items.filter((item) => !putOff.has(item.id));
  if (items.length === 0) return null;
  const later = (id: string) => {
    setPutOff((before) => new Set([...before, id]));
    void remindSetupLaterAction();
  };
  return (
    <section
      aria-labelledby="q-briefing-line"
      className="flex w-full flex-col gap-2"
      data-q-briefing
    >
      <p id="q-briefing-line" className="cq-body text-(--cq-text-primary)">
        {shown.line}
      </p>
      <ul className="grid w-full gap-2 sm:grid-cols-2">
        {items.map((item) => (
          <li key={item.id} className="flex">
            {item.later === true ? (
              <SetupNudgeCard
                item={item}
                onLater={() => {
                  later(item.id);
                }}
              />
            ) : (
              <Link
                href={item.href}
                className={CARD_CLASS}
                data-briefing-card={item.id}
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="cq-body-sm font-medium text-(--cq-text-primary)">
                    {item.title}
                  </span>
                  <span className="cq-caption text-(--cq-text-secondary)">
                    {item.description}
                  </span>
                </span>
                <ChevronRight
                  aria-hidden="true"
                  size={ICON_SIZE.compact}
                  strokeWidth={ICON_STROKE}
                  className="shrink-0 text-(--cq-text-tertiary) transition-colors duration-(--cq-motion-fast) group-hover:text-(--cq-text-secondary)"
                />
              </Link>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
