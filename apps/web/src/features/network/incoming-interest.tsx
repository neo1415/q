"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";

import type {
  IncomingInterestDto,
  RelationshipStateV2,
} from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";
import { EmptyState } from "@capital-q/ui/states";

import {
  answerInterestAction,
  type AnswerActionResult,
} from "./interest-actions";
import { formatDay } from "@/components/date-format";
import { STATE_WORDS } from "@/features/relationships/relationship-words";

/**
 * The founder's inbox of investor interest (CQ-NET-011; doc 17 §83-§86).
 *
 * Each row is an investor organisation that told the company it would
 * like to explore it, and the company's answer. Accept and Decline are
 * server-confirmed: a row says "connected" or "declined" only once the
 * server has recorded it, and asks once, in words, what each answer means.
 *
 * Deliberately absent: a score, a match percentage, a celebration ("It's
 * a match!" is rejected by doc 17 §85), a reason field on decline, and any
 * message box -- messaging is not part of this (CQ-COMM-001).
 */

export type AnswerPort = (input: {
  readonly interestId: string;
  readonly decision: "ACCEPTED" | "DECLINED";
  readonly idempotencyKey: string;
}) => Promise<AnswerActionResult>;

type RowPhase =
  | { readonly kind: "IDLE" }
  | {
      readonly kind: "CONFIRMING";
      readonly decision: "ACCEPTED" | "DECLINED";
    }
  | { readonly kind: "SENDING"; readonly decision: "ACCEPTED" | "DECLINED" }
  | {
      readonly kind: "REFUSED";
      readonly decision: "ACCEPTED" | "DECLINED";
      readonly message: string;
      readonly retryable: boolean;
    };

const TYPE_LABELS: Readonly<Record<string, string>> = {
  ANGEL: "Angel",
  VC: "Venture capital",
  FAMILY_OFFICE: "Family office",
  CVC: "Corporate venture",
  SYNDICATE: "Syndicate",
  ACCELERATOR: "Accelerator",
  SCOUT: "Scout",
  INSTITUTIONAL: "Institutional",
  OTHER: "Investor",
};

const when = formatDay;

function Row({
  item,
  answer,
  onAnswered,
  currentState,
}: {
  readonly item: IncomingInterestDto;
  readonly answer: AnswerPort;
  readonly onAnswered?: (() => void) | undefined;
  /** Where the relationship stands now, when known. */
  readonly currentState?: RelationshipStateV2 | undefined;
}) {
  const [current, setCurrent] = useState(item);
  const [phase, setPhase] = useState<RowPhase>({ kind: "IDLE" });
  // One key per intended answer, reused across retries of it.
  const key = useRef<string | null>(null);

  const send = useCallback(
    async (decision: "ACCEPTED" | "DECLINED") => {
      key.current ??= `answer:${crypto.randomUUID()}`;
      setPhase({ kind: "SENDING", decision });
      let result: AnswerActionResult;
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
        setCurrent(result.value.interest);
        setPhase({ kind: "IDLE" });
        onAnswered?.();
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
    [answer, current.interestId, onAnswered],
  );

  const name = current.investorName;

  let outcome: React.ReactNode;
  if (current.response === "ACCEPTED") {
    outcome = (
      <p className="cq-status-line" role="status">
        Connected. You and {name} have both agreed to connect.
        {currentState === undefined || currentState === "CONNECTED"
          ? null
          : ` Now: ${STATE_WORDS[currentState].toLowerCase()}.`}
      </p>
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
            ? `Accept ${name}'s interest`
            : `Decline ${name}'s interest`
        }
        className="flex flex-col gap-2"
      >
        <p className="cq-body-sm text-(--cq-text-secondary)">
          {phase.decision === "ACCEPTED"
            ? `Accept ${name}'s interest? Both sides will have agreed to connect, and ${name} will see that. It is not an investment.`
            : `Decline ${name}'s interest? ${name} will see that your company has not taken this forward. No reason is recorded or shared.`}
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
                onClick={() =>
                  setPhase({ kind: "CONFIRMING", decision: "ACCEPTED" })
                }
              >
                Accept
              </Button>
              {/* Declining is neutral: quiet, never danger, never red. */}
              <Button
                variant="quiet"
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
    <li
      className="flex flex-col gap-2 py-4"
      data-interest-id={current.interestId}
    >
      <div className="flex flex-col gap-0.5">
        <Link
          href={`/relationships/investor/${current.investorOrganisationId}`}
          className="cq-title-sm text-(--cq-text-primary) underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)"
        >
          {name}
        </Link>
        <p className="cq-caption text-(--cq-text-tertiary)">
          {TYPE_LABELS[current.investorType] ?? current.investorType} ·
          expressed interest {when(current.expressedAt)}
        </p>
      </div>
      {outcome}
    </li>
  );
}

export function IncomingInterest({
  items,
  answer = answerInterestAction,
  onAnswered,
  currentStates,
}: {
  readonly items: readonly IncomingInterestDto[];
  readonly answer?: AnswerPort;
  /** Investor organisation id → where that relationship stands now. */
  readonly currentStates?: ReadonlyMap<string, RelationshipStateV2> | undefined;
  /** Called once the server has recorded an answer (CQ-WEB-030). */
  readonly onAnswered?: (() => void) | undefined;
}) {
  if (items.length === 0) {
    return (
      <EmptyState
        title="No investor interest yet."
        description="When an investor organisation expresses interest in your company, it appears here for you to accept or decline."
      />
    );
  }
  return (
    <ul
      aria-label="Investor interest in your company"
      className="cq-panel-rows flex flex-col"
    >
      {items.map((item) => (
        <Row
          key={item.interestId}
          item={item}
          answer={answer}
          onAnswered={onAnswered}
          currentState={currentStates?.get(item.investorOrganisationId)}
        />
      ))}
    </ul>
  );
}
