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

import { EntityAvatar } from "@/features/entity/entity-avatar";
import { UnknownValue } from "@/features/relationships/crm-kit";
import { serverT } from "@/features/i18n/server";

import { CommitmentCard } from "./commitment-card";
import { CommitmentLadder, LADDER, ladderStep } from "./commitment-ladder";
import { CommitmentStepButton, RecordAmountButton } from "./commitment-sheet";
import { isZero, money, moneyList, totalsByCurrency } from "./money";
import { OpenRound, type RoundDraft } from "./open-round";
import { RoundCard, RoundTimeline, TotalCard } from "./round-card";
import type { LeadOption } from "./round-terms-fields";
// From round-labels, not round-card: round-card is a client module, and this
// server component calls the function.
import { instrumentLabel } from "./round-labels";
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
      {/* One card takes the column's width, not half of it (live check
          2026-10-16: the card and the mandate list sat at different widths). */}
      <div className={count > 1 ? "grid gap-3 md:grid-cols-2" : "grid gap-3"}>
        {children}
      </div>
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
    ? { name: "", target: { amount: "", currency: "USD" }, instrument: null }
    : {
        name: stageName(objective.targetStage),
        target: {
          amount: objective.target.amount,
          currency: objective.target.currency,
        },
        // Only what they stated; otherwise not stated, never a default SAFE.
        instrument: INSTRUMENT_OF[objective.instrumentCode ?? ""] ?? null,
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
        <section
          className="flex flex-col gap-4"
          aria-label="Rounds"
          data-qp-anchor="fdr.08.capital.round"
        >
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
          data-qp-anchor="fdr.08.capital.round"
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

      <section
        className="flex flex-col gap-6"
        aria-labelledby="commitments"
        data-qp-anchor="fdr.08.capital.commitments"
      >
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
          data-qp-anchor="fdr.08.capital.rounds"
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

/** An invested company with no amount recorded (no commitment at all). */
export type UnrecordedInvestment = {
  readonly relationshipId: string;
  readonly companyId: string;
  readonly name: string;
  readonly since: string;
};

const LEVEL_WORDS: Readonly<Record<LedgerCommitmentDto["level"], string>> = {
  SOFT: "Soft",
  FIRM: "Firm",
  INVESTED: "Invested",
};

/**
 * The investor's book (design 2026-10-20, "Mandate beside the book"): three
 * totals kept apart (received, committed but not received, unknown), then
 * one row per commitment with its ladder, its amount and this side's one
 * next step. Received is only what the company confirmed; committed money
 * is never added in; an amount not recorded says so and can be recorded.
 */
export async function InvestorBook({
  mine,
  unrecorded = [],
}: {
  readonly mine: MyCommitmentsDto;
  readonly unrecorded?: readonly UnrecordedInvestment[];
}) {
  const t = await serverT();
  const received = mine.totals.filter((total) => !isZero(total.raised));
  const committed = mine.totals
    .map((total) => ({
      currency: total.currencyCode,
      amount: totalsByCurrency([
        { amount: total.confirmed, currency: total.currencyCode },
        { amount: total.pledged, currency: total.currencyCode },
      ])[0]?.amount ?? "0",
    }))
    .filter((total) => !isZero(total.amount));
  const open = mine.commitments.filter((item) => item.status !== "RECEIVED");
  const openWords = [
    ...new Set(
      open.map((item) => {
        const step = ladderStep(item);
        return step === null ? "" : (LADDER[step] ?? "").toLowerCase();
      }),
    ),
  ].filter((word) => word !== "");
  const order = (item: LedgerCommitmentDto) =>
    item.next !== null ? 0 : item.status === "RECEIVED" ? 2 : 1;
  const rows = mine.commitments.toSorted(
    (a, b) => order(a) - order(b) || Date.parse(b.at) - Date.parse(a.at),
  );
  const actionable = rows.filter((item) => item.next !== null);
  const rest = rows.filter((item) => item.next === null);
  const cell = "flex min-w-0 flex-col gap-1 px-[18px] py-4";
  const words = (english: string) => t(english);
  return (
    <div className="flex flex-col gap-5">
      <div
        className="grid overflow-hidden rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) sm:grid-cols-3 [&>div+div]:border-t [&>div+div]:border-(--cq-border-subtle) sm:[&>div+div]:border-t-0 sm:[&>div+div]:border-s"
        data-capital-totals
      >
        <div className={cell}>
          <span className="text-xs text-(--cq-text-tertiary)">
            {t("Received by companies")}
          </span>
          <b className="cq-numeric text-[22px] font-semibold tracking-[-0.02em] text-(--cq-text-primary)">
            {received.length === 0
              ? t("Nothing received yet")
              : moneyList(
                  received.map((total) => ({
                    amount: total.raised,
                    currency: total.currencyCode,
                  })),
                )}
          </b>
          <span className="text-xs text-(--cq-text-tertiary)">
            {t("Confirmed by both sides")}
          </span>
        </div>
        <div className={cell}>
          <span className="text-xs text-(--cq-text-tertiary)">
            {t("Committed, not yet received")}
          </span>
          <b className="cq-numeric text-[22px] font-semibold tracking-[-0.02em] text-(--cq-text-primary)">
            {committed.length === 0 ? t("None") : moneyList(committed)}
          </b>
          <span className="text-xs text-(--cq-text-tertiary)">
            {openWords.length === 0
              ? t("Nothing waiting")
              : openWords.map((word) => t(word)).join(", ")}
          </span>
        </div>
        <div className={cell}>
          <span className="text-xs text-(--cq-text-tertiary)">
            {t("Unknown")}
          </span>
          <b className="cq-numeric text-[22px] font-semibold tracking-[-0.02em] text-(--cq-text-primary)">
            {unrecorded.length === 0
              ? t("None")
              : unrecorded.length === 1
                ? t("1 amount")
                : t(`${String(unrecorded.length)} amounts`)}
          </b>
          <span className="text-xs text-(--cq-text-tertiary)">
            {unrecorded.length === 0
              ? t("Every amount is recorded")
              : t(
                  `${unrecorded.map((entry) => entry.name).join(", ")}, not recorded`,
                )}
          </span>
        </div>
      </div>

      {rows.length === 0 && unrecorded.length === 0 ? (
        <p className="rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) px-[18px] py-4 text-sm text-(--cq-text-secondary)">
          {t(
            "No commitments yet. When you and a founder agree an amount, it shows here.",
          )}
        </p>
      ) : (
        <ul
          aria-label={t("My commitments")}
          className="flex flex-col rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) px-[18px] py-1"
        >
          {actionable.map((item) => (
            <BookRow key={item.id} item={item} words={words} />
          ))}
          {unrecorded.map((entry) => (
            <li
              key={entry.relationshipId}
              className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 border-t border-(--cq-border-subtle) py-3.5 first:border-t-0 sm:grid-cols-[auto_minmax(0,1fr)_auto]"
              data-book-row="unrecorded"
            >
              <EntityAvatar
                kind="company"
                name={entry.name}
                companyId={entry.companyId}
                size={28}
                decorative
              />
              <div className="min-w-0">
                <b className="font-semibold text-(--cq-text-primary)">
                  {entry.name}
                </b>{" "}
                <span className="text-xs text-(--cq-text-tertiary)">
                  {t("Invested, amount not recorded")}
                </span>
                <div className="mt-2">
                  <CommitmentLadder step={null} words={words} />
                </div>
              </div>
              <div className="col-span-2 flex items-center justify-between gap-1.5 sm:col-span-1 sm:flex-col sm:items-end">
                <UnknownValue>{t("Not recorded")}</UnknownValue>
                <RecordAmountButton
                  relationshipId={entry.relationshipId}
                  name={entry.name}
                  companyId={entry.companyId}
                  since={entry.since}
                  label="Confirm the amount"
                />
              </div>
            </li>
          ))}
          {rest.map((item) => (
            <BookRow key={item.id} item={item} words={words} />
          ))}
        </ul>
      )}
      <ByRound commitments={mine.commitments} />
    </div>
  );
}

function BookRow({
  item,
  words,
}: {
  readonly item: LedgerCommitmentDto;
  readonly words: (english: string) => string;
}) {
  const waiting =
    item.next !== null
      ? null
      : item.status === "STATED"
        ? `Waiting for ${item.counterpartName} to confirm`
        : item.status === "TRANSFER_SENT"
          ? `Waiting for ${item.counterpartName} to confirm receipt`
          : null;
  return (
    <li
      className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 border-t border-(--cq-border-subtle) py-3.5 first:border-t-0 sm:grid-cols-[auto_minmax(0,1fr)_auto]"
      data-book-row={item.status}
      data-commitment={item.status}
    >
      <EntityAvatar
        kind="company"
        name={item.counterpartName}
        companyId={item.counterpartId}
        size={28}
        decorative
      />
      <div className="min-w-0">
        <b className="font-semibold text-(--cq-text-primary)">
          {item.counterpartName}
        </b>{" "}
        <span className="text-xs text-(--cq-text-tertiary)">
          {item.round === undefined
            ? words(LEVEL_WORDS[item.level])
            : instrumentLabel(item.round.instrument)}
        </span>
        <div className="mt-2">
          <CommitmentLadder step={ladderStep(item)} words={words} />
        </div>
      </div>
      <div className="col-span-2 flex items-center justify-between gap-1.5 sm:col-span-1 sm:flex-col sm:items-end">
        <span className="cq-numeric font-semibold text-(--cq-text-primary)">
          {money(item.amount, item.currencyCode)}
        </span>
        {item.next !== null ? (
          <CommitmentStepButton
            item={item}
            side="INVESTOR"
            currentRoundId={null}
          />
        ) : waiting !== null ? (
          <span className="text-xs text-(--cq-text-tertiary)">
            {words(waiting)}
          </span>
        ) : null}
      </div>
    </li>
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
                  {instrumentLabel(round.instrument)},{" "}
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
