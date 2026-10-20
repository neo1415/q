import type { MeetingDto, RelationshipStatusDto } from "@capital-q/contracts";

import { formatDayTime } from "@/components/date-format";

import {
  formatRelationshipDate,
  milestoneSentence,
  type RelationshipSide,
  visibilityWords,
} from "./relationship-words";
import { timelineRuns, type TimelineRun } from "./timeline-runs";
import { serverTNow } from "@/features/i18n/server-now";

/**
 * What happened, in order (CQ-WEB-030; doc 17 §84; spec §12.5).
 *
 * The milestones are the per-party fold of the relationship's history, so
 * each side's timeline holds only what that side may see: a company's
 * starts at the investor's interest, never at their private discovery.
 * The relationship's calls sit among them (P0-6 2026-10-03: the meeting
 * step was invisible): booked, past or cancelled, in words that claim no
 * more than the calendar knows -- a past call is "on" a date, not "held",
 * unless the history recorded it as held. Each entry is dated and says,
 * in words, who can see it. A hairline and a small mark per entry -- no
 * card, no colour carrying meaning.
 */

type Entry =
  | { readonly kind: "RUN"; readonly at: string; readonly run: TimelineRun }
  | {
      readonly kind: "MEETING";
      readonly at: string;
      readonly meeting: MeetingDto;
    };

/** A call, said as plainly as the calendar allows. */
export function meetingSentence(
  meeting: MeetingDto,
  counterpart: string,
  now: number | undefined,
): string | null {
  const when = formatDayTime(meeting.startsAt);
  if (meeting.status === "CANCELLED") {
    return `The call with ${counterpart} on ${when} was cancelled.`;
  }
  if (meeting.status !== "SCHEDULED") return null;
  return now !== undefined && Date.parse(meeting.endsAt) > now
    ? `Call with ${counterpart} booked for ${when}.`
    : `Call with ${counterpart} on ${when}.`;
}

export function RelationshipTimeline({
  milestones,
  meetings = [],
  side,
  counterpart,
  now,
  newestFirst = false,
}: {
  readonly milestones: RelationshipStatusDto["milestones"];
  readonly meetings?: readonly MeetingDto[];
  readonly side: RelationshipSide;
  readonly counterpart: string;
  /**
   * When the page was read: a call ending before it is past. Without it a
   * call is only "on" its date, never claimed as booked ahead.
   */
  readonly now?: number | undefined;
  /** The record's card reads the latest first (record prototype). */
  readonly newestFirst?: boolean | undefined;
}) {
  const t = serverTNow();

  const ordered: Entry[] = [
    ...timelineRuns(milestones).map((run): Entry => ({
      kind: "RUN",
      at: run.steps[0]?.at ?? "",
      run,
    })),
    ...meetings
      .filter((meeting) => meetingSentence(meeting, counterpart, now) !== null)
      .map((meeting): Entry => ({
        kind: "MEETING",
        at: meeting.startsAt,
        meeting,
      })),
  ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const entries = newestFirst ? ordered.toReversed() : ordered;

  return (
    <ol
      aria-label={t("What happened")}
      className="flex max-w-(--cq-layout-reading) flex-col"
    >
      {entries.map((entry, index) => {
        const at = entry.kind === "MEETING" ? entry.meeting.startsAt : entry.at;
        // A step that moved the relationship on is a filled mark; a booking
        // or a discovery a hollow one. Decoration: the words carry it.
        const key =
          entry.kind === "MEETING"
            ? entry.meeting.status === "SCHEDULED" &&
              now !== undefined &&
              Date.parse(entry.meeting.endsAt) <= now
            : KEY_STATES.has(entry.run.steps.at(-1)?.state ?? "");
        return (
          <li
            key={
              entry.kind === "MEETING"
                ? `meeting-${entry.meeting.id}`
                : `${String(index)}-${entry.at}`
            }
            className="grid grid-cols-[76px_14px_minmax(0,1fr)] gap-2.5 py-2"
            data-milestone={
              entry.kind === "MEETING" ? "MEETING" : entry.run.steps[0]?.state
            }
          >
            <time
              dateTime={at}
              className="cq-caption cq-numeric pt-px text-(--cq-text-tertiary)"
            >
              {t(formatRelationshipDate(at))}
            </time>
            <span
              aria-hidden="true"
              className={`mt-1 size-[9px] rounded-full border-2 ${
                key
                  ? "border-(--cq-positive) bg-(--cq-positive)"
                  : "border-(--cq-border) bg-(--cq-surface-raised)"
              }`}
            />
            {entry.kind === "MEETING" ? (
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="cq-body-sm font-medium text-(--cq-text-primary)">
                  {meetingSentence(entry.meeting, counterpart, now)}
                </span>
                <span className="cq-caption text-(--cq-text-tertiary)">
                  {t(`Shared with ${counterpart}`)}
                </span>
              </span>
            ) : (
              <RunText run={entry.run} side={side} counterpart={counterpart} />
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** The steps that move a relationship on: a filled mark on the timeline. */
const KEY_STATES: ReadonlySet<string> = new Set([
  "INTEREST_EXPRESSED",
  "CONNECTED",
  "MEETING_HELD",
  "IN_DILIGENCE",
  "INVESTED",
]);

function RunText({
  run,
  side,
  counterpart,
}: {
  readonly run: TimelineRun;
  readonly side: RelationshipSide;
  readonly counterpart: string;
}) {
  const t = serverTNow();

  const first = run.steps[0];
  if (first === undefined) return null;
  const last = run.steps[run.steps.length - 1] ?? first;
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="cq-body-sm font-medium text-(--cq-text-primary)">
        {t(milestoneSentence(first.state, side, counterpart))}
      </span>
      {run.steps.slice(1).map((step) => (
        <span
          key={step.state}
          className="cq-body-sm font-medium text-(--cq-text-primary)"
        >
          {t("Then:")} {t(milestoneSentence(step.state, side, counterpart))}
        </span>
      ))}
      {run.times > 1 ? (
        <span className="cq-caption cq-numeric text-(--cq-text-secondary)">
          {run.steps.length > 1
            ? t(
                `This back-and-forth happened ${String(run.times)} times that day.`,
              )
            : t(`Happened ${String(run.times)} times that day.`)}
        </span>
      ) : null}
      <span className="cq-caption text-(--cq-text-secondary)">
        {t(visibilityWords(last.state, counterpart))}
      </span>
    </span>
  );
}
