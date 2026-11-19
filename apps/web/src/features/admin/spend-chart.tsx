"use client";

import { useId, useState } from "react";

import type { AdminConsoleOverviewDto } from "@capital-q/contracts";

import { useT } from "@/features/i18n/language";

import { dayLabel, niceMax, usd } from "./spend-words";

type Day = AdminConsoleOverviewDto["daily"][number];

/**
 * Model spend per day, the last 14 UTC days (admin design T1; dataviz:
 * one series, one hue, no legend; thin bars with 4 px rounded ends on the
 * baseline, a 2 px gap between bars; a recessive grid; a tooltip on hover
 * and focus; the same figures as a table). Priced calls only: the tooltip
 * and the table also count the calls that had no price, never as $0.
 */
export function SpendChart({ days }: { readonly days: readonly Day[] }) {
  const t = useT();
  const id = useId();
  const [active, setActive] = useState<number | null>(null);
  const values = days.map((day) => Number(day.pricedUsd));
  const top = niceMax(Math.max(0, ...values));
  const width = 560;
  const height = 180;
  const left = 44;
  const bottom = 22;
  const plotW = width - left - 4;
  const plotH = height - bottom - 8;
  const slot = plotW / Math.max(1, days.length);
  const bar = Math.max(4, Math.min(slot - 2, slot * 0.62));
  const total = values.reduce((sum, value) => sum + value, 0);
  const unpriced = days.reduce((sum, day) => sum + day.unpricedCalls, 0);
  const shown = active === null ? null : days[active];
  return (
    <figure className="m-0 flex flex-col gap-2" data-spend-chart>
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="cq-body-sm font-medium text-(--cq-text-primary)">
          {t("Model spend per day, last 14 days")}
        </span>
        <span className="cq-caption text-(--cq-text-secondary) tabular-nums">
          {t(
            `${usd(String(total))} priced${unpriced === 0 ? "" : ` · ${String(unpriced)} calls had no price`}`,
          )}
        </span>
      </figcaption>
      <div className="relative">
        <svg
          viewBox={`0 0 ${String(width)} ${String(height)}`}
          className="block h-auto w-full"
          // A group, not an image: each day's column is focusable.
          role="group"
          aria-labelledby={`${id}-summary`}
        >
          <title id={`${id}-summary`}>
            {t(
              `Model spend per day for the last 14 days, ${usd(String(total))} in all. The table below lists each day.`,
            )}
          </title>
          {[0, 0.5, 1].map((fraction) => {
            const y = 8 + plotH - fraction * plotH;
            return (
              <g key={fraction}>
                <line
                  x1={left}
                  x2={width - 4}
                  y1={y}
                  y2={y}
                  stroke="var(--cq-border-subtle)"
                  strokeWidth={1}
                />
                <text
                  x={left - 6}
                  y={y + 4}
                  textAnchor="end"
                  fontSize={11}
                  fill="var(--cq-text-tertiary)"
                >
                  {usd(String(top * fraction)).replace(/\.00$/u, "")}
                </text>
              </g>
            );
          })}
          {days.map((day, index) => {
            const value = values[index] ?? 0;
            const h = value <= 0 ? 0 : Math.max(2, (value / top) * plotH);
            const x = left + index * slot + (slot - bar) / 2;
            const y = 8 + plotH - h;
            const label = `${dayLabel(day.day)}: ${usd(day.pricedUsd)}, ${String(day.calls)} calls`;
            return (
              <g key={day.day}>
                {h === 0 ? null : (
                  <path
                    d={`M${String(x)},${String(y + h)} V${String(y + Math.min(4, h))} Q${String(x)},${String(y)} ${String(x + Math.min(4, bar / 2))},${String(y)} H${String(x + bar - Math.min(4, bar / 2))} Q${String(x + bar)},${String(y)} ${String(x + bar)},${String(y + Math.min(4, h))} V${String(y + h)} Z`}
                    fill="var(--cq-accent)"
                    opacity={active === null || active === index ? 1 : 0.55}
                  />
                )}
                {/* The hit target is the whole column, wider than the bar. */}
                <rect
                  x={left + index * slot}
                  y={8}
                  width={slot}
                  height={plotH}
                  fill="transparent"
                  tabIndex={0}
                  role="button"
                  aria-label={t(label)}
                  onMouseEnter={() => {
                    setActive(index);
                  }}
                  onMouseLeave={() => {
                    setActive(null);
                  }}
                  onFocus={() => {
                    setActive(index);
                  }}
                  onBlur={() => {
                    setActive(null);
                  }}
                />
                {/* Every other day, counted back from today, so the last is named. */}
                {(days.length - 1 - index) % 2 === 0 ? (
                  <text
                    x={left + index * slot + slot / 2}
                    y={height - 6}
                    textAnchor="middle"
                    fontSize={11}
                    fill="var(--cq-text-tertiary)"
                  >
                    {dayLabel(day.day)}
                  </text>
                ) : null}
              </g>
            );
          })}
          <line
            x1={left}
            x2={width - 4}
            y1={8 + plotH}
            y2={8 + plotH}
            stroke="var(--cq-border)"
            strokeWidth={1}
          />
        </svg>
        {shown === null || shown === undefined || active === null ? null : (
          <div
            role="status"
            className="pointer-events-none absolute top-0 rounded-(--cq-radius-md) border border-(--cq-border-subtle) bg-(--cq-surface-raised) px-2.5 py-1.5 cq-caption text-(--cq-text-primary) shadow-sm"
            style={{
              left: `${String(Math.min(78, Math.max(0, ((left + active * slot) / width) * 100)))}%`,
            }}
            data-spend-tooltip
          >
            <span className="block font-medium">{dayLabel(shown.day)}</span>
            <span className="block tabular-nums">
              {t(`${usd(shown.pricedUsd)} · ${String(shown.calls)} calls`)}
            </span>
            {shown.unpricedCalls === 0 ? null : (
              <span className="block text-(--cq-text-secondary)">
                {t(`${String(shown.unpricedCalls)} had no price`)}
              </span>
            )}
          </div>
        )}
      </div>
      <details className="cq-caption text-(--cq-text-secondary)">
        <summary className="cursor-pointer">{t("Show as a table")}</summary>
        <table className="mt-2 w-full tabular-nums">
          <thead>
            <tr className="text-start">
              <th scope="col" className="py-1 text-start font-medium">
                {t("Day")}
              </th>
              <th scope="col" className="py-1 text-end font-medium">
                {t("Priced spend")}
              </th>
              <th scope="col" className="py-1 text-end font-medium">
                {t("Calls")}
              </th>
              <th scope="col" className="py-1 text-end font-medium">
                {t("No price")}
              </th>
            </tr>
          </thead>
          <tbody>
            {days.map((day) => (
              <tr key={day.day}>
                <td className="py-0.5">{dayLabel(day.day)}</td>
                <td className="py-0.5 text-end">{usd(day.pricedUsd)}</td>
                <td className="py-0.5 text-end">{day.calls}</td>
                <td className="py-0.5 text-end">{day.unpricedCalls}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
