import type { CSSProperties } from "react";

import type { CapitalLedgerDto } from "@capital-q/contracts";

import { formatDay } from "@/components/date-format";

import { figure, money, percent, shareOf } from "./money";
import { RoundControls } from "./round-controls";
import { INSTRUMENT_LABELS } from "./round-labels";
import type { LeadOption } from "./round-terms-fields";
import {
  isLive,
  NOTICE_WORDS,
  PRO_RATA_WORDS,
  STATUS_WORDS,
} from "./round-words";

export { INSTRUMENT_LABELS } from "./round-labels";

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

const day = (value: string | null) =>
  value === null ? null : formatDay(value.slice(0, 10));

/** The status as a word with a shape cue (filled: in progress), never colour alone. */
function StatusPill({ status }: { readonly status: Round["status"] }) {
  return (
    <span
      className="cq-caption inline-flex items-center gap-1.5 rounded-full border border-(--cq-border-subtle) px-2.5 py-1 text-(--cq-text-primary)"
      data-status={status}
    >
      <span
        aria-hidden
        className={
          isLive(status)
            ? "inline-block size-2 rounded-full bg-(--cq-text-primary)"
            : "inline-block size-2 rounded-full border border-(--cq-text-tertiary)"
        }
      />
      {STATUS_WORDS[status]}
    </span>
  );
}

/** The round's dates, in one line: opened, first close, closed or cancelled. */
function datesOf(round: Round): string {
  const parts = [
    round.status === "PLANNED"
      ? round.terms.targetCloseOn === null
        ? "Not started"
        : `Aiming to close ${day(round.terms.targetCloseOn) ?? ""}`
      : round.openedOn === null
        ? null
        : `Opened ${day(round.openedOn) ?? ""}`,
    round.firstClosedOn === null
      ? null
      : `first close ${day(round.firstClosedOn) ?? ""}`,
    round.closedOn === null ? null : `closed ${day(round.closedOn) ?? ""}`,
    round.cancelledOn === null
      ? null
      : `cancelled ${day(round.cancelledOn) ?? ""}`,
    isLive(round.status) && round.terms.targetCloseOn !== null
      ? `target close ${day(round.terms.targetCloseOn) ?? ""}`
      : null,
  ];
  return parts.filter((part): part is string => part !== null).join(", ");
}

/** The terms that were said, in words; nothing for what wasn't. */
function termsOf(
  round: Round,
  rounds: readonly Round[],
  leads: readonly LeadOption[],
): string[] {
  const { terms } = round;
  const currency = round.target.currency;
  const lead =
    terms.lead === null
      ? null
      : terms.lead.kind === "NAMED"
        ? terms.lead.name
        : (leads.find(
            (option) =>
              terms.lead?.kind === "RELATIONSHIP" &&
              option.relationshipId === terms.lead.relationshipId,
          )?.name ?? "an investor on Capital Q");
  const extended =
    terms.extendsRoundId === null
      ? null
      : (rounds.find((other) => other.id === terms.extendsRoundId)?.name ??
        null);
  return [
    lead === null ? null : `Led by ${lead}`,
    terms.valuationCap === null
      ? null
      : `${money(terms.valuationCap, currency)} cap`,
    terms.discountPercent === null
      ? null
      : `${terms.discountPercent}% discount`,
    terms.valuation === null
      ? null
      : `${money(terms.valuation.amount, currency)} ${terms.valuation.basis === "POST_MONEY" ? "post-money" : "pre-money"}`,
    terms.hardCap === null
      ? null
      : `hard cap ${money(terms.hardCap, currency)}`,
    terms.proRataRights === null ? null : PRO_RATA_WORDS[terms.proRataRights],
    extended === null ? null : `extends ${extended}`,
  ].filter((part): part is string => part !== null);
}

function Notices({ round }: { readonly round: Round }) {
  if (round.notices.length === 0 && round.otherCurrencies.length === 0) {
    return null;
  }
  return (
    <ul className="flex flex-col gap-1.5" aria-label="Worth knowing">
      {round.notices.map((notice) => (
        <li
          key={notice}
          className="cq-body-sm rounded-xl border border-(--cq-border-subtle) bg-(--cq-surface) px-3 py-2 text-(--cq-text-primary)"
          data-notice={notice}
        >
          {NOTICE_WORDS[notice]}
        </li>
      ))}
      {round.otherCurrencies.map((other) => (
        <li
          key={other.currencyCode}
          className="cq-caption cq-numeric px-3 text-(--cq-text-secondary)"
        >
          Also in this round: {money(other.raised, other.currencyCode)}{" "}
          received, {money(other.confirmed, other.currencyCode)} agreed.
        </li>
      ))}
    </ul>
  );
}

/**
 * The current round (spec 6.6.15): what arrived, large; the target under
 * it; one meter with raised, confirmed and pledged in one hue, lightest to
 * strongest, and pledged textured so the three never rely on colour alone.
 * Raised is RECEIVED money only. P8: its status, terms, closes, what to know
 * and the steps it can take.
 */
export function RoundCard({
  round,
  rounds,
  leads,
}: {
  readonly round: Round;
  readonly rounds: readonly Round[];
  readonly leads: readonly LeadOption[];
}) {
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
  const terms = termsOf(round, rounds, leads);
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
            {datesOf(round) === "" ? null : `, ${datesOf(round)}`}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill status={round.status} />
          <span className="cq-caption rounded-full bg-(--cq-accent-soft) px-2.5 py-1 text-(--cq-text-primary)">
            Current round
          </span>
        </div>
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
      {terms.length === 0 ? null : (
        <p className="cq-body-sm text-(--cq-text-secondary)">
          {terms.join(" · ")}
        </p>
      )}
      <Closes round={round} />
      <Notices round={round} />
      <RoundControls round={round} rounds={rounds} leads={leads} />
    </article>
  );
}

function Closes({ round }: { readonly round: Round }) {
  if (round.closes.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1" aria-label={`${round.name} closes`}>
      {round.closes.map((close, index) => (
        <li
          key={`${close.on}-${String(index)}`}
          className="cq-caption cq-numeric flex flex-wrap justify-between gap-2 text-(--cq-text-secondary)"
        >
          <span>
            {close.label ??
              (close.kind === "TRANCHE"
                ? "Tranche"
                : close.kind === "FINAL_CLOSE"
                  ? "Final close"
                  : "Close")}
            , {day(close.on)}
          </span>
          <span>
            {close.amount === null
              ? "amount not said"
              : money(close.amount, round.target.currency)}
          </span>
        </li>
      ))}
    </ul>
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
  const reported = rounds.filter(
    (round) =>
      round.terms.reportedRaised !== null && round.terms.reportedRaised !== "0",
  );
  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-5 sm:p-6">
      <h3 className="cq-body-sm text-(--cq-text-secondary)">
        Raised on Capital Q, all rounds
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
      {reported.length === 0 ? null : (
        <div className="flex flex-col gap-1.5 border-t border-(--cq-border-subtle) pt-3">
          <h4 className="cq-caption text-(--cq-text-secondary)">
            Raised elsewhere, as you reported it
          </h4>
          <ul className="flex flex-col gap-1">
            {reported.map((round) => (
              <li
                key={round.id}
                className="cq-body-sm cq-numeric flex justify-between gap-3"
              >
                <span className="text-(--cq-text-secondary)">{round.name}</span>
                <span className="text-(--cq-text-primary)">
                  {money(
                    round.terms.reportedRaised ?? "0",
                    round.target.currency,
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}

/**
 * The round timeline (plan P8): earlier rounds, the rounds raising now, the
 * rounds planned next -- each with its status in words, its dates, what it
 * raised (received on Capital Q, and reported elsewhere, kept apart), its
 * terms, what to know, and the steps it can take. The current round's full
 * card sits above; here it is one line.
 */
export function RoundTimeline({
  rounds,
  currentRoundId,
  leads,
}: {
  readonly rounds: readonly Round[];
  readonly currentRoundId: string | null;
  readonly leads: readonly LeadOption[];
}) {
  const when = (round: Round) =>
    round.closedOn ??
    round.cancelledOn ??
    round.openedOn ??
    round.terms.targetCloseOn ??
    round.createdAt.slice(0, 10);
  const byDate = (a: Round, b: Round) => when(a).localeCompare(when(b));
  const groups = [
    {
      key: "earlier",
      title: "Earlier",
      items: rounds
        .filter(
          (round) => round.status === "CLOSED" || round.status === "CANCELLED",
        )
        .sort(byDate),
    },
    {
      key: "now",
      title: "Now",
      items: rounds.filter((round) => isLive(round.status)).sort(byDate),
    },
    {
      key: "next",
      title: "Next",
      items: rounds.filter((round) => round.status === "PLANNED").sort(byDate),
    },
  ];
  return (
    <ol className="flex flex-col gap-6" aria-label="Your rounds over time">
      {groups.map((group) => (
        <li key={group.key} className="flex flex-col gap-3">
          <h3 className="cq-label text-(--cq-text-secondary)">{group.title}</h3>
          {group.items.length === 0 ? (
            <p className="cq-body-sm text-(--cq-text-tertiary)">
              {group.key === "earlier"
                ? "No earlier rounds yet. Add one you raised before Capital Q to keep the full history."
                : group.key === "now"
                  ? "Nothing raising right now."
                  : "Nothing planned. Planning the next round early helps Q prepare you for it."}
            </p>
          ) : (
            <ul className="flex flex-col gap-2 border-l border-(--cq-border-subtle) pl-4">
              {group.items.map((round) => (
                <TimelineItem
                  key={round.id}
                  round={round}
                  rounds={rounds}
                  leads={leads}
                  isCurrent={round.id === currentRoundId}
                />
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  );
}

function TimelineItem({
  round,
  rounds,
  leads,
  isCurrent,
}: {
  readonly round: Round;
  readonly rounds: readonly Round[];
  readonly leads: readonly LeadOption[];
  readonly isCurrent: boolean;
}) {
  const currency = round.target.currency;
  const terms = termsOf(round, rounds, leads);
  return (
    <li
      className="flex flex-col gap-3 rounded-2xl border border-(--cq-border-subtle) bg-(--cq-surface-raised) px-4 py-4 sm:px-5"
      data-round={round.id}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="cq-body font-semibold text-(--cq-text-primary)">
            {round.name}
          </span>
          <span className="cq-caption text-(--cq-text-tertiary)">
            {INSTRUMENT_LABELS[round.instrument]}
            {datesOf(round) === "" ? null : `, ${datesOf(round)}`}
          </span>
        </div>
        <StatusPill status={round.status} />
      </div>
      {isCurrent ? (
        <p className="cq-body-sm text-(--cq-text-secondary)">
          Your current round: its money and steps are above.
        </p>
      ) : (
        <>
          <div className="cq-numeric flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="cq-body font-semibold text-(--cq-text-primary)">
              {money(round.sums.raised, currency)}{" "}
              <span className="cq-caption font-normal text-(--cq-text-secondary)">
                received on Capital Q
              </span>
            </span>
            {round.terms.reportedRaised === null ? null : (
              <span className="cq-body-sm text-(--cq-text-primary)">
                {money(round.terms.reportedRaised, currency)}{" "}
                <span className="cq-caption text-(--cq-text-secondary)">
                  raised elsewhere (your figure)
                </span>
              </span>
            )}
            <span className="cq-caption text-(--cq-text-tertiary)">
              target {money(round.target.amount, currency)}
            </span>
          </div>
          {terms.length === 0 ? null : (
            <p className="cq-body-sm text-(--cq-text-secondary)">
              {terms.join(" · ")}
            </p>
          )}
          {round.cancelledReason === null ? null : (
            <p className="cq-caption text-(--cq-text-secondary)">
              Why: {round.cancelledReason}
            </p>
          )}
          <Closes round={round} />
          <Notices round={round} />
          <RoundControls round={round} rounds={rounds} leads={leads} />
        </>
      )}
    </li>
  );
}
