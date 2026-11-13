"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";

import {
  isMatchedRelationshipState,
  type IncomingInterestDto,
  type RelationshipStateV2,
} from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";
import { EmptyState } from "@capital-q/ui/states";

import {
  answerInterestAction,
  type AnswerActionResult,
} from "./interest-actions";
import { formatDay } from "@/components/date-format";
import { EntityAvatar } from "@/features/entity/entity-avatar";
import { useDockAvoid } from "@/features/q-dock/dock-avoid";
import { STATE_WORDS } from "@/features/relationships/relationship-words";
import { useT } from "@/features/i18n/language";
import type { ApprovalPayload } from "@/features/q/control/approval";
import { useQControl } from "@/features/q/control/q-control";

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
  qTarget = false,
}: {
  readonly item: IncomingInterestDto;
  readonly answer: AnswerPort;
  /** W5.1b: the one row Q's accept/decline acts on (the top unanswered). */
  readonly qTarget?: boolean | undefined;
  readonly onAnswered?: (() => void) | undefined;
  /** Where the relationship stands now, when known. */
  readonly currentState?: RelationshipStateV2 | undefined;
}) {
  const t = useT();
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
  const acceptRef = useRef<HTMLSpanElement>(null);
  const declineRef = useRef<HTMLSpanElement>(null);
  // Journey audit 2026-11-13 D4: the answer row is a primary action; no
  // floating Q surface (the dock, the arrival briefing) may cover it.
  const answerRow = useRef<HTMLDivElement>(null);
  useDockAvoid(answerRow);

  // Where it stands after the accept (QA run 8a1d57b9: the line read
  // "Connected... Now: interest expressed" -- the state loaded with the
  // page, from before the answer). Accepted means connected at least: a
  // state from before connecting is stale and never shown; only a later
  // move (a meeting, diligence, a pause) is.
  const nowState =
    currentState === undefined ||
    currentState === "CONNECTED" ||
    !isMatchedRelationshipState(currentState)
      ? null
      : currentState;

  let outcome: React.ReactNode;
  if (current.response === "ACCEPTED") {
    outcome = (
      <p className="cq-status-line" role="status">
        Connected. You and {name} have both agreed to connect.
        {nowState === null
          ? null
          : ` Now: ${STATE_WORDS[nowState].toLowerCase()}.`}
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
            {t("Cancel")}
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
              {t("Try again")}
            </Button>
          ) : (
            <>
              <span ref={acceptRef} className="contents">
                <Button
                  variant="primary"
                  onClick={() =>
                    setPhase({ kind: "CONFIRMING", decision: "ACCEPTED" })
                  }
                >
                  {t("Accept")}
                </Button>
              </span>
              {/* Declining is neutral: quiet, never danger, never red. */}
              <span ref={declineRef} className="contents">
                <Button
                  variant="quiet"
                  onClick={() =>
                    setPhase({ kind: "CONFIRMING", decision: "DECLINED" })
                  }
                >
                  {t("Decline")}
                </Button>
              </span>
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
      <div className="flex items-start gap-3">
        {/* The inbox names them, so it carries their logo (the name's
            scope); an answer's echo carries none, so the listed one stays. */}
        <EntityAvatar
          kind="investor"
          name={name}
          src={current.investorPhotoUrl ?? item.investorPhotoUrl ?? null}
          size="md"
          decorative
        />
        <div className="flex min-w-0 flex-col gap-0.5">
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
      </div>
      <div ref={answerRow} data-dock-avoid>
        {outcome}
      </div>
      {qTarget &&
      current.response !== "ACCEPTED" &&
      current.response !== "DECLINED" ? (
        <InterestQActions
          name={name}
          interestId={current.interestId}
          acceptRef={acceptRef}
          declineRef={declineRef}
          answer={answer}
          onDone={(interest) => {
            setCurrent(interest);
            setPhase({ kind: "IDLE" });
            onAnswered?.();
          }}
        />
      ) : null}
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
  const t = useT();
  const qTargetId =
    items.find(
      (item) => item.response !== "ACCEPTED" && item.response !== "DECLINED",
    )?.interestId ?? null;
  if (items.length === 0) {
    return (
      <EmptyState
        title={t("No investor interest yet.")}
        description={t(
          "When an investor expresses interest in your company, it appears here for you to accept or decline.",
        )}
      />
    );
  }
  return (
    <ul
      aria-label={t("Investor interest in your company")}
      className="cq-panel-rows flex flex-col"
    >
      {items.map((item) => (
        <Row
          key={item.interestId}
          item={item}
          answer={answer}
          onAnswered={onAnswered}
          currentState={currentStates?.get(item.investorOrganisationId)}
          qTarget={item.interestId === qTargetId}
        />
      ))}
    </ul>
  );
}

/**
 * W5.1b: accepting or declining is outward (the investor sees it), so Q
 * may do it only as APPROVAL: on the person's approval of exactly which
 * investor and which answer, once, under the approval's key.
 */
function InterestQActions({
  name,
  interestId,
  acceptRef,
  declineRef,
  answer,
  onDone,
}: {
  readonly name: string;
  readonly interestId: string;
  readonly acceptRef: React.RefObject<HTMLSpanElement | null>;
  readonly declineRef: React.RefObject<HTMLSpanElement | null>;
  readonly answer: AnswerPort;
  readonly onDone: (interest: IncomingInterestDto) => void;
}) {
  const run =
    (decision: "ACCEPTED" | "DECLINED") =>
    async (_payload: ApprovalPayload, key: string) => {
      try {
        const result = await answer({
          interestId,
          decision,
          idempotencyKey: `answer:${key}`,
        });
        if (!result.ok) return "FAILED" as const;
        onDone(result.value.interest);
        return "DONE" as const;
      } catch {
        return "FAILED" as const;
      }
    };
  useQControl({
    id: "button.interest-accept",
    kind: "BUTTON",
    ref: acceptRef,
    approval: "APPROVAL",
    action: {
      id: "button.interest-accept",
      summary: () =>
        `Accept ${name}'s interest: both sides will have agreed to connect. It is not an investment.`,
      prepare: () => ({ investor: name, answer: "Accept" }),
      execute: run("ACCEPTED"),
    },
  });
  useQControl({
    id: "button.interest-decline",
    kind: "BUTTON",
    ref: declineRef,
    approval: "APPROVAL",
    action: {
      id: "button.interest-decline",
      summary: () =>
        `Decline ${name}'s interest: they will see it was not taken forward. No reason is shared.`,
      prepare: () => ({ investor: name, answer: "Decline" }),
      execute: run("DECLINED"),
    },
  });
  return null;
}
