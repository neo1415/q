"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";

import type {
  ConnectionRequestAnswerDto,
  FitCompanyDto,
  IncomingConnectionRequestDto,
  QViewDto,
} from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";
import { EmptyState } from "@capital-q/ui/states";

import { CompanyRequestCard } from "@/features/fit/company-request-card";
import { compareByFit } from "@/features/fit/fit-words";
import type { QViewPort } from "@/features/fit/q-view-note";

import {
  answerConnectionRequestAction,
  type ConnectionActionResult,
} from "./connection-actions";

/**
 * Company requests (ADR 0023; renamed by brief B4, ADR 0052): the
 * investor organisation's inbox of companies' Connection Requests. Each
 * card is a company that asked to connect, with its fit with the
 * investor's own mandate, the top reasons and the main mismatch, Q's view
 * beside it, and the profile one tap away. Accept and Decline are
 * server-confirmed and ask once, in words, what each answer means. Decline
 * is neutral: quiet, never red, no reason recorded.
 */

export type AnswerConnectionPort = (input: {
  readonly interestId: string;
  readonly decision: "ACCEPTED" | "DECLINED";
  readonly idempotencyKey: string;
}) => Promise<ConnectionActionResult<ConnectionRequestAnswerDto>>;

type Decision = "ACCEPTED" | "DECLINED";
type Phase =
  | { readonly kind: "IDLE" }
  | { readonly kind: "CONFIRMING"; readonly decision: Decision }
  | { readonly kind: "SENDING"; readonly decision: Decision }
  | {
      readonly kind: "REFUSED";
      readonly decision: Decision;
      readonly message: string;
      readonly retryable: boolean;
    };

function Row({
  item,
  answer,
  alreadyMatched,
  answerable,
  fit,
  qView,
  qViewPort,
  now,
  waitingLongest,
  openFit,
}: {
  readonly openFit: boolean;
  readonly item: IncomingConnectionRequestDto;
  readonly answer: AnswerConnectionPort;
  readonly alreadyMatched: boolean;
  readonly answerable: boolean;
  readonly fit: FitCompanyDto | null;
  readonly qView: QViewDto | null | undefined;
  readonly qViewPort: QViewPort | undefined;
  readonly now: number;
  readonly waitingLongest: boolean;
}) {
  const [current, setCurrent] = useState(item);
  const [phase, setPhase] = useState<Phase>({ kind: "IDLE" });
  const key = useRef<string | null>(null);

  const send = useCallback(
    async (decision: Decision) => {
      key.current ??= `answer:${crypto.randomUUID()}`;
      setPhase({ kind: "SENDING", decision });
      let result: ConnectionActionResult<ConnectionRequestAnswerDto>;
      try {
        result = await answer({
          interestId: current.interestId,
          decision,
          idempotencyKey: key.current,
        });
      } catch {
        result = {
          ok: false,
          message: "Your answer was not recorded. Try again.",
          retryable: true,
        };
      }
      if (result.ok) {
        setCurrent(result.value.request);
        setPhase({ kind: "IDLE" });
        return;
      }
      if (!result.retryable) key.current = null;
      setPhase({
        kind: "REFUSED",
        decision,
        message: result.message,
        retryable: result.retryable,
      });
    },
    [answer, current.interestId],
  );

  const name = current.companyName;
  let outcome: React.ReactNode;
  if (current.response === "ACCEPTED") {
    outcome = (
      <div className="flex flex-wrap items-center gap-3">
        <p className="cq-status-line" role="status">
          Connected. You and {name} have both agreed to connect.
        </p>
        <Link
          href={`/relationships/company/${current.companyId}`}
          className="cq-body-sm text-(--cq-text-primary) underline underline-offset-4"
        >
          Open the relationship
        </Link>
      </div>
    );
  } else if (alreadyMatched) {
    // Messy real use: the pair matched another way (both expressed
    // interest) while this request stayed open. Accepting would add
    // nothing; the relationship is the one place to act.
    outcome = (
      <div className="flex flex-wrap items-center gap-3">
        <p className="cq-status-line" role="status">
          You&apos;re already connected with {name}; nothing to answer here.
        </p>
        <Link
          href={`/relationships/company/${current.companyId}`}
          className="cq-body-sm text-(--cq-text-primary) underline underline-offset-4"
        >
          Open the relationship
        </Link>
      </div>
    );
  } else if (current.response === "DECLINED") {
    outcome = (
      <p className="cq-status-line" role="status">
        Declined. {name} will see that this has not been taken forward; no
        reason is shared.
      </p>
    );
  } else if (phase.kind === "CONFIRMING") {
    outcome = (
      <div
        role="group"
        aria-label={
          phase.decision === "ACCEPTED"
            ? `Accept ${name}'s request`
            : `Decline ${name}'s request`
        }
        className="flex flex-col gap-2"
      >
        <p className="cq-body-sm text-(--cq-text-secondary)">
          {phase.decision === "ACCEPTED"
            ? `Accept ${name}'s request? You will both have agreed to connect, and ${name} will see that. It is not an investment.`
            : `Decline ${name}'s request? ${name} will see that you have not taken it forward. No reason is recorded or shared.`}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={phase.decision === "ACCEPTED" ? "primary" : "secondary"}
            onClick={() => void send(phase.decision)}
          >
            {phase.decision === "ACCEPTED" ? "Accept" : "Decline"}
          </Button>
          <Button variant="quiet" onClick={() => setPhase({ kind: "IDLE" })}>
            Cancel
          </Button>
        </div>
      </div>
    );
  } else if (phase.kind === "SENDING") {
    outcome = (
      <Button variant="secondary" disabled aria-busy="true">
        {phase.decision === "ACCEPTED" ? "Accepting…" : "Declining…"}
      </Button>
    );
  } else {
    outcome = (
      <div className="flex flex-col gap-2">
        {phase.kind === "REFUSED" ? (
          <p className="cq-status-line" role="status">
            {phase.message}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          {phase.kind === "REFUSED" && phase.retryable ? (
            <Button
              variant="secondary"
              onClick={() => void send(phase.decision)}
            >
              Try again
            </Button>
          ) : (
            <>
              <Button
                variant="primary"
                size="compact"
                disabled={!answerable}
                onClick={() =>
                  setPhase({ kind: "CONFIRMING", decision: "ACCEPTED" })
                }
              >
                Accept
              </Button>
              <Button
                variant="secondary"
                size="compact"
                disabled={!answerable}
                onClick={() =>
                  setPhase({ kind: "CONFIRMING", decision: "DECLINED" })
                }
              >
                Decline
              </Button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <li data-connection-request-id={current.interestId}>
      <CompanyRequestCard
        companyId={current.companyId}
        name={name}
        requestedAt={current.requestedAt}
        fit={fit}
        qView={qView}
        qViewPort={qViewPort}
        now={now}
        waitingLongest={waitingLongest}
        outcome={outcome}
        openFit={openFit}
      />
    </li>
  );
}

const NONE: ReadonlySet<string> = new Set();
const NO_FITS: ReadonlyMap<string, FitCompanyDto> = new Map();

type Sort = "BEST_FIT" | "NEWEST" | "WAITING_LONGEST";
const SORTS: readonly (readonly [Sort, string])[] = [
  ["BEST_FIT", "Best fit"],
  ["NEWEST", "Newest"],
  ["WAITING_LONGEST", "Waiting longest"],
];

export function ConnectionRequestsInbox({
  items,
  answer = answerConnectionRequestAction,
  matchedCompanyIds = NONE,
  fits = NO_FITS,
  qViews,
  qViewPort,
  answerable = true,
  now = readClock(),
  openFitFor,
}: {
  /** Design review: open this company's fit breakdown at once. */
  readonly openFitFor?: string | undefined;
  readonly items: readonly IncomingConnectionRequestDto[];
  readonly answer?: AnswerConnectionPort;
  /** Companies this organisation is already matched with. */
  readonly matchedCompanyIds?: ReadonlySet<string>;
  /** Fit with the reader's own mandate, by company id (ADR 0052). */
  readonly fits?: ReadonlyMap<string, FitCompanyDto>;
  /** Q's views already in hand (fixtures); absent, each card asks after it renders. */
  readonly qViews?: ReadonlyMap<string, QViewDto | null> | undefined;
  readonly qViewPort?: QViewPort | undefined;
  /** False for a member whose role does not answer requests: read only. */
  readonly answerable?: boolean;
  readonly now?: number;
}) {
  const [sort, setSort] = useState<Sort>("BEST_FIT");
  if (items.length === 0) {
    return (
      <EmptyState
        title="No company requests yet."
        description="When a founder asks to connect, their company shows up here with how well it fits your mandate. Who can ask follows the choice you set under Visibility."
      />
    );
  }
  const pending = items.filter((i) => i.response === "PENDING");
  const oldestPending = pending.toSorted((a, b) =>
    a.requestedAt.localeCompare(b.requestedAt),
  )[0];
  const time = (iso: string) => new Date(iso).getTime();
  const sorted = items.toSorted((a, b) => {
    if (sort === "NEWEST") return time(b.requestedAt) - time(a.requestedAt);
    if (sort === "WAITING_LONGEST") {
      const open = (i: IncomingConnectionRequestDto) =>
        i.response === "PENDING" ? 0 : 1;
      return open(a) - open(b) || time(a.requestedAt) - time(b.requestedAt);
    }
    return (
      compareByFit(
        fits.get(a.companyId)?.profile ?? null,
        fits.get(b.companyId)?.profile ?? null,
      ) || time(b.requestedAt) - time(a.requestedAt)
    );
  });
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          role="group"
          aria-label="Sort"
          className="flex gap-2 overflow-x-auto py-0.5"
        >
          {SORTS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={sort === value}
              onClick={() => setSort(value)}
              className="inline-flex min-h-11 items-center rounded-full border border-(--cq-border) bg-(--cq-surface-raised) px-3.5 text-sm whitespace-nowrap text-(--cq-text-secondary) aria-pressed:border-(--cq-text-primary) aria-pressed:bg-(--cq-text-primary) aria-pressed:text-(--cq-canvas) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)"
            >
              {label}
            </button>
          ))}
        </div>
        <span className="cq-caption text-(--cq-text-secondary)">
          {pending.length} waiting
        </span>
      </div>
      <ul
        aria-label="Companies that asked to connect"
        className="grid gap-3 min-[1200px]:grid-cols-2 min-[1200px]:gap-4"
      >
        {sorted.map((item) => (
          <Row
            key={item.interestId}
            item={item}
            answer={answer}
            answerable={answerable}
            alreadyMatched={
              item.response !== "ACCEPTED" &&
              item.response !== "DECLINED" &&
              matchedCompanyIds.has(item.companyId)
            }
            fit={fits.get(item.companyId) ?? null}
            qView={
              qViews === undefined
                ? undefined
                : (qViews.get(item.companyId) ?? null)
            }
            qViewPort={qViewPort}
            now={now}
            openFit={openFitFor === item.companyId}
            waitingLongest={
              pending.length > 1 &&
              oldestPending?.interestId === item.interestId
            }
          />
        ))}
      </ul>
    </div>
  );
}

function readClock(): number {
  return Date.now();
}
