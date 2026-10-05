"use client";

import Link from "next/link";
import { useState } from "react";

/**
 * Scores over time, oldest to newest, on a fixed 0 to 100 scale so a
 * small change never looks like a big one. Each point is a link to that
 * rehearsal's review; hovering or focusing one names it.
 */
export function ScoreTrend({
  points,
}: {
  readonly points: readonly {
    readonly id: string;
    readonly at: string;
    readonly name: string;
    readonly score: number;
  }[];
}) {
  const [active, setActive] = useState<number | null>(null);
  const width = 400;
  const height = 96;
  const pad = 8;
  const x = (index: number) =>
    points.length === 1
      ? width / 2
      : pad + (index / (points.length - 1)) * (width - pad * 2);
  const y = (score: number) => pad + (1 - score / 100) * (height - pad * 2);
  const shown = active === null ? null : points[active];
  return (
    <div className="relative min-w-0" onPointerLeave={() => setActive(null)}>
      <svg
        viewBox={`0 0 ${String(width)} ${String(height)}`}
        preserveAspectRatio="none"
        className="block h-24 w-full overflow-visible"
        role="img"
        aria-label={`Scores of your last ${String(points.length)} rehearsals, from ${String(points[0]?.score ?? 0)} to ${String(points[points.length - 1]?.score ?? 0)} out of 100`}
      >
        {[0, 50, 100].map((tick) => (
          <line
            key={tick}
            x1={0}
            x2={width}
            y1={y(tick)}
            y2={y(tick)}
            stroke="var(--cq-border-subtle)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <polyline
          fill="none"
          stroke="var(--cq-accent)"
          strokeWidth={2}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          points={points
            .map(
              (point, index) => `${String(x(index))},${String(y(point.score))}`,
            )
            .join(" ")}
        />
      </svg>
      {/* The points are HTML over the line so they stay round and tappable. */}
      <ul className="absolute inset-0">
        {points.map((point, index) => (
          <li
            key={point.id}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{
              left: `${String((x(index) / width) * 100)}%`,
              top: `${String((y(point.score) / height) * 100)}%`,
            }}
          >
            <Link
              href={`/rehearsals/r/${encodeURIComponent(point.id)}`}
              aria-label={`${point.name}, ${new Date(point.at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}, ${String(point.score)} out of 100`}
              onPointerEnter={() => setActive(index)}
              onFocus={() => setActive(index)}
              onBlur={() => setActive(null)}
              className="flex size-6 items-center justify-center rounded-(--cq-radius-full) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)"
            >
              <span
                className={`block rounded-(--cq-radius-full) border-2 border-(--cq-surface-raised) bg-(--cq-accent) ${
                  active === index || index === points.length - 1
                    ? "size-3"
                    : "size-2.5"
                }`}
              />
            </Link>
          </li>
        ))}
      </ul>
      {shown === null || shown === undefined ? null : (
        <span
          role="status"
          className="cq-caption pointer-events-none absolute -top-1 right-0 -translate-y-full rounded-(--cq-radius-sm) border border-(--cq-border-subtle) bg-(--cq-surface-raised) px-2 py-1 text-(--cq-text-primary) shadow-(--cq-shadow-sm)"
        >
          {shown.name} ·{" "}
          {new Date(shown.at).toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
          })}{" "}
          · {shown.score}
        </span>
      )}
    </div>
  );
}
