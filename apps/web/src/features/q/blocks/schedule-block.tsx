"use client";

import Link from "next/link";

import type { QScheduleBlock } from "@capital-q/contracts";
import { buttonClassName } from "@capital-q/ui/button";

import { useT } from "@/features/i18n/language";

/**
 * Their day as Q read it (live 2026-10-28: "what's on my schedule today?"
 * was words alone): calls with their prep brief when it is ready, open
 * reminders, and what waits for their approval. Times are shown in the
 * zone the block names; with none known they are UTC and the card says
 * so, as the words do. Nothing is decided here: the prep brief and the
 * approvals open where they are acted on.
 */

export function scheduleTime(iso: string, timeZone: string | null): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: timeZone ?? "UTC",
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(at);
  } catch {
    return iso;
  }
}

/** Where a call is prepared and held: the relationships hub. */
const CALLS_HREF = "/relationships";
const APPROVALS_HREF = "/work";

export function ScheduleBody({ block }: { readonly block: QScheduleBlock }) {
  const t = useT();
  const empty =
    block.calls.length === 0 &&
    block.reminders.length === 0 &&
    block.approvals.length === 0;
  return (
    <div
      className="flex flex-col gap-3"
      data-q-schedule={block.span}
      data-q-schedule-zone={block.timeZone ?? "UTC"}
    >
      {empty ? (
        <p className="cq-body-sm m-0 text-(--cq-text-secondary)">
          {block.span === "TODAY"
            ? t("Nothing booked today, and nothing waits for you.")
            : t(
                "Nothing booked in the next seven days, and nothing waits for you.",
              )}
        </p>
      ) : null}
      {block.calls.length === 0 ? null : (
        <section className="flex flex-col gap-1.5" data-q-schedule-calls>
          <h4 className="cq-caption m-0 text-(--cq-text-tertiary)">
            {t("Calls")}
          </h4>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {block.calls.map((call) => (
              <li
                key={call.meetingId}
                className="flex min-h-11 flex-wrap items-center gap-2 rounded-(--cq-radius-md) border border-(--cq-border-subtle) bg-(--cq-surface) px-3 py-1.5"
                data-q-schedule-call={call.meetingId}
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="cq-body-sm text-(--cq-text-primary)">
                    {scheduleTime(call.startsAt, block.timeZone)} ·{" "}
                    {call.purpose}
                  </span>
                  <span className="cq-caption text-(--cq-text-secondary)">
                    {call.with.length === 0
                      ? call.organisedByYou
                        ? t("You organised it.")
                        : t("Booked by someone else.")
                      : `${t("With")} ${call.with.join(", ")}`}
                  </span>
                </span>
                {call.briefReady ? (
                  <Link
                    href={CALLS_HREF}
                    className={buttonClassName("secondary", "compact")}
                    data-q-schedule-brief={call.meetingId}
                  >
                    {t("Open the prep brief")}
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      )}
      {block.reminders.length === 0 ? null : (
        <section className="flex flex-col gap-1.5" data-q-schedule-reminders>
          <h4 className="cq-caption m-0 text-(--cq-text-tertiary)">
            {t("Reminders")}
          </h4>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {block.reminders.map((reminder) => (
              <li
                key={reminder.reminderId}
                className="cq-body-sm text-(--cq-text-primary)"
                data-q-schedule-reminder={reminder.reminderId}
              >
                {scheduleTime(reminder.dueAt, block.timeZone)} ·{" "}
                {reminder.title}
              </li>
            ))}
          </ul>
        </section>
      )}
      {block.approvals.length === 0 ? null : (
        <section className="flex flex-col gap-1.5" data-q-schedule-approvals>
          <h4 className="cq-caption m-0 text-(--cq-text-tertiary)">
            {t("Waiting for your yes")}
          </h4>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {block.approvals.map((summary) => (
              <li key={summary} className="cq-body-sm text-(--cq-text-primary)">
                {summary}
              </li>
            ))}
          </ul>
          <Link
            href={APPROVALS_HREF}
            className={buttonClassName("secondary", "compact", "self-start")}
          >
            {t("Open Work")}
          </Link>
        </section>
      )}
      <p className="cq-caption m-0 text-(--cq-text-tertiary)">
        {block.timeZone === null
          ? t("Times are in UTC; tell Q your city for local times.")
          : `${t("Times in")} ${block.timeZone}.`}
      </p>
    </div>
  );
}
