"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { cx } from "@capital-q/ui";
import { Bell, Check, Clock, ICON_SIZE, Upload, X } from "@capital-q/ui/icons";

import { PagedList } from "@/components/paged-list";
import { RecordAmountSheet } from "@/features/capital/commitment-sheet";
import { EntityAvatar } from "@/features/entity/entity-avatar";
import {
  createReminderAction,
  dismissReminderAction,
  markNoticesReadAction,
} from "@/features/schedule/schedule-actions";

import {
  CompletionRing,
  crmButton,
  CrmToastProvider,
  useCrmToast,
} from "./crm-kit";
import { CounterpartAvatar } from "./relationships-board";
import {
  laterNote,
  since,
  tomorrowMorning,
  type NeedsYouCard,
} from "./relationships-view";
import { useT } from "@/features/i18n/language";

/** Five cards answer "what needs me now"; "See all" pages the rest. */
export const NEEDS_YOU_SHOWN = 5;
/** Cards per page once the whole queue is open. */
export const NEEDS_YOU_PAGE = 10;

/** What was done today on this device, so the ring survives a reload. */
const DONE_KEY = "cq.crm.needs-you.done.v1";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function readDone(): readonly string[] {
  try {
    const raw = window.localStorage.getItem(DONE_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "day" in parsed &&
      "keys" in parsed &&
      parsed.day === today() &&
      Array.isArray(parsed.keys)
    ) {
      return parsed.keys.filter(
        (key): key is string => typeof key === "string",
      );
    }
    return [];
  } catch {
    return [];
  }
}

function writeDone(keys: readonly string[]): void {
  try {
    window.localStorage.setItem(
      DONE_KEY,
      JSON.stringify({ day: today(), keys: keys.slice(-100) }),
    );
  } catch {
    // A private window: the ring counts this visit only.
  }
}

/**
 * The CRM Overview's work queue (design 2026-10-20, "Morning brief"): what
 * needs the person now, one card per relationship and kind, before any
 * figure. The ring fills as cards are done today; the first card carries
 * the accent edge and the one primary button. Each card says who, why and
 * when, with "Later" (tomorrow morning, as a reminder) and the one action
 * that does it. Doing it opens where it is done and clears its notices; a
 * notice can also be dismissed. `unavailable`: the notices could not be
 * read, which is said, never shown as "nothing".
 */
export function NeedsYouQueue(props: {
  readonly cards: readonly NeedsYouCard[];
  readonly now: number;
  readonly unavailable?: boolean;
}) {
  return (
    <CrmToastProvider>
      <Queue {...props} />
    </CrmToastProvider>
  );
}

function Queue({
  cards,
  now,
  unavailable = false,
}: {
  readonly cards: readonly NeedsYouCard[];
  readonly now: number;
  readonly unavailable?: boolean;
}) {
  const t = useT();
  const toast = useCrmToast();
  const router = useRouter();
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());
  const [doneEarlier, setDoneEarlier] = useState<readonly string[]>([]);
  const [all, setAll] = useState(false);
  const [recording, setRecording] = useState<NeedsYouCard | null>(null);
  const [, startClearing] = useTransition();
  useEffect(() => {
    // Device-local progress, read after the server render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDoneEarlier(readDone());
  }, []);
  // A card's exit timer must not outlive the queue (navigating away mid-exit).
  const exits = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const pending = exits.current;
    return () => {
      for (const timer of pending) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  const left = cards.filter((card) => !gone.has(card.key));
  const present = new Set(cards.map((card) => card.key));
  const doneToday = new Set(
    [...doneEarlier, ...gone].filter(
      (key) => gone.has(key) || !present.has(key),
    ),
  ).size;
  const total = left.length + doneToday;

  /** The card leaves (to the side), then the list closes up. */
  const leave = (card: NeedsYouCard) => {
    setLeaving((current) => new Set([...current, card.key]));
    const timer = setTimeout(() => {
      exits.current.delete(timer);
      setGone((current) => new Set([...current, card.key]));
      writeDone([...readDone(), card.key]);
    }, 240);
    exits.current.add(timer);
  };

  const clear = (card: NeedsYouCard) => {
    // Optimistic: the card leaves at once; the server marks it after.
    leave(card);
    startClearing(async () => {
      if (card.noticeIds.length > 0) {
        await markNoticesReadAction([...card.noticeIds]);
      }
      if (card.reminderId !== null) {
        await dismissReminderAction(card.reminderId);
      }
    });
  };

  const later = (card: NeedsYouCard) => {
    leave(card);
    startClearing(async () => {
      const title =
        card.record !== undefined
          ? `Record what you invested in ${card.record.name}`
          : card.relationship === null
            ? card.title
            : `${card.relationship.counterpart.name}: ${card.title}`;
      const made = await createReminderAction({
        title: title.slice(0, 200),
        dueAt: tomorrowMorning(new Date()),
        note: laterNote(
          card.record !== undefined
            ? { label: "Record amount", href: null }
            : card.action,
        ),
        relationshipId: card.relationship?.relationshipId,
        byEmail: false,
        idempotencyKey: `later:${card.key.replace(/[^A-Za-z0-9:_-]/g, "-").slice(0, 120)}:${today()}`,
      });
      if (!made.ok) {
        // Nothing was moved: the card comes back and says why.
        setLeaving((current) => without(current, card.key));
        setGone((current) => without(current, card.key));
        toast(t(made.message));
        return;
      }
      toast(t("Moved to tomorrow morning"));
      if (card.noticeIds.length > 0) {
        await markNoticesReadAction([...card.noticeIds]);
      }
      if (card.reminderId !== null) {
        await dismissReminderAction(card.reminderId);
      }
    });
  };

  const card = (item: NeedsYouCard, index: number) => {
    const first = index === 0;
    const label =
      item.record !== undefined ? "Record amount" : item.action.label;
    const action =
      item.record !== undefined ? (
        <button
          type="button"
          onClick={() => setRecording(item)}
          className={crmButton(
            first ? "primary" : "secondary",
            "flex-1 sm:flex-none",
          )}
        >
          {t(label)}
        </button>
      ) : item.action.href === null ? (
        <button
          type="button"
          onClick={() => clear(item)}
          className={crmButton(
            first ? "primary" : "secondary",
            "flex-1 sm:flex-none",
          )}
        >
          {t(label)}
        </button>
      ) : (
        <Link
          href={item.action.href}
          onClick={(event) => {
            event.preventDefault();
            clear(item);
            router.push(item.action.href ?? "/relationships");
          }}
          className={crmButton(
            first ? "primary" : "secondary",
            "flex-1 sm:flex-none",
          )}
        >
          {label === "Upload & share" ? (
            <Upload size={ICON_SIZE.compact} aria-hidden="true" />
          ) : null}
          {t(label)}
        </Link>
      );
    return (
      <div
        className={cx(
          "grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3.5 gap-y-3 rounded-(--cq-radius-lg) border bg-(--cq-surface-raised) p-3.5 transition-[opacity,transform,border-color,box-shadow] duration-[240ms] ease-(--cq-ease) sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:gap-x-4 sm:px-[18px] sm:py-4",
          first
            ? "border-(--cq-accent)/60 shadow-[inset_4px_0_0_var(--cq-accent)]"
            : "border-(--cq-border-subtle)",
          leaving.has(item.key) && "cq-crm-leaving",
        )}
        data-needs-you-card
        data-first={first ? "true" : undefined}
      >
        {item.record !== undefined ? (
          <EntityAvatar
            kind="company"
            name={item.record.name}
            companyId={item.relationship?.counterpart.id}
            size={36}
            decorative
          />
        ) : item.relationship === null ? (
          <span
            aria-hidden="true"
            className="flex size-9 flex-none items-center justify-center rounded-(--cq-radius-md) bg-(--cq-surface-strong) text-(--cq-text-secondary)"
          >
            <Bell size={ICON_SIZE.compact} />
          </span>
        ) : (
          <CounterpartAvatar item={item.relationship} size={36} />
        )}
        <div className="min-w-0">
          <p className="text-base font-semibold text-(--cq-text-primary)">
            {item.record !== undefined
              ? t(`Record what you invested in ${item.record.name}`)
              : item.relationship === null
                ? t(item.title)
                : item.relationship.counterpart.name}
          </p>
          <p className="mt-0.5 text-sm text-(--cq-text-secondary)">
            {item.record !== undefined
              ? t(
                  `${item.record.name} is invested since ${shortDay(item.record.since)}. No amount is recorded, so your portfolio total is incomplete.`,
                )
              : item.relationship === null
                ? (item.detail ?? null)
                : t(item.title)}
            {item.count > 1 ? (
              <span className="cq-numeric text-(--cq-text-tertiary)">
                {" · "}
                {t(`${String(item.count)} updates`)}
              </span>
            ) : null}
          </p>
          <p className="mt-1.5 flex items-center gap-1.5 text-xs text-(--cq-text-tertiary)">
            <Clock size={14} aria-hidden="true" />
            <time dateTime={item.latestAt}>{t(since(item.latestAt, now))}</time>
          </p>
        </div>
        <div className="col-span-2 flex items-center gap-1.5 sm:col-span-1">
          <button
            type="button"
            onClick={() => later(item)}
            className={crmButton("quiet")}
            data-needs-you-later
          >
            {t("Later")}
          </button>
          {action}
          {item.step === true || item.record !== undefined ? null : (
            <button
              type="button"
              onClick={() => clear(item)}
              aria-label={t(`Dismiss ${item.title}`)}
              className="inline-flex size-11 flex-none items-center justify-center rounded-(--cq-radius-md) text-(--cq-text-tertiary) hover:bg-(--cq-surface-strong) hover:text-(--cq-text-primary) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)"
            >
              <X size={ICON_SIZE.compact} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    );
  };

  const heading = unavailable
    ? t("Needs you")
    : left.length === 0
      ? t("Nothing needs you right now")
      : left.length === 1
        ? t("1 thing needs you")
        : t(`${String(left.length)} things need you`);
  return (
    <section
      id="needs-you"
      aria-label={t("Needs you")}
      className="flex flex-col"
      data-needs-you
      data-qp-anchor="fdr.06.crm.needs-you"
    >
      <div className="mb-3 flex items-center gap-3.5">
        <CompletionRing done={doneToday} total={Math.max(total, 1)} />
        <div className="min-w-0 flex-1">
          <h2
            key={heading}
            className="cq-crm-swap text-xl font-semibold tracking-[-0.01em] text-(--cq-text-primary)"
          >
            {heading}
          </h2>
          <p className="text-xs text-(--cq-text-tertiary)">
            {doneToday > 0
              ? t(`${String(doneToday)} of ${String(total)} done today`)
              : t("Newest first. Each one is a single step.")}
          </p>
        </div>
        {left.length > NEEDS_YOU_SHOWN ? (
          <button
            type="button"
            onClick={() => setAll((open) => !open)}
            className={crmButton("quiet")}
            aria-expanded={all}
          >
            {all ? t("Show fewer") : t(`See all ${String(left.length)}`)}
          </button>
        ) : null}
      </div>
      {unavailable ? (
        <p
          className="rounded-(--cq-radius-lg) border border-dashed border-(--cq-border) bg-(--cq-surface-subtle) px-4 py-4 text-sm text-(--cq-text-secondary)"
          data-state="unavailable"
        >
          {t(
            "What needs you couldn't be read just now. Your relationships below are unchanged.",
          )}
        </p>
      ) : left.length === 0 ? (
        <div
          className="cq-crm-swap flex items-center gap-3.5 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) px-[18px] py-4"
          data-state="empty"
        >
          <span
            aria-hidden="true"
            className="cq-crm-tick-in inline-grid size-8 flex-none place-items-center rounded-full bg-(--cq-positive) text-(--cq-text-inverse)"
          >
            <Check size={16} />
          </span>
          <p className="text-sm text-(--cq-text-secondary)">
            {t(
              "Nothing needs you right now. New interest, messages and requests arrive here first.",
            )}
          </p>
        </div>
      ) : all ? (
        <PagedList
          items={left.map((item, index) => ({
            key: item.key,
            node: card(item, index),
          }))}
          pageSize={NEEDS_YOU_PAGE}
          noun="items"
          className="flex flex-col gap-2.5"
          footerClassName="pt-2"
        />
      ) : (
        <ul className="flex flex-col gap-2.5">
          {left.slice(0, NEEDS_YOU_SHOWN).map((item, index) => (
            <li key={item.key}>{card(item, index)}</li>
          ))}
        </ul>
      )}
      {recording?.record === undefined ? null : (
        <RecordAmountSheet
          open
          onOpenChange={(open) => {
            if (!open) setRecording(null);
          }}
          relationshipId={recording.record.relationshipId}
          name={recording.record.name}
          companyId={recording.relationship?.counterpart.id}
          since={recording.record.since}
          onRecorded={() => leave(recording)}
        />
      )}
    </section>
  );
}

function without(set: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(set);
  next.delete(key);
  return next;
}

const DAY = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
});

function shortDay(iso: string): string {
  const at = Date.parse(iso);
  return Number.isFinite(at) ? DAY.format(new Date(at)) : "";
}
