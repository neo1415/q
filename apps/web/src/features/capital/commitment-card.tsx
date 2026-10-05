"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import type { LedgerCommitmentDto } from "@capital-q/contracts";
import { ArrowUpRight, Check, Handshake, Mic } from "@capital-q/ui/icons";
import { Button } from "@capital-q/ui/button";
import { Input } from "@capital-q/ui/input";

import {
  confirmAmountAction,
  confirmReceivedAction,
  markSentAction,
  notRightAction,
  type CapitalResult,
} from "./capital-actions";
import { money } from "./money";

/**
 * One commitment, as a card (2026-10-04): who, how much, where it stands,
 * and this side's one next step. A founder's Confirm received and an
 * investor's Mark as sent are money: each asks once more, naming the
 * amount, before it is recorded. Q's detection shows what Q heard.
 */

type Side = "COMPANY" | "INVESTOR";

function standing(item: LedgerCommitmentDto): {
  readonly label: string;
  readonly tone: "you" | "them" | "done";
  readonly icon: "heard" | "agreed" | "sent" | "received";
} {
  switch (item.status) {
    case "DETECTED":
      return { label: "Heard in your call", tone: "you", icon: "heard" };
    case "STATED":
      return item.statedByYourSide
        ? { label: "You confirmed", tone: "them", icon: "agreed" }
        : { label: "They confirmed", tone: "you", icon: "agreed" };
    case "CONFIRMED":
      return { label: "Both confirmed", tone: "you", icon: "agreed" };
    case "TRANSFER_SENT":
      return { label: "Sent", tone: "you", icon: "sent" };
    case "RECEIVED":
      return { label: "Received", tone: "done", icon: "received" };
  }
}

const ICONS = {
  heard: Mic,
  agreed: Handshake,
  sent: ArrowUpRight,
  received: Check,
} as const;

const TONES = {
  you: "bg-(--cq-accent-soft) text-(--cq-text-primary)",
  them: "border border-(--cq-border-subtle) bg-(--cq-surface-subtle) text-(--cq-text-secondary)",
  done: "bg-(--cq-positive-soft) text-(--cq-text-primary)",
} as const;

function waitingWords(item: LedgerCommitmentDto, side: Side): string | null {
  if (item.next !== null) return null;
  const them = item.counterpartName;
  switch (item.status) {
    case "STATED":
      return `Waiting for ${them} to confirm`;
    case "TRANSFER_SENT":
      return side === "INVESTOR"
        ? `Waiting for ${them} to confirm receipt`
        : null;
    case "DETECTED":
    case "CONFIRMED":
    case "RECEIVED":
      return null;
  }
}

export function CommitmentCard({
  item,
  side,
  currentRoundId,
  roundName,
}: {
  readonly item: LedgerCommitmentDto;
  readonly side: Side;
  /** The founder's current round: money counts toward it by default. */
  readonly currentRoundId: string | null;
  readonly roundName: string | null;
}) {
  const router = useRouter();
  const id = useId();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [reference, setReference] = useState("");
  const [key] = useState(() => `amount:${crypto.randomUUID()}`);
  const state = standing(item);
  const Icon = ICONS[state.icon];
  const amount = money(item.amount, item.currencyCode);
  const href =
    side === "COMPANY"
      ? `/relationships/investor/${item.counterpartId}`
      : `/relationships/company/${item.counterpartId}`;

  const act = (work: () => Promise<CapitalResult>) =>
    start(async () => {
      const result = await work();
      if (result.ok) {
        setAsking(false);
        setMessage(null);
        router.refresh();
      } else {
        setMessage(result.message);
      }
    });

  const waiting = waitingWords(item, side);
  return (
    <article
      className="flex flex-col gap-3 rounded-2xl border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-5"
      data-commitment={item.status}
      aria-labelledby={`${id}-who`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <Link
          id={`${id}-who`}
          href={href}
          className="cq-body font-semibold text-(--cq-text-primary) hover:underline"
        >
          {item.counterpartName}
        </Link>
        <span
          className={`cq-caption inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 ${TONES[state.tone]}`}
        >
          <Icon aria-hidden size={14} strokeWidth={1.75} />
          {state.label}
        </span>
      </div>
      <p className="cq-title-md cq-numeric text-(--cq-text-primary)">
        {amount}
      </p>
      {item.quote === null || item.status !== "DETECTED" ? null : (
        <blockquote className="cq-body-sm border-l-2 border-(--cq-border) pl-3 text-(--cq-text-secondary)">
          “{item.quote}”
        </blockquote>
      )}
      {item.transferReference === null ? null : (
        <p className="cq-caption text-(--cq-text-tertiary)">
          Reference {item.transferReference}
        </p>
      )}
      {waiting === null && roundName === null ? null : (
        <p className="cq-caption text-(--cq-text-tertiary)">
          {[waiting, roundName].filter((part) => part !== null).join(". ")}
        </p>
      )}

      {item.next === "CONFIRM_AMOUNT" ? (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            disabled={pending}
            onClick={() =>
              act(() =>
                confirmAmountAction(
                  item.id,
                  side === "COMPANY" ? currentRoundId : null,
                  key,
                ),
              )
            }
          >
            Confirm amount
          </Button>
          {item.status === "DETECTED" ? (
            <Button
              variant="quiet"
              disabled={pending}
              onClick={() => act(() => notRightAction(item.id))}
            >
              Not right
            </Button>
          ) : null}
        </div>
      ) : null}

      {item.next === "CONFIRM_RECEIVED" ? (
        asking ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              disabled={pending}
              onClick={() =>
                act(() =>
                  confirmReceivedAction(
                    item.id,
                    item.roundId === null ? currentRoundId : null,
                  ),
                )
              }
            >
              Yes, {amount} arrived
            </Button>
            <Button
              variant="quiet"
              disabled={pending}
              onClick={() => setAsking(false)}
            >
              Not yet
            </Button>
          </div>
        ) : (
          <div>
            <Button variant="primary" onClick={() => setAsking(true)}>
              Confirm received
            </Button>
          </div>
        )
      ) : null}

      {item.next === "MARK_SENT" ? (
        asking ? (
          <div className="flex flex-col gap-3">
            <Input
              id={`${id}-reference`}
              label="Transfer reference (optional)"
              value={reference}
              maxLength={120}
              onChange={(event) => setReference(event.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                disabled={pending}
                onClick={() => act(() => markSentAction(item.id, reference))}
              >
                Mark {amount} as sent
              </Button>
              <Button
                variant="quiet"
                disabled={pending}
                onClick={() => setAsking(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <Button variant="primary" onClick={() => setAsking(true)}>
              Mark as sent
            </Button>
          </div>
        )
      ) : null}

      {message === null ? null : (
        <p className="cq-body-sm text-(--cq-danger)" role="alert">
          {message}
        </p>
      )}
    </article>
  );
}
