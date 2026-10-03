import type { MeetingDto, RelationshipStatusDto } from "@capital-q/contracts";

import { formatDayTime } from "@/components/date-format";

import {
  formatRelationshipDate,
  milestoneSentence,
  type RelationshipSide,
  visibilityWords,
} from "./relationship-words";
import { timelineRuns, type TimelineRun } from "./timeline-runs";

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
}) {
  const entries: Entry[] = [
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

  return (
    <ol
      aria-label="What happened"
      className="flex max-w-(--cq-layout-reading) flex-col"
    >
      {entries.map((entry, index) => (
        <li
          key={
            entry.kind === "MEETING"
              ? `meeting-${entry.meeting.id}`
              : `${String(index)}-${entry.at}`
          }
          className="relative flex gap-3 pb-5 last:pb-0"
          data-milestone={
            entry.kind === "MEETING" ? "MEETING" : entry.run.steps[0]?.state
          }
        >
          {/* The line and dot are decoration; the text carries everything. */}
          <span
            aria-hidden="true"
            className="relative flex w-3 shrink-0 justify-center"
          >
            <span className="mt-1.5 size-2 rounded-full border border-(--cq-border-strong) bg-(--cq-surface)" />
            {index < entries.length - 1 ? (
              <span className="absolute top-4 bottom-[-0.25rem] w-px bg-(--cq-border)" />
            ) : null}
          </span>
          {entry.kind === "MEETING" ? (
            <span className="flex min-w-0 flex-col gap-0.5">
              <time
                dateTime={entry.meeting.startsAt}
                className="cq-caption cq-numeric text-(--cq-text-tertiary)"
              >
                {formatRelationshipDate(entry.meeting.startsAt)}
              </time>
              <span className="cq-body text-(--cq-text-primary)">
                {meetingSentence(entry.meeting, counterpart, now)}
              </span>
              <span className="cq-caption text-(--cq-text-secondary)">
                Shared with {counterpart}
              </span>
            </span>
          ) : (
            <RunText run={entry.run} side={side} counterpart={counterpart} />
          )}
        </li>
      ))}
    </ol>
  );
}

function RunText({
  run,
  side,
  counterpart,
}: {
  readonly run: TimelineRun;
  readonly side: RelationshipSide;
  readonly counterpart: string;
}) {
  const first = run.steps[0];
  if (first === undefined) return null;
  const last = run.steps[run.steps.length - 1] ?? first;
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <time
        dateTime={first.at}
        className="cq-caption cq-numeric text-(--cq-text-tertiary)"
      >
        {formatRelationshipDate(first.at)}
      </time>
      <span className="cq-body text-(--cq-text-primary)">
        {milestoneSentence(first.state, side, counterpart)}
      </span>
      {run.steps.slice(1).map((step) => (
        <span key={step.state} className="cq-body text-(--cq-text-primary)">
          Then: {milestoneSentence(step.state, side, counterpart)}
        </span>
      ))}
      {run.times > 1 ? (
        <span className="cq-caption cq-numeric text-(--cq-text-secondary)">
          {run.steps.length > 1
            ? `This back-and-forth happened ${String(run.times)} times that day.`
            : `Happened ${String(run.times)} times that day.`}
        </span>
      ) : null}
      <span className="cq-caption text-(--cq-text-secondary)">
        {visibilityWords(last.state, counterpart)}
      </span>
    </span>
  );
}
