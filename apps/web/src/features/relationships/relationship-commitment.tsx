"use client";

import { useEffect, useState, useTransition, type ReactNode } from "react";

import type {
  CommitmentLevel,
  RelationshipCommitmentsDto,
} from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";
import {
  formatAmountForDisplay,
  MoneyInput,
  type MoneyValue,
} from "@capital-q/ui/money-input";

import {
  adoptCommitmentAction,
  confirmCommitmentAction,
  disputeCommitmentAction,
  readCommitmentsAction,
  stateCommitmentAction,
  withdrawCommitmentAction,
} from "./commitment-actions";
import { useT } from "@/features/i18n/language";

/**
 * The relationship's commitment (spec 6.6.14): one side records money and
 * the other side confirms it; until then it is soft, and nothing is added
 * to anyone's raise by one side alone. One state at a time, one action.
 */

const CURRENCIES = [
  { code: "USD", label: "US dollar" },
  { code: "EUR", label: "Euro" },
  { code: "GBP", label: "Pound sterling" },
  { code: "NGN", label: "Naira" },
  { code: "KES", label: "Kenyan shilling" },
  { code: "ZAR", label: "Rand" },
] as const;

const LEVELS: readonly {
  readonly level: CommitmentLevel;
  readonly label: string;
}[] = [
  { level: "SOFT", label: "Soft" },
  { level: "FIRM", label: "Firm" },
  { level: "INVESTED", label: "Invested" },
];

function newKey(): string {
  return `web-commit-${crypto.randomUUID()}`;
}

export function RelationshipCommitment({
  relationshipId,
  counterpart,
  initial = null,
}: {
  readonly relationshipId: string;
  readonly counterpart: string;
  /** For the design harness: a read to render without reading. */
  readonly initial?: RelationshipCommitmentsDto | null | undefined;
}) {
  const t = useT();

  const [state, setState] = useState<RelationshipCommitmentsDto | null>(
    initial,
  );
  const [editing, setEditing] = useState(false);
  const [money, setMoney] = useState<MoneyValue>({
    amount: "",
    currency: "USD",
  });
  const [level, setLevel] = useState<CommitmentLevel>("SOFT");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (initial !== null) return;
    let live = true;
    void readCommitmentsAction(relationshipId).then((result) => {
      if (live && result.ok) setState(result.value);
    });
    return () => {
      live = false;
    };
  }, [relationshipId, initial]);

  if (state === null || !state.connected) return null;
  const current = state.current;

  const act = (
    work: () => ReturnType<typeof readCommitmentsAction>,
    after?: () => void,
  ) =>
    startTransition(async () => {
      setMessage(null);
      const result = await work();
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      setState(result.value);
      after?.();
    });

  // Money Q heard in a call: either side adopts it (the other confirms) or
  // disputes it. It is never removed and never counts on its own.
  const detectedBlock =
    state.detected.length === 0 ? null : (
      <ul className="flex flex-col gap-3" aria-label={t("Q heard in a call")}>
        {state.detected.map((item) => (
          <li key={item.id} className="flex flex-col gap-1" data-detected>
            <span className="cq-body-sm text-(--cq-text-primary)">
              {t("Q heard")} {item.currencyCode}{" "}
              {t(formatAmountForDisplay(item.amount))} {t("in your call")}
            </span>
            {item.quote === null ? null : (
              <span className="cq-caption text-(--cq-text-secondary)">
                &ldquo;{item.quote}&rdquo;
              </span>
            )}
            <div className="flex flex-wrap gap-2">
              {item.canAdopt ? (
                <Button
                  size="compact"
                  disabled={pending}
                  onClick={() =>
                    act(() => adoptCommitmentAction(item.id, newKey()))
                  }
                >
                  {t("That's right")}
                </Button>
              ) : null}
              {item.canDispute ? (
                <Button
                  variant="quiet"
                  size="compact"
                  disabled={pending}
                  onClick={() => act(() => disputeCommitmentAction(item.id))}
                >
                  {t("Not right")}
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    );
  const withDetected = (main: ReactNode) => (
    <div className="flex flex-col gap-4">
      {detectedBlock}
      {main}
    </div>
  );

  if (editing || current === null) {
    if (!editing) {
      return withDetected(
        <Button variant="secondary" onClick={() => setEditing(true)}>
          {t("Record a commitment")}
        </Button>,
      );
    }
    return withDetected(
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          act(
            () =>
              stateCommitmentAction(
                relationshipId,
                {
                  amount: money.amount,
                  currencyCode: money.currency,
                  level,
                },
                newKey(),
              ),
            () => setEditing(false),
          );
        }}
      >
        <MoneyInput
          id={`commitment-${relationshipId}`}
          label={t("Amount")}
          value={money}
          currencies={CURRENCIES}
          onChange={setMoney}
          disabled={pending}
        />
        <div
          role="radiogroup"
          aria-label={t("How firm")}
          className="flex gap-2"
        >
          {LEVELS.map((option) => (
            <Button
              key={option.level}
              type="button"
              variant={level === option.level ? "primary" : "quiet"}
              size="compact"
              role="radio"
              aria-checked={level === option.level}
              onClick={() => setLevel(option.level)}
            >
              {t(option.label)}
            </Button>
          ))}
        </div>
        <div className="flex gap-2">
          <Button type="submit" disabled={pending || money.amount === ""}>
            {pending ? t("Recording…") : t(`Send to ${counterpart} to confirm`)}
          </Button>
          <Button
            type="button"
            variant="quiet"
            onClick={() => setEditing(false)}
          >
            {t("Cancel")}
          </Button>
        </div>
        {message === null ? null : (
          <span className="cq-caption text-(--cq-text-secondary)" role="status">
            {t(message)}
          </span>
        )}
      </form>,
    );
  }

  const levelLabel =
    LEVELS.find((option) => option.level === current.level)?.label ??
    current.level;
  return withDetected(
    <div className="flex flex-col gap-2" data-commitment={current.status}>
      <p className="cq-title-sm text-(--cq-text-primary)">
        {current.currencyCode} {t(formatAmountForDisplay(current.amount))}
        <span className="cq-body-sm text-(--cq-text-secondary)">
          {" "}
          · {t(levelLabel)}
        </span>
      </p>
      <span className="cq-caption text-(--cq-text-secondary)">
        {current.status === "CONFIRMED"
          ? t("Confirmed by both sides.")
          : current.statedByYourSide
            ? t(`Waiting for ${counterpart} to confirm.`)
            : t(`${counterpart} recorded this. Confirm if it's right.`)}
      </span>
      <div className="flex flex-wrap gap-2">
        {current.canConfirm ? (
          <Button
            size="compact"
            disabled={pending}
            onClick={() => act(() => confirmCommitmentAction(current.id))}
          >
            {t("Confirm")}
          </Button>
        ) : null}
        <Button
          variant="quiet"
          size="compact"
          disabled={pending}
          onClick={() => {
            setMoney({
              amount: current.amount,
              currency: current.currencyCode,
            });
            setLevel(current.level);
            setEditing(true);
          }}
        >
          {t("Change")}
        </Button>
        {current.canWithdraw ? (
          <Button
            variant="quiet"
            size="compact"
            disabled={pending}
            onClick={() => act(() => withdrawCommitmentAction(current.id))}
          >
            {t("Withdraw")}
          </Button>
        ) : null}
      </div>
      {message === null ? null : (
        <span className="cq-caption text-(--cq-text-secondary)" role="status">
          {t(message)}
        </span>
      )}
    </div>,
  );
}
