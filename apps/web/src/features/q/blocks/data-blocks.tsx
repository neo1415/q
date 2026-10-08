"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";

import type { QMapSpec, QResultBlock } from "@capital-q/contracts";

import {
  countryName,
  formatValue,
  splitPlaces,
  standingWords,
  subjectHref,
  timelineDate,
  valueScale,
} from "./data-block-logic";

/**
 * The bodies of the laid-out blocks (RECOVERY-2026-10 E4): a table with
 * named, linked columns; a chart of evidenced figures that always says
 * what they are; a map at country level with the list beside it; a
 * timeline in the order code put it. Every visual has its text equal in
 * the DOM (WCAG 1.1.1), and nothing is told by colour alone (1.4.1).
 * Tokens only; nothing glows (ADR 0017: glow is Q's alone).
 */

type Block<K extends QResultBlock["kind"]> = Extract<QResultBlock, { kind: K }>;

const LINK =
  "underline decoration-(--cq-border-strong) underline-offset-2 hover:decoration-(--cq-text-primary) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--cq-focus-ring)";

/** A column header, named and opening its record where it has a page. */
function ColumnHead({
  label,
  href,
}: {
  readonly label: string;
  readonly href: string | null;
}) {
  return href === null ? (
    <>{label}</>
  ) : (
    <Link href={href} className={LINK}>
      {label}
    </Link>
  );
}

export function TableBody({ block }: { readonly block: Block<"TABLE"> }) {
  return (
    <div className="overflow-x-auto" data-q-table>
      <table className="w-full border-collapse text-left">
        <thead>
          <tr>
            <th className="px-0 py-2 pr-4">
              <span className="sr-only">Attribute</span>
            </th>
            {block.columns.map((column, index) => (
              <th
                key={`${column.label}-${String(index)}`}
                scope="col"
                className="cq-label px-4 py-2 text-(--cq-text-primary)"
              >
                <ColumnHead
                  label={column.label}
                  href={subjectHref(column.subject)}
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row) => (
            <tr
              key={row.label}
              className="border-t border-(--cq-border-subtle)"
            >
              <th
                scope="row"
                className="cq-body-sm px-0 py-2 pr-4 font-normal text-(--cq-text-secondary)"
              >
                {row.label}
              </th>
              {row.cells.map((cell, index) => (
                <td
                  key={`${row.label}-${String(index)}`}
                  className="cq-body-sm px-4 py-2 align-top text-(--cq-text-primary)"
                >
                  {cell === "" ? (
                    <span className="text-(--cq-text-tertiary)">Not known</span>
                  ) : (
                    cell
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const CHART_W = 320;
const CHART_H = 140;
/** Series are told apart by pattern of mark as well as tone. */
const SERIES_TONES = [
  "var(--cq-accent)",
  "var(--cq-text-secondary)",
  "var(--cq-text-tertiary)",
  "var(--cq-border-strong)",
] as const;
const SERIES_DASH = [undefined, "6 3", "2 3", "8 2 2 2"] as const;

export function ChartBody({ block }: { readonly block: Block<"CHART"> }) {
  const titleId = useId();
  const values = block.series.flatMap((series) =>
    series.points.map((point) => point.value),
  );
  const { min, max } = valueScale(values);
  const y = (value: number) =>
    CHART_H - ((value - min) / (max - min)) * CHART_H;
  const labels = block.series[0]?.points.map((point) => point.label) ?? [];
  const slot = CHART_W / Math.max(1, labels.length);
  return (
    <figure className="flex flex-col gap-2" data-q-chart={block.chart}>
      <svg
        viewBox={`0 0 ${String(CHART_W)} ${String(CHART_H + 18)}`}
        className="h-auto w-full max-w-[480px]"
        role="img"
        aria-labelledby={titleId}
      >
        <title id={titleId}>{`${block.title}, ${block.unit}`}</title>
        <line
          x1={0}
          x2={CHART_W}
          y1={y(0)}
          y2={y(0)}
          stroke="var(--cq-border-strong)"
          strokeWidth={1}
        />
        {block.series.map((series, s) => {
          const tone = SERIES_TONES[s % SERIES_TONES.length];
          if (block.chart === "BAR") {
            const width = (slot * 0.7) / block.series.length;
            return series.points.map((point, i) => {
              const top = Math.min(y(point.value), y(0));
              return (
                <rect
                  key={`${series.label}-${point.label}`}
                  x={i * slot + slot * 0.15 + s * width}
                  y={top}
                  width={width}
                  height={Math.abs(y(point.value) - y(0))}
                  fill={tone}
                  opacity={1 - s * 0.15}
                />
              );
            });
          }
          const d = series.points
            .map(
              (point, i) =>
                `${i === 0 ? "M" : "L"}${String(i * slot + slot / 2)} ${String(y(point.value))}`,
            )
            .join(" ");
          return (
            <path
              key={series.label}
              d={d}
              fill="none"
              stroke={tone}
              strokeWidth={2}
              strokeDasharray={SERIES_DASH[s % SERIES_DASH.length]}
            />
          );
        })}
        {labels.map((label, i) => (
          <text
            key={label}
            x={i * slot + slot / 2}
            y={CHART_H + 14}
            textAnchor="middle"
            className="fill-(--cq-text-tertiary) text-[9px]"
          >
            {label}
          </text>
        ))}
      </svg>
      <figcaption className="flex flex-col gap-1">
        {block.series.map((series) => (
          <p
            key={series.label}
            className="m-0 cq-caption text-(--cq-text-secondary)"
            data-q-chart-standing
          >
            <span className="font-semibold text-(--cq-text-primary)">
              {series.label}
            </span>
            {": "}
            {standingWords(series.truthClass, series.evidenceStatus)}.{" "}
            {series.source}
          </p>
        ))}
      </figcaption>
      <details className="cq-caption text-(--cq-text-secondary)">
        <summary className="cursor-pointer">The figures</summary>
        <table className="mt-1 border-collapse text-left" data-q-chart-table>
          <thead>
            <tr>
              <th className="pr-3">
                <span className="sr-only">Point</span>
              </th>
              {block.series.map((series) => (
                <th key={series.label} scope="col" className="pr-3">
                  {series.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {labels.map((label, i) => (
              <tr key={label}>
                <th scope="row" className="pr-3 font-normal">
                  {label}
                </th>
                {block.series.map((series) => {
                  const point = series.points[i];
                  return (
                    <td key={series.label} className="pr-3 cq-numeric">
                      {point === undefined
                        ? "Not known"
                        : formatValue(point.value, block.currency)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

type World = typeof import("./world-data");

/** The world outlines, loaded the first time a map is drawn. */
function useWorld(): World | null {
  const [world, setWorld] = useState<World | null>(null);
  useEffect(() => {
    let live = true;
    void import("./world-data")
      .then((loaded) => {
        if (live) setWorld(loaded);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return world;
}

/** Where things are: the countries marked, and the same as a list. */
export function MapBody({ map }: { readonly map: QMapSpec }) {
  const world = useWorld();
  const titleId = useId();
  const { placed, unplaced } = splitPlaces(map.places);
  const marked = new Set(placed.map((place) => place.countryCode));
  return (
    <figure className="flex flex-col gap-2" data-q-map>
      {world === null ? (
        <div
          aria-hidden="true"
          className="aspect-[720/284] w-full rounded-(--cq-radius-md) bg-(--cq-surface-subtle)"
        />
      ) : (
        <svg
          viewBox={`0 0 ${String(world.WORLD_WIDTH)} ${String(world.WORLD_HEIGHT)}`}
          className="h-auto w-full"
          role="img"
          aria-labelledby={titleId}
          data-q-map-drawn
        >
          <title id={titleId}>
            {`${map.title}: ${placed
              .map(
                (place) => `${place.label}, ${countryName(place.countryCode)}`,
              )
              .join("; ")}`}
          </title>
          {Object.entries(world.COUNTRY_PATHS).map(([code, d]) => (
            <path
              key={code}
              d={d}
              fill={
                marked.has(code)
                  ? "var(--cq-accent-soft)"
                  : "var(--cq-surface-subtle)"
              }
              stroke={
                marked.has(code)
                  ? "var(--cq-accent)"
                  : "var(--cq-border-subtle)"
              }
              strokeWidth={marked.has(code) ? 1 : 0.5}
              data-q-map-country={marked.has(code) ? code : undefined}
            />
          ))}
          {placed.map((place, index) => {
            const centre = world.COUNTRY_CENTRES[place.countryCode];
            if (centre === undefined) return null;
            return (
              <g key={`${place.label}-${String(index)}`}>
                <circle
                  cx={centre[0]}
                  cy={centre[1]}
                  r={6}
                  fill="var(--cq-accent)"
                  stroke="var(--cq-surface)"
                  strokeWidth={2}
                />
                <text
                  x={centre[0]}
                  y={centre[1] + 3}
                  textAnchor="middle"
                  className="fill-(--cq-surface) text-[8px] font-semibold"
                >
                  {String(index + 1)}
                </text>
              </g>
            );
          })}
        </svg>
      )}
      <figcaption className="flex flex-col gap-1">
        <ol className="m-0 flex list-none flex-col gap-1 p-0" data-q-map-list>
          {placed.map((place, index) => {
            const href = subjectHref(place.subject);
            return (
              <li
                key={`${place.label}-${String(index)}`}
                className="cq-body-sm text-(--cq-text-primary)"
              >
                <span className="cq-numeric text-(--cq-text-tertiary)">
                  {String(index + 1)}.{" "}
                </span>
                {href === null ? (
                  place.label
                ) : (
                  <Link href={href} className={LINK}>
                    {place.label}
                  </Link>
                )}
                <span className="text-(--cq-text-secondary)">
                  {" "}
                  · {countryName(place.countryCode)}
                  {place.note === null ? "" : ` · ${place.note}`}
                </span>
              </li>
            );
          })}
          {unplaced.map((place, index) => (
            <li
              key={`unplaced-${place.label}-${String(index)}`}
              className="cq-body-sm text-(--cq-text-secondary)"
              data-q-map-unplaced
            >
              {place.label} · Location not published
            </li>
          ))}
        </ol>
        <p className="m-0 cq-caption text-(--cq-text-tertiary)">{map.basis}</p>
      </figcaption>
    </figure>
  );
}

export function TimelineBody({ block }: { readonly block: Block<"TIMELINE"> }) {
  return (
    <ol
      className="m-0 flex list-none flex-col gap-3 border-l border-(--cq-border) p-0 pl-4"
      data-q-timeline
    >
      {block.events.map((event, index) => {
        const href = subjectHref(event.subject);
        return (
          <li
            key={`${event.at}-${String(index)}`}
            className="flex flex-col"
            data-q-timeline-event
          >
            <time
              dateTime={event.at}
              className="cq-caption text-(--cq-text-tertiary)"
            >
              {timelineDate(event.at)}
            </time>
            <span className="cq-body-sm text-(--cq-text-primary)">
              {href === null ? (
                event.label
              ) : (
                <Link href={href} className={LINK}>
                  {event.label}
                </Link>
              )}
            </span>
            {event.detail === null ? null : (
              <span className="cq-caption text-(--cq-text-secondary)">
                {event.detail}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
