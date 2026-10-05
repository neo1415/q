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
import { PastRound, RoundCard, TotalCard } from "./round-card";

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
}: {
  readonly ledger: CapitalLedgerDto;
  readonly draft: RoundDraft;
}) {
  const current =
    ledger.rounds.find((round) => round.id === ledger.currentRoundId) ?? null;
  const others = ledger.rounds.filter((round) => round.id !== current?.id);
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
              <OpenRound draft={draft} prominent />
            </div>
          </div>
        </section>
      ) : (
        <section
          className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]"
          aria-label="Rounds"
        >
          <RoundCard round={current} />
          <TotalCard totals={ledger.totals} rounds={ledger.rounds} />
          <div className="lg:col-span-2">
            <OpenRound draft={{ ...draft, name: "" }} />
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

      {others.length === 0 ? null : (
        <section className="flex flex-col gap-3" aria-labelledby="rounds-past">
          <h2 id="rounds-past" className="cq-title-md text-(--cq-text-primary)">
            Other rounds
          </h2>
          <ul className="flex flex-col gap-2">
            {others.map((round) => (
              <PastRound key={round.id} round={round} />
            ))}
          </ul>
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
