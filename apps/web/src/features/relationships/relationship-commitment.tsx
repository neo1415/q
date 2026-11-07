"use client";

import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";

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
import type { ApprovalPayload } from "@/features/q/control/approval";
import { useQControl } from "@/features/q/control/q-control";

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

  // W5.1 (plan §7): what Q may do here, by class, in code. Opening the
  // form is NONE; recording, confirming, withdrawing or adopting money is
  // binding, so APPROVAL: Q prepares it with its exact payload and it runs
  // only on the person's approval of that payload. The level comes only
  // from the person's own choice on the form -- never Q's -- so "invested"
  // (the money moved) is always their own statement (W5.3).
  const openRef = useRef<HTMLSpanElement>(null);
  const recordRef = useRef<HTMLSpanElement>(null);
  const confirmRef = useRef<HTMLSpanElement>(null);
  const withdrawRef = useRef<HTMLSpanElement>(null);
  const adoptRef = useRef<HTMLSpanElement>(null);
  const settle = async (
    work: () => ReturnType<typeof readCommitmentsAction>,
  ): Promise<"DONE" | "FAILED"> => {
    const result = await work();
    if (!result.ok) {
      setMessage(result.message);
      return "FAILED";
    }
    setState(result.value);
    setEditing(false);
    return "DONE";
  };
  const levelWords = (value: CommitmentLevel): string =>
    value === "INVESTED"
      ? "Invested: you confirm the money has moved"
      : (LEVELS.find((option) => option.level === value)?.label ?? value);
  useQControl({
    id: "button.commitment-open",
    kind: "BUTTON",
    ref: openRef,
    approval: "NONE",
  });
  useQControl({
    id: "button.commitment-record",
    kind: "BUTTON",
    ref: recordRef,
    approval: "APPROVAL",
    action: {
      id: "button.commitment-record",
      summary: (payload) =>
        `Record a commitment of ${String(payload["currency"])} ${formatAmountForDisplay(String(payload["amount"]))} with ${counterpart}, for them to confirm`,
      prepare: (): ApprovalPayload | null =>
        !editing || money.amount === ""
          ? null
          : {
              with: counterpart,
              amount: money.amount,
              currency: money.currency,
              level: levelWords(level),
            },
      execute: (payload, key) =>
        settle(() =>
          stateCommitmentAction(
            relationshipId,
            {
              amount: String(payload["amount"]),
              currencyCode: String(payload["currency"]),
              level,
            },
            key,
          ),
        ),
    },
  });
  const current0 = state?.current ?? null;
  useQControl({
    id: "button.commitment-confirm",
    kind: "BUTTON",
    ref: confirmRef,
    approval: "APPROVAL",
    action: {
      id: "button.commitment-confirm",
      summary: () => `Confirm ${counterpart}'s commitment`,
      prepare: (): ApprovalPayload | null =>
        current0 === null || !current0.canConfirm
          ? null
          : {
              with: counterpart,
              amount: current0.amount,
              currency: current0.currencyCode,
              level: levelWords(current0.level),
            },
      execute: () =>
        current0 === null
          ? Promise.resolve("FAILED")
          : settle(() => confirmCommitmentAction(current0.id)),
    },
  });
  useQControl({
    id: "button.commitment-withdraw",
    kind: "BUTTON",
    ref: withdrawRef,
    approval: "APPROVAL",
    action: {
      id: "button.commitment-withdraw",
      summary: () => `Withdraw the commitment with ${counterpart}`,
      prepare: (): ApprovalPayload | null =>
        current0 === null || !current0.canWithdraw
          ? null
          : {
              with: counterpart,
              amount: current0.amount,
              currency: current0.currencyCode,
            },
      execute: () =>
        current0 === null
          ? Promise.resolve("FAILED")
          : settle(() => withdrawCommitmentAction(current0.id)),
    },
  });
  const heard = state?.detected.find((item) => item.canAdopt) ?? null;
  useQControl({
    id: "button.commitment-adopt",
    kind: "BUTTON",
    ref: adoptRef,
    approval: "APPROVAL",
    action: {
      id: "button.commitment-adopt",
      summary: () =>
        `Record what Q heard in your call with ${counterpart}, for them to confirm`,
      prepare: (): ApprovalPayload | null =>
        heard === null
          ? null
          : {
              with: counterpart,
              amount: heard.amount,
              currency: heard.currencyCode,
              heard: heard.quote ?? "",
            },
      execute: (_payload, key) =>
        heard === null
          ? Promise.resolve("FAILED")
          : settle(() => adoptCommitmentAction(heard.id, key)),
    },
  });

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
                <span
                  ref={item.id === heard?.id ? adoptRef : undefined}
                  className="contents"
                >
                  <Button
                    size="compact"
                    disabled={pending}
                    onClick={() =>
                      act(() => adoptCommitmentAction(item.id, newKey()))
                    }
                  >
                    {t("That's right")}
                  </Button>
                </span>
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
        <span ref={openRef} className="contents">
          <Button variant="secondary" onClick={() => setEditing(true)}>
            {t("Record a commitment")}
          </Button>
        </span>,
      );
    }
    return withDetected(
      <form
        data-q-editing
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
          <span ref={recordRef} className="contents">
            <Button type="submit" disabled={pending || money.amount === ""}>
              {pending
                ? t("Recording…")
                : t(`Send to ${counterpart} to confirm`)}
            </Button>
          </span>
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
          <span ref={confirmRef} className="contents">
            <Button
              size="compact"
              disabled={pending}
              onClick={() => act(() => confirmCommitmentAction(current.id))}
            >
              {t("Confirm")}
            </Button>
          </span>
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
          <span ref={withdrawRef} className="contents">
            <Button
              variant="quiet"
              size="compact"
              disabled={pending}
              onClick={() => act(() => withdrawCommitmentAction(current.id))}
            >
              {t("Withdraw")}
            </Button>
          </span>
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
