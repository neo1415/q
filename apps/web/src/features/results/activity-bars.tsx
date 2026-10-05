"use client";

import { useState } from "react";

import { dayLabel } from "./results-words";

/**
 * One measure over the period, a bar per day or week (a small multiple:
 * three of these side by side rather than one chart with three colours).
 * Bars grow from a shared baseline with a fixed 0 floor; hovering or
 * focusing a column shows its date and count. The totals and every value
 * are also in a table for screen readers.
 */
export function ActivityBars({
  title,
  total,
  bucket,
  points,
}: {
  readonly title: string;
  readonly total: number;
  readonly bucket: "DAY" | "WEEK";
  readonly points: readonly {
    readonly start: string;
    readonly value: number;
  }[];
}) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...points.map((point) => point.value));
  const shown = active === null ? null : points[active];
  const label = (start: string) =>
    bucket === "WEEK" ? `Week of ${dayLabel(start)}` : dayLabel(start);
  const first = points[0];
  const last = points[points.length - 1];
  return (
    <figure className="flex min-w-0 flex-col gap-2">
      <figcaption className="flex items-baseline justify-between gap-2">
        <span className="cq-body-sm text-(--cq-text-secondary)">{title}</span>
        <span className="cq-title-sm tabular-nums text-(--cq-text-primary)">
          {total}
        </span>
      </figcaption>
      <div className="relative" onPointerLeave={() => setActive(null)}>
        <div
          aria-hidden="true"
          className="flex h-20 items-end gap-0.5 border-b border-(--cq-border)"
        >
          {points.map((point, index) => (
            <span
              key={point.start}
              onPointerEnter={() => setActive(index)}
              className="flex h-full min-w-0 flex-1 items-end"
            >
              <span
                className={`block w-full rounded-t-[3px] ${
                  active === index
                    ? "bg-(--cq-accent-hover)"
                    : "bg-(--cq-accent)"
                }`}
                style={{
                  height:
                    point.value === 0
                      ? 0
                      : `${String(Math.max(6, Math.round((point.value / max) * 100)))}%`,
                }}
              />
            </span>
          ))}
        </div>
        {shown === null || shown === undefined ? null : (
          <span
            role="status"
            className="cq-caption pointer-events-none absolute -top-2 right-0 -translate-y-full rounded-(--cq-radius-sm) border border-(--cq-border-subtle) bg-(--cq-surface-raised) px-2 py-1 text-(--cq-text-primary) shadow-(--cq-shadow-sm)"
          >
            {label(shown.start)} · {shown.value}
          </span>
        )}
      </div>
      {first === undefined || last === undefined ? null : (
        <div
          aria-hidden="true"
          className="cq-caption flex justify-between text-(--cq-text-tertiary)"
        >
          <span>{dayLabel(first.start)}</span>
          <span>{dayLabel(last.start)}</span>
        </div>
      )}
      <table className="sr-only">
        <caption>
          {title} by {bucket === "WEEK" ? "week" : "day"}
        </caption>
        <tbody>
          {points.map((point) => (
            <tr key={point.start}>
              <th scope="row">{label(point.start)}</th>
              <td>{point.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
