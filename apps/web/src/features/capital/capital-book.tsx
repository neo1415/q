import type { ReactNode } from "react";

import { getCapitalLedger, getMyCommitments } from "@capital-q/api-client";
import type {
  CapitalLedgerDto,
  CapitalObjectiveDto,
  LedgerCommitmentDto,
  MyCommitmentsDto,
} from "@capital-q/contracts";
import { buttonClassName } from "@capital-q/ui/button";

import { apiSession } from "@/features/q/context";

import { CommitmentCard } from "./commitment-card";
import { money } from "./money";
import { OpenRound, type RoundDraft } from "./open-round";
import {
  INSTRUMENT_LABELS,
  RoundCard,
  RoundTimeline,
  TotalCard,
} from "./round-card";
import type { LeadOption } from "./round-terms-fields";
import { PRO_RATA_WORDS, STATUS_WORDS } from "./round-words";

/**
 * The money on Capital (founder direction 2026-10-04): rounds, what each
 * raised (received money only, derived), and every commitment as a card
 * with this side's one next step. Read under the person's own session;
 * the API decides what they may see.
 */

export async function founderLedger(
  companyId: string,
): Promise<CapitalLedgerDto | null> {
  const session = await apiSession();
  if (session === null) return null;
  return getCapitalLedger(session, companyId).catch(() => null);
}

export async function investorCommitments(): Promise<MyCommitmentsDto | null> {
  const session = await apiSession();
  if (session === null) return null;
  return getMyCommitments(session).catch(() => null);
}

function groups(items: readonly LedgerCommitmentDto[]) {
  return [
    {
      key: "you",
      title: "Needs you",
      items: items.filter((item) => item.next !== null),
    },
    {
      key: "them",
      title: "Waiting on them",
      items: items.filter(
        (item) => item.next === null && item.status !== "RECEIVED",
      ),
    },
    {
      key: "done",
      title: "Received",
      items: items.filter((item) => item.status === "RECEIVED"),
    },
  ].filter((group) => group.items.length > 0);
}

function Group({
  title,
  count,
  children,
}: {
  readonly title: string;
  readonly count: number;
  readonly children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3" aria-label={title}>
      <h3 className="cq-label text-(--cq-text-secondary)">
        {title} <span className="cq-numeric">({String(count)})</span>
      </h3>
      <div className="grid gap-3 md:grid-cols-2">{children}</div>
    </section>
  );
}

/** A round's name from the raise's stage code ("pre_seed" -> "Pre-seed"). */
function stageName(code: string | null): string {
  if (code === null) return "";
  const words = code.replaceAll("_", " ");
  const name = words.charAt(0).toUpperCase() + words.slice(1);
  return name === "Pre seed" ? "Pre-seed" : name;
}

const INSTRUMENT_OF: Readonly<Record<string, RoundDraft["instrument"]>> = {
  safe: "SAFE",
  equity: "EQUITY",
  priced_equity: "EQUITY",
  convertible: "CONVERTIBLE",
  convertible_note: "CONVERTIBLE",
};

export function draftFrom(objective: CapitalObjectiveDto | null): RoundDraft {
  return objective === null
    ? { name: "", target: { amount: "", currency: "USD" }, instrument: "SAFE" }
    : {
        name: stageName(objective.targetStage),
        target: {
          amount: objective.target.amount,
          currency: objective.target.currency,
        },
        instrument: INSTRUMENT_OF[objective.instrumentCode ?? ""] ?? "SAFE",
      };
}

export function FounderBook({
  ledger,
  draft,
  leads = [],
}: {
  readonly ledger: CapitalLedgerDto;
  readonly draft: RoundDraft;
  /** The company's investor relationships, for naming a round's lead. */
  readonly leads?: readonly LeadOption[];
}) {
  const current =
    ledger.rounds.find((round) => round.id === ledger.currentRoundId) ?? null;
  const roundOptions = ledger.rounds.map((round) => ({
    id: round.id,
    name: round.name,
  }));
  const nameOf = new Map(ledger.rounds.map((round) => [round.id, round.name]));
  return (
    <div className="flex flex-col gap-10">
      {current === null ? (
        <section className="flex flex-col gap-4" aria-label="Rounds">
          <div className="flex max-w-(--cq-layout-narrow) flex-col gap-3 rounded-2xl border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-5 sm:p-6">
            <h3 className="cq-title-sm text-(--cq-text-primary)">
              No round open
            </h3>
            <p className="cq-body-sm text-(--cq-text-secondary)">
              Open one to track what you raise in it.
            </p>
            <div>
              <OpenRound
                draft={draft}
                prominent
                leads={leads}
                rounds={roundOptions}
              />
            </div>
          </div>
        </section>
      ) : (
        <section
          className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]"
          aria-label="Rounds"
        >
          <RoundCard round={current} rounds={ledger.rounds} leads={leads} />
          <TotalCard totals={ledger.totals} rounds={ledger.rounds} />
          <div className="lg:col-span-2">
            <OpenRound
              draft={{ ...draft, name: "" }}
              leads={leads}
              rounds={roundOptions}
            />
          </div>
        </section>
      )}

      <section className="flex flex-col gap-6" aria-labelledby="commitments">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="commitments" className="cq-title-md text-(--cq-text-primary)">
            Commitments
          </h2>
          {ledger.commitments.length === 0 ? null : (
            <a
              href="/capital/export"
              className={buttonClassName("quiet", "compact")}
              download
            >
              Download CSV
            </a>
          )}
        </div>
        {ledger.commitments.length === 0 ? (
          <p className="cq-body-sm text-(--cq-text-secondary)">
            None yet. Money an investor commits, or Q hears in a call, shows
            here.
          </p>
        ) : (
          groups(ledger.commitments).map((group) => (
            <Group
              key={group.key}
              title={group.title}
              count={group.items.length}
            >
              {group.items.map((item) => (
                <CommitmentCard
                  key={item.id}
                  item={item}
                  side="COMPANY"
                  currentRoundId={ledger.currentRoundId}
                  roundName={
                    item.roundId === null
                      ? null
                      : (nameOf.get(item.roundId) ?? null)
                  }
                />
              ))}
            </Group>
          ))
        )}
      </section>

      {ledger.rounds.length === 0 ? null : (
        <section
          className="flex flex-col gap-4"
          aria-labelledby="rounds-timeline"
        >
          <h2
            id="rounds-timeline"
            className="cq-title-md text-(--cq-text-primary)"
          >
            Your rounds
          </h2>
          <RoundTimeline
            rounds={ledger.rounds}
            currentRoundId={ledger.currentRoundId}
            leads={leads}
          />
        </section>
      )}
    </div>
  );
}

export function InvestorBook({ mine }: { readonly mine: MyCommitmentsDto }) {
  const [first, ...others] = mine.totals;
  const companies = new Set(
    mine.commitments
      .filter((item) => item.status === "RECEIVED")
      .map((item) => item.counterpartId),
  ).size;
  return (
    <div className="flex flex-col gap-6">
      <article className="cq-glow-card flex max-w-(--cq-layout-reading) flex-col gap-2 rounded-2xl p-5 sm:p-6">
        <h3 className="cq-body-sm text-(--cq-text-secondary)">Invested</h3>
        <p className="cq-display cq-numeric text-(--cq-text-primary)">
          {first === undefined
            ? "Nothing yet"
            : money(first.raised, first.currencyCode)}
        </p>
        {first === undefined ? null : (
          <p className="cq-body-sm cq-numeric text-(--cq-text-secondary)">
            {companies === 1
              ? "In 1 company"
              : `In ${String(companies)} companies`}
            {first.confirmed === "0"
              ? ""
              : `, ${money(first.confirmed, first.currencyCode)} agreed and not yet received`}
          </p>
        )}
        {others.map((total) => (
          <p
            key={total.currencyCode}
            className="cq-body-sm cq-numeric text-(--cq-text-primary)"
          >
            {money(total.raised, total.currencyCode)}
          </p>
        ))}
      </article>
      <ByRound commitments={mine.commitments} />
      {mine.commitments.length === 0 ? (
        <p className="cq-body-sm text-(--cq-text-secondary)">
          No commitments yet. When you and a founder agree an amount, it shows
          here.
        </p>
      ) : (
        groups(mine.commitments).map((group) => (
          <Group key={group.key} title={group.title} count={group.items.length}>
            {group.items.map((item) => (
              <CommitmentCard
                key={item.id}
                item={item}
                side="INVESTOR"
                currentRoundId={null}
                roundName={null}
              />
            ))}
          </Group>
        ))
      )}
    </div>
  );
}

/** Basis points as a percent with one decimal: 250 -> "2.5%". */
function percentOf(basisPoints: number): string {
  const tenths = Math.floor(basisPoints / 10);
  return `${String(Math.floor(tenths / 10))}.${String(tenths % 10)}%`;
}

/**
 * The investor's commitments per round (plan P8): the company, the round
 * and its status, their amount, the terms they agreed to, and an ownership
 * ESTIMATE (amount over post-money, or over a SAFE/ASA cap) with what it
 * leaves out. Pro-rata is the round's declared right; "not said" stays so.
 */
function ByRound({
  commitments,
}: {
  readonly commitments: readonly LedgerCommitmentDto[];
}) {
  const inRounds = commitments.flatMap((item) =>
    item.round === undefined ? [] : [{ item, round: item.round }],
  );
  if (inRounds.length === 0) return null;
  return (
    <section className="flex flex-col gap-3" aria-labelledby="by-round">
      <h3 id="by-round" className="cq-label text-(--cq-text-secondary)">
        By round
      </h3>
      <ul className="flex flex-col gap-2">
        {inRounds.map(({ item, round }) => {
          const terms = [
            round.valuationCap === null
              ? null
              : `${money(round.valuationCap, item.currencyCode)} cap`,
            round.discountPercent === null
              ? null
              : `${round.discountPercent}% discount`,
            round.valuation === null
              ? null
              : `${money(round.valuation.amount, item.currencyCode)} ${round.valuation.basis === "POST_MONEY" ? "post-money" : "pre-money"}`,
          ].filter((part): part is string => part !== null);
          return (
            <li
              key={item.id}
              className="flex flex-col gap-2 rounded-2xl border border-(--cq-border-subtle) bg-(--cq-surface-raised) px-4 py-4 sm:px-5"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="cq-body font-semibold text-(--cq-text-primary)">
                  {item.counterpartName}: {round.name}
                </span>
                <span className="cq-caption text-(--cq-text-secondary)">
                  {INSTRUMENT_LABELS[round.instrument]},{" "}
                  {STATUS_WORDS[round.status].toLowerCase()}
                </span>
              </div>
              <p className="cq-body-sm cq-numeric text-(--cq-text-primary)">
                Your commitment {money(item.amount, item.currencyCode)}
                {terms.length === 0 ? "" : ` · ${terms.join(" · ")}`}
              </p>
              <p className="cq-caption text-(--cq-text-secondary)">
                {round.ownershipEstimate === null
                  ? "Ownership: not enough is known to estimate it."
                  : `About ${percentOf(round.ownershipEstimate.basisPoints)} ownership, estimated from the ${round.ownershipEstimate.from === "CAP" ? "valuation cap" : "post-money valuation"}, before later dilution.`}{" "}
                {round.proRataRights === null
                  ? "Pro-rata rights: not said."
                  : `${PRO_RATA_WORDS[round.proRataRights]}.`}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** While the book loads: the round card's shape, quietly. */
export function CapitalSkeleton() {
  return (
    <div
      className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]"
      aria-busy="true"
      aria-label="Loading capital"
    >
      <div className="flex flex-col gap-4 rounded-2xl border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-6">
        <div className="h-5 w-24 rounded-md bg-(--cq-surface-strong)" />
        <div className="h-10 w-2/3 rounded-md bg-(--cq-surface-strong)" />
        <div className="h-3 rounded-full bg-(--cq-surface-strong)" />
      </div>
      <div className="h-40 rounded-2xl border border-(--cq-border-subtle) bg-(--cq-surface-raised)" />
    </div>
  );
}
