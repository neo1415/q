"use client";

import { useCallback, useRef, useState } from "react";

import type { InterestDto } from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";

import {
  expressInterestAction,
  type InterestActionResult,
} from "./interest-actions";

/**
 * Express Interest (CQ-NET-010; doc 17 §70, doc 19 §2.5).
 *
 * Server-confirmed, never optimistic. Save and Pass flip on tap because a
 * wrong guess costs nothing; an interest tells a company's founders that
 * this organisation would like to explore it, so the screen says "sent"
 * only after the server has recorded it. Before that it asks once, in
 * words, what the act means — and that it is not a commitment.
 *
 * States: idle -> confirming -> sending -> sent | refused. A refusal says
 * why and, when a retry could help, keeps the same idempotency key so a
 * response lost on the way back cannot become a second interest.
 */

type Phase =
  | { readonly kind: "IDLE" }
  | { readonly kind: "CONFIRMING" }
  | { readonly kind: "SENDING" }
  | {
      readonly kind: "SENT";
      readonly interest: InterestDto;
      readonly alreadySent: boolean;
    }
  | {
      readonly kind: "REFUSED";
      readonly message: string;
      readonly retryable: boolean;
    };

export type ExpressInterestPort = (input: {
  readonly companyId: string;
  readonly surface: "RECOMMENDATION_FEED" | "COMPANY_PROFILE";
  readonly idempotencyKey: string;
}) => Promise<InterestActionResult>;

function newIdempotencyKey(): string {
  return `interest:${crypto.randomUUID()}`;
}

export function ExpressInterest({
  companyId,
  companyName,
  surface,
  initialInterest = null,
  express = expressInterestAction,
  onConfirmed,
  startConfirming = false,
}: {
  readonly companyId: string;
  readonly companyName: string;
  readonly surface: "RECOMMENDATION_FEED" | "COMPANY_PROFILE";
  /** The organisation's interest as the server last reported it, when known. */
  readonly initialInterest?: InterestDto | null;
  readonly express?: ExpressInterestPort;
  /** Called once the server has confirmed the interest (CQ-WEB-030). */
  readonly onConfirmed?: (() => void) | undefined;
  /**
   * Open at the confirmation step: the feed's rail asked for it. The
   * server still confirms nothing until the person confirms here.
   */
  readonly startConfirming?: boolean | undefined;
}) {
  const [phase, setPhase] = useState<Phase>(
    initialInterest === null
      ? { kind: startConfirming ? "CONFIRMING" : "IDLE" }
      : { kind: "SENT", interest: initialInterest, alreadySent: true },
  );
  // One key per intended expression, reused across retries of it.
  const key = useRef<string | null>(null);

  const send = useCallback(async () => {
    key.current ??= newIdempotencyKey();
    setPhase({ kind: "SENDING" });
    let result: InterestActionResult;
    try {
      result = await express({
        companyId,
        surface,
        idempotencyKey: key.current,
      });
    } catch {
      result = {
        ok: false,
        message: "Your interest was not sent. Try again.",
        retryable: true,
      };
    }
    if (result.ok) {
      setPhase({
        kind: "SENT",
        interest: result.value.interest,
        alreadySent: result.value.deduplicated,
      });
      onConfirmed?.();
      return;
    }
    // A refusal that will not change on retry closes this attempt; the
    // next click is a new intention with a new key.
    if (!result.retryable) key.current = null;
    setPhase({
      kind: "REFUSED",
      message: result.message,
      retryable: result.retryable,
    });
  }, [companyId, express, surface, onConfirmed]);

  switch (phase.kind) {
    case "IDLE":
      return (
        <Button
          variant="secondary"
          onClick={() => setPhase({ kind: "CONFIRMING" })}
        >
          Express interest
        </Button>
      );

    case "CONFIRMING":
      return (
        <div
          role="group"
          aria-label={`Express interest in ${companyName}`}
          className="flex w-full flex-col gap-2"
        >
          <p className="cq-body-sm text-(--cq-text-secondary)">
            Express interest in {companyName}? This tells its founders your
            organisation would like to explore the company. It is not a
            commitment to invest.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" onClick={() => void send()}>
              Express interest
            </Button>
            <Button variant="quiet" onClick={() => setPhase({ kind: "IDLE" })}>
              Cancel
            </Button>
          </div>
        </div>
      );

    case "SENDING":
      return (
        <Button variant="secondary" disabled aria-busy="true">
          Sending interest…
        </Button>
      );

    case "SENT":
      // The company's answer, as the server reported it (CQ-NET-011).
      // Institutional words only: no celebration, and a decline is said
      // plainly without a reason, because none is recorded.
      return (
        <p className="cq-status-line" role="status">
          {phase.interest.response === "ACCEPTED"
            ? `Connected with ${companyName}. Both sides have agreed to connect.`
            : phase.interest.response === "DECLINED"
              ? `${companyName} has not taken this forward.`
              : phase.alreadySent
                ? `Your organisation has already expressed interest in ${companyName}.`
                : `Interest expressed in ${companyName}.`}
        </p>
      );

    case "REFUSED":
      return (
        <div className="flex flex-wrap items-center gap-2" role="status">
          <p className="cq-status-line">{phase.message}</p>
          {phase.retryable ? (
            <Button variant="secondary" onClick={() => void send()}>
              Try again
            </Button>
          ) : null}
        </div>
      );
  }
}
