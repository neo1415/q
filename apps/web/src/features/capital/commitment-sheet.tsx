"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type ReactNode } from "react";

import type { LedgerCommitmentDto } from "@capital-q/contracts";
import { MoneyInput } from "@capital-q/ui/money-input";

import { EntityAvatar } from "@/features/entity/entity-avatar";
import {
  crmButton,
  CrmSheet,
  ProgressButton,
  QLine,
  useCrmToast,
  type CrmButtonVariant,
} from "@/features/relationships/crm-kit";
import { stateCommitmentAction } from "@/features/relationships/commitment-actions";
import { formatDay } from "@/components/date-format";

import {
  confirmAmountAction,
  confirmReceivedAction,
  markSentAction,
  notRightAction,
  type CapitalResult,
} from "./capital-actions";
import { money } from "./money";
import { useT } from "@/features/i18n/language";

/**
 * The money steps as sheets (design 2026-10-20): each names the amount it
 * records before it is pressed, so the approval is the exact payload; the
 * server confirms before the button says done, and nothing is marked for
 * the other side. Received is only ever the founder's own confirmation.
 */

type Side = "COMPANY" | "INVESTOR";
type Phase = "idle" | "pending" | "done";

export const CURRENCIES = [
  { code: "USD", label: "US dollar" },
  { code: "EUR", label: "Euro" },
  { code: "GBP", label: "Pound sterling" },
  { code: "NGN", label: "Naira" },
  { code: "KES", label: "Kenyan shilling" },
  { code: "ZAR", label: "Rand" },
] as const;

/** The words of this side's next step on a commitment. */
export function commitmentStepLabel(
  next: NonNullable<LedgerCommitmentDto["next"]>,
): string {
  switch (next) {
    case "CONFIRM_AMOUNT":
      return "Confirm the amount";
    case "MARK_SENT":
      return "Mark the transfer as sent";
    case "CONFIRM_RECEIVED":
      return "Confirm received";
  }
}

function useStep() {
  const router = useRouter();
  const toast = useCrmToast();
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const run = (
    work: () => Promise<CapitalResult | { readonly ok: boolean; readonly message?: string }>,
    done: string,
    close: () => void,
  ) => {
    setPhase("pending");
    setMessage(null);
    void work().then((result) => {
      if (!result.ok) {
        setPhase("idle");
        setMessage(
          "message" in result && typeof result.message === "string"
            ? result.message
            : "That didn't work. Please try again.",
        );
        return;
      }
      setPhase("done");
      // The done state is seen, then the sheet closes on the new truth.
      setTimeout(() => {
        close();
        setPhase("idle");
        toast(done);
        router.refresh();
      }, 700);
    });
  };
  return { phase, message, run };
}

function Field({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] font-medium text-(--cq-text-secondary)">
        {label}
      </span>
      {children}
    </div>
  );
}

function Problem({ message }: { readonly message: string | null }) {
  return message === null ? null : (
    <p role="alert" className="text-sm text-(--cq-text-secondary)">
      {message}
    </p>
  );
}

function counterpartAvatar(item: LedgerCommitmentDto, side: Side) {
  return side === "COMPANY" ? (
    <EntityAvatar
      kind="investor"
      name={item.counterpartName}
      investorOrganisationId={item.counterpartId}
      size={36}
      decorative
    />
  ) : (
    <EntityAvatar
      kind="company"
      name={item.counterpartName}
      companyId={item.counterpartId}
      size={36}
      decorative
    />
  );
}

/**
 * One commitment's next step, as the button that opens its sheet. Null
 * when nothing is this side's to do.
 */
export function CommitmentStepButton({
  item,
  side,
  currentRoundId,
  variant = "secondary",
  label,
  className,
}: {
  readonly item: LedgerCommitmentDto;
  readonly side: Side;
  /** The founder's current round: confirmed money counts toward it. */
  readonly currentRoundId: string | null;
  readonly variant?: CrmButtonVariant;
  /** The button's own words, when the context names more ("Confirm Oakum's $400k"). */
  readonly label?: string | undefined;
  readonly className?: string | undefined;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  if (item.next === null) return null;
  return (
    <>
      <button
        type="button"
        className={crmButton(variant, className)}
        onClick={() => setOpen(true)}
        data-commitment-step={item.next}
      >
        {t(label ?? commitmentStepLabel(item.next))}
      </button>
      <CommitmentStepSheet
        open={open}
        onOpenChange={setOpen}
        item={item}
        side={side}
        currentRoundId={currentRoundId}
      />
    </>
  );
}

export function CommitmentStepSheet({
  open,
  onOpenChange,
  item,
  side,
  currentRoundId,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly item: LedgerCommitmentDto;
  readonly side: Side;
  readonly currentRoundId: string | null;
}) {
  const t = useT();
  const id = useId();
  const { phase, message, run } = useStep();
  const [reference, setReference] = useState("");
  const [key] = useState(() => `amount:${crypto.randomUUID()}`);
  const amount = money(item.amount, item.currencyCode);
  const them = item.counterpartName;
  const close = () => onOpenChange(false);
  const avatar = counterpartAvatar(item, side);
  const inputClass =
    "min-h-11 rounded-(--cq-radius-md) border border-(--cq-border) bg-(--cq-surface-raised) px-3 text-[15px] text-(--cq-text-primary) placeholder:text-(--cq-text-tertiary) focus-visible:border-(--cq-text-secondary) focus-visible:shadow-[0_0_0_3px_var(--cq-accent-soft)] focus-visible:outline-none";

  if (item.next === "MARK_SENT") {
    return (
      <CrmSheet
        open={open}
        onOpenChange={onOpenChange}
        title={t("Mark the transfer as sent")}
        sub={`${them}, ${amount}`}
        avatar={avatar}
        data-commitment-sheet="MARK_SENT"
      >
        <Field label={t("Transfer reference (optional)")}>
          <input
            id={`${id}-reference`}
            aria-label={t("Transfer reference (optional)")}
            className={inputClass}
            placeholder={t("For example the bank reference")}
            value={reference}
            maxLength={120}
            onChange={(event) => setReference(event.target.value)}
          />
        </Field>
        <QLine
          small={t(
            `It counts as received once ${them} confirms the money arrived. Q never marks it received for them.`,
          )}
        >
          {t("Sent is your side only.")}
        </QLine>
        <ProgressButton
          phase={phase}
          idle={t(`Mark ${amount} as sent`)}
          done={t("Marked as sent")}
          onClick={() =>
            run(
              () => markSentAction(item.id, reference),
              t(`${amount} marked as sent. Waiting for ${them} to confirm.`),
              close,
            )
          }
        />
        <Problem message={message} />
      </CrmSheet>
    );
  }

  if (item.next === "CONFIRM_RECEIVED") {
    return (
      <CrmSheet
        open={open}
        onOpenChange={onOpenChange}
        title={t(`Confirm you received ${amount}`)}
        sub={t(`${them} marked it sent on ${formatDay(item.at)}`)}
        avatar={avatar}
        data-commitment-sheet="CONFIRM_RECEIVED"
      >
        <p className="text-[15px] text-(--cq-text-primary)">
          {t(
            `Check your bank account first. Confirming moves ${amount} into Raised, and ${them} sees it confirmed.`,
          )}
        </p>
        <Field label={t("Amount that arrived")}>
          <div className={`${inputClass} flex items-center`}>{amount}</div>
        </Field>
        {item.transferReference === null ? null : (
          <Field label={t("Transfer reference")}>
            <div className={`${inputClass} flex items-center`}>
              {item.transferReference}
            </div>
          </Field>
        )}
        <ProgressButton
          phase={phase}
          idle={t("Confirm received")}
          done={t("Confirmed")}
          onClick={() =>
            run(
              () =>
                confirmReceivedAction(
                  item.id,
                  item.roundId === null ? currentRoundId : null,
                ),
              t(`${amount} from ${them} is now in Raised`),
              close,
            )
          }
        />
        <button type="button" className={crmButton("quiet")} onClick={close}>
          {t("Not yet")}
        </button>
        <Problem message={message} />
      </CrmSheet>
    );
  }

  // CONFIRM_AMOUNT: the other side (or Q, from a call) stated it.
  return (
    <CrmSheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("Confirm the amount")}
      sub={`${them}, ${amount}`}
      avatar={avatar}
      data-commitment-sheet="CONFIRM_AMOUNT"
    >
      {item.status === "DETECTED" ? (
        <>
          <p className="text-[15px] text-(--cq-text-primary)">
            {t("Q heard this in your call. Nothing is recorded until you confirm it.")}
          </p>
          {item.quote === null ? null : (
            <blockquote className="border-s-2 border-(--cq-border) ps-3 text-sm text-(--cq-text-secondary)">
              “{item.quote}”
            </blockquote>
          )}
        </>
      ) : (
        <p className="text-[15px] text-(--cq-text-primary)">
          {t(
            `${them} stated ${amount}. Confirming tells them you agree; it is not received money.`,
          )}
        </p>
      )}
      <ProgressButton
        phase={phase}
        idle={t(`Confirm ${amount}`)}
        done={t("Confirmed")}
        onClick={() =>
          run(
            () =>
              confirmAmountAction(
                item.id,
                side === "COMPANY" ? currentRoundId : null,
                key,
              ),
            t(`${amount} with ${them} is confirmed`),
            close,
          )
        }
      />
      {item.status === "DETECTED" ? (
        <button
          type="button"
          className={crmButton("quiet")}
          disabled={phase !== "idle"}
          onClick={() =>
            run(() => notRightAction(item.id), t("Marked as not right"), close)
          }
        >
          {t("Not right")}
        </button>
      ) : null}
      <Problem message={message} />
    </CrmSheet>
  );
}

/**
 * An invested company with no amount recorded: the investor records it.
 * The amount is stated to the company, which is asked to confirm it; it
 * completes the portfolio total once recorded.
 */
export function RecordAmountButton({
  relationshipId,
  name,
  companyId,
  since,
  variant = "secondary",
  label = "Record amount",
  className,
  onRecorded,
}: {
  readonly relationshipId: string;
  readonly name: string;
  readonly companyId: string;
  /** When the relationship became invested. */
  readonly since: string;
  readonly variant?: CrmButtonVariant;
  readonly label?: string;
  readonly className?: string | undefined;
  readonly onRecorded?: (() => void) | undefined;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={crmButton(variant, className)}
        onClick={() => setOpen(true)}
        data-record-amount={relationshipId}
      >
        {t(label)}
      </button>
      <RecordAmountSheet
        open={open}
        onOpenChange={setOpen}
        relationshipId={relationshipId}
        name={name}
        companyId={companyId}
        since={since}
        onRecorded={onRecorded}
      />
    </>
  );
}

export function RecordAmountSheet({
  open,
  onOpenChange,
  relationshipId,
  name,
  companyId,
  since,
  onRecorded,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly relationshipId: string;
  readonly name: string;
  readonly companyId?: string | undefined;
  readonly since: string;
  readonly onRecorded?: (() => void) | undefined;
}) {
  const t = useT();
  const id = useId();
  const { phase, message, run } = useStep();
  const [value, setValue] = useState<{ amount: string; currency: string }>({
    amount: "",
    currency: "USD",
  });
  // One key per sheet: a retry of the same press cannot record twice.
  const [key] = useState(() => `web-commit-${crypto.randomUUID()}`);
  const ready = /^(?:0|[1-9]\d{0,13})(?:\.\d{1,2})?$/.test(value.amount) &&
    !/^0(?:\.0{1,2})?$/.test(value.amount);
  const amount = ready ? money(value.amount, value.currency) : null;
  return (
    <CrmSheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("Record what you invested")}
      sub={t(`${name}, invested since ${formatDay(since)}`)}
      avatar={
        <EntityAvatar
          kind="company"
          name={name}
          companyId={companyId}
          size={36}
          decorative
        />
      }
      data-record-amount-sheet
    >
      <MoneyInput
        id={`${id}-amount`}
        label={t("Amount")}
        value={value}
        currencies={CURRENCIES}
        onChange={setValue}
        disabled={phase !== "idle"}
      />
      <QLine small={t("A recorded amount completes your portfolio total.")}>
        {t(`${name} sees this amount and is asked to confirm it.`)}
      </QLine>
      <ProgressButton
        phase={phase}
        disabled={!ready}
        idle={amount === null ? t("Record amount") : t(`Record ${amount}`)}
        done={t("Recorded")}
        onClick={() =>
          run(
            async () => {
              const result = await stateCommitmentAction(
                relationshipId,
                {
                  amount: value.amount,
                  currencyCode: value.currency,
                  level: "INVESTED",
                },
                key,
              );
              if (result.ok) onRecorded?.();
              return result.ok
                ? { ok: true }
                : { ok: false, message: result.message };
            },
            t(`${amount ?? ""} recorded for ${name}`),
            () => onOpenChange(false),
          )
        }
      />
      <Problem message={message} />
    </CrmSheet>
  );
}
