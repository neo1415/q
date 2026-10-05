import type { CSSProperties } from "react";

import type { CapitalLedgerDto } from "@capital-q/contracts";

import { formatDay } from "@/components/date-format";

import { CloseRoundButton } from "./open-round";
import { figure, money, percent, shareOf } from "./money";

type Round = CapitalLedgerDto["rounds"][number];

/**
 * One hue, three steps (dataviz: a meter's parts are one ramp): raised is
 * the accent, confirmed a lighter step, pledged lighter still and hatched,
 * so the three read apart without colour. Tokens only.
 */
const METER: Readonly<
  Record<"raised" | "confirmed" | "pledged", CSSProperties>
> = {
  raised: { background: "var(--cq-accent)" },
  confirmed: {
    background:
      "color-mix(in srgb, var(--cq-accent) 52%, var(--cq-surface-raised))",
  },
  pledged: {
    background:
      "repeating-linear-gradient(135deg, color-mix(in srgb, var(--cq-accent) 40%, var(--cq-surface-raised)) 0 3px, var(--cq-accent-soft) 3px 6px)",
  },
};

export const INSTRUMENT_LABELS: Readonly<Record<Round["instrument"], string>> =
  {
    SAFE: "SAFE",
    EQUITY: "Equity",
    CONVERTIBLE: "Convertible note",
    OTHER: "Other",
  };

/**
 * The current round (spec 6.6.15): what arrived, large; the target under
 * it; one meter with raised, confirmed and pledged in one hue, lightest to
 * strongest, and pledged textured so the three never rely on colour alone.
 * Raised is RECEIVED money only.
 */
export function RoundCard({ round }: { readonly round: Round }) {
  const target = round.target.amount;
  const currency = round.target.currency;
  const parts = [
    { key: "raised", label: "Raised", amount: round.sums.raised },
    { key: "confirmed", label: "Confirmed", amount: round.sums.confirmed },
    { key: "pledged", label: "Pledged", amount: round.sums.pledged },
  ] as const;
  // Each segment is its share of the target; together they never pass it.
  let left = 10000;
  const widths = parts.map((part) => {
    const width = Math.min(shareOf(part.amount, target), left);
    left -= width;
    return width;
  });
  const raised = shareOf(round.sums.raised, target);
  const opened =
    round.openedOn === null ? null : formatDay(round.openedOn.slice(0, 10));
  return (
    <article
      className="cq-glow-card flex flex-col gap-4 rounded-2xl p-5 sm:p-6"
      data-round={round.id}
      aria-labelledby={`round-${round.id}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h3
            id={`round-${round.id}`}
            className="cq-title-sm text-(--cq-text-primary)"
          >
            {round.name}
          </h3>
          <span className="cq-caption text-(--cq-text-tertiary)">
            {INSTRUMENT_LABELS[round.instrument]}
            {round.status === "PLANNED"
              ? ", planned"
              : opened === null
                ? null
                : `, opened ${opened}`}
          </span>
        </div>
        <span className="cq-caption rounded-full bg-(--cq-accent-soft) px-2.5 py-1 text-(--cq-text-primary)">
          Current round
        </span>
      </div>
      <div className="flex flex-col gap-1">
        <p className="cq-display cq-numeric text-(--cq-text-primary)">
          {money(round.sums.raised, currency)}
        </p>
        <p className="cq-body-sm cq-numeric text-(--cq-text-secondary)">
          raised of {money(target, currency)}, {percent(raised)}
        </p>
      </div>
      <div
        className="flex h-3 gap-0.5 overflow-hidden rounded-full bg-(--cq-surface-strong)"
        role="img"
        aria-label={`Raised ${percent(widths[0] ?? 0)}, confirmed ${percent(widths[1] ?? 0)}, pledged ${percent(widths[2] ?? 0)} of the target`}
      >
        {parts.map((part, index) =>
          (widths[index] ?? 0) === 0 ? null : (
            <span
              key={part.key}
              data-meter={part.key}
              className="h-full"
              style={{
                ...METER[part.key],
                width: `${String((widths[index] ?? 0) / 100)}%`,
              }}
            />
          ),
        )}
      </div>
      <dl className="grid grid-cols-3 gap-3">
        {parts.map((part) => (
          <div key={part.key} className="flex flex-col gap-0.5">
            <dt className="cq-caption flex items-center gap-1.5 text-(--cq-text-secondary)">
              <span
                aria-hidden
                className="inline-block size-2.5 rounded-[3px]"
                style={METER[part.key]}
              />
              {part.label}
            </dt>
            <dd className="cq-body-sm cq-numeric font-semibold text-(--cq-text-primary)">
              {figure(part.amount)}
            </dd>
          </div>
        ))}
      </dl>
      <div className="flex justify-end">
        <CloseRoundButton roundId={round.id} name={round.name} />
      </div>
    </article>
  );
}

/** All rounds, per currency: received money only, never converted. */
export function TotalCard({
  totals,
  rounds,
}: {
  readonly totals: CapitalLedgerDto["totals"];
  readonly rounds: CapitalLedgerDto["rounds"];
}) {
  const [first, ...others] = totals;
  const withMoney = rounds.filter((round) => round.sums.raised !== "0");
  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-5 sm:p-6">
      <h3 className="cq-body-sm text-(--cq-text-secondary)">
        Raised, all rounds
      </h3>
      <p className="cq-title-lg cq-numeric text-(--cq-text-primary)">
        {first === undefined
          ? "Nothing yet"
          : money(first.raised, first.currencyCode)}
      </p>
      {others.map((total) => (
        <p
          key={total.currencyCode}
          className="cq-body-sm cq-numeric text-(--cq-text-primary)"
        >
          {money(total.raised, total.currencyCode)}
        </p>
      ))}
      {withMoney.length === 0 ? null : (
        <ul className="flex flex-col gap-1.5 border-t border-(--cq-border-subtle) pt-3">
          {withMoney.map((round) => (
            <li
              key={round.id}
              className="cq-body-sm cq-numeric flex justify-between gap-3"
            >
              <span className="text-(--cq-text-secondary)">{round.name}</span>
              <span className="text-(--cq-text-primary)">
                {money(round.sums.raised, round.target.currency)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

/** A closed or waiting round: one line, what it raised of its target. */
export function PastRound({ round }: { readonly round: Round }) {
  const closed =
    round.closedOn === null ? null : formatDay(round.closedOn.slice(0, 10));
  return (
    <li className="flex items-center justify-between gap-4 rounded-2xl border border-(--cq-border-subtle) bg-(--cq-surface-raised) px-5 py-4">
      <div className="flex flex-col gap-0.5">
        <span className="cq-body font-semibold text-(--cq-text-primary)">
          {round.name}
        </span>
        <span className="cq-caption text-(--cq-text-tertiary)">
          {INSTRUMENT_LABELS[round.instrument]}
          {round.status === "CLOSED"
            ? closed === null
              ? ", closed"
              : `, closed ${closed}`
            : round.status === "PLANNED"
              ? ", planned"
              : ", open"}
        </span>
      </div>
      <div className="cq-numeric flex flex-col items-end gap-0.5">
        <span className="cq-body font-semibold text-(--cq-text-primary)">
          {money(round.sums.raised, round.target.currency)}
        </span>
        <span className="cq-caption text-(--cq-text-tertiary)">
          of {money(round.target.amount, round.target.currency)}
        </span>
      </div>
    </li>
  );
}
