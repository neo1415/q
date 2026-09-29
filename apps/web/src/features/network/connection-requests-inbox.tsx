"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";

import type {
  ConnectionRequestAnswerDto,
  IncomingConnectionRequestDto,
} from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";
import { EmptyState } from "@capital-q/ui/states";

import { formatDay } from "@/components/date-format";

import {
  answerConnectionRequestAction,
  type ConnectionActionResult,
} from "./connection-actions";

/**
 * The investor organisation's inbox of founders' Connection Requests
 * (ADR 0023). Each row is a company that asked to connect; its page is
 * one tap away, with what it shares with investors. Accept and Decline are
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
}: {
  readonly item: IncomingConnectionRequestDto;
  readonly answer: AnswerConnectionPort;
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
                onClick={() =>
                  setPhase({ kind: "CONFIRMING", decision: "ACCEPTED" })
                }
              >
                Accept
              </Button>
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
      data-connection-request-id={current.interestId}
    >
      <div className="flex flex-col gap-0.5">
        <Link
          href={`/company/${current.companyId}`}
          className="cq-title-sm text-(--cq-text-primary) underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)"
        >
          {name}
        </Link>
        <p className="cq-caption text-(--cq-text-tertiary)">
          Asked to connect {formatDay(current.requestedAt)}
        </p>
      </div>
      {outcome}
    </li>
  );
}

export function ConnectionRequestsInbox({
  items,
  answer = answerConnectionRequestAction,
}: {
  readonly items: readonly IncomingConnectionRequestDto[];
  readonly answer?: AnswerConnectionPort;
}) {
  if (items.length === 0) {
    return (
      <EmptyState
        title="No requests from founders yet."
        description="When a founder asks to connect, their company appears here for you to accept or decline. Who can ask follows the choice you set under Visibility."
      />
    );
  }
  return (
    <ul
      aria-label="Founders who asked to connect"
      className="cq-panel-rows flex flex-col"
    >
      {items.map((item) => (
        <Row key={item.interestId} item={item} answer={answer} />
      ))}
    </ul>
  );
}
