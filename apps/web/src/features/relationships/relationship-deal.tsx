"use client";

import Link from "next/link";
import {
  useEffect,
  useId,
  useState,
  useTransition,
  type ReactNode,
} from "react";

import type {
  DealInstrument,
  DealTermsDto,
  DealViewDto,
  RecordDealTermsRequest,
  RelationshipReportKind,
} from "@capital-q/contracts";
import { cx } from "@capital-q/ui";
import { Button, buttonClassName } from "@capital-q/ui/button";
import { DialogContent, DialogRoot } from "@capital-q/ui/dialog";
import { ArrowUpRight, Check, CircleHelp, ICON_SIZE } from "@capital-q/ui/icons";
import {
  formatAmountForDisplay,
  MoneyInput,
  type MoneyValue,
} from "@capital-q/ui/money-input";

import {
  closeDealAction,
  generateReportAction,
  markSignedAction,
  readDealAction,
  recordTermsAction,
  tickChecklistAction,
} from "./deal-actions";
import {
  DEAL_STAGE_WORDS,
  DealGuide,
  DealStageStrip,
  dealDay,
} from "./deal-stage-strip";
import { QLine } from "./record-parts";
import type { RelationshipSide } from "./relationship-words";
import { useT } from "@/features/i18n/language";

/**
 * The deal on the ONE relationship (founder, 2026-10-08), as the CRM
 * prototype's "Terms beside what gets recorded" (deal option 2, owner
 * 2026-10-20, warm charcoal): the stage strip both sides see; the terms
 * edited on the left while the right shows the exact record being
 * approved. Approval binds to that payload: its key is made from the
 * payload itself, so pressing again records once, and any edit after an
 * approval highlights the changed line and asks for the next revision --
 * a new version, never an overwrite. Signing and closing each confirm
 * exactly what is recorded. Money stays on the Commitment card; every
 * state is the server's.
 */

const CURRENCIES = [
  { code: "USD", label: "US dollar" },
  { code: "EUR", label: "Euro" },
  { code: "GBP", label: "Pound sterling" },
  { code: "NGN", label: "Naira" },
  { code: "KES", label: "Kenyan shilling" },
  { code: "ZAR", label: "Rand" },
] as const;

const INSTRUMENTS: readonly {
  readonly code: DealInstrument;
  readonly label: string;
}[] = [
  { code: "SAFE", label: "SAFE" },
  { code: "CONVERTIBLE_NOTE", label: "Convertible note" },
  { code: "PRICED_EQUITY", label: "Priced equity" },
  { code: "OTHER", label: "Other" },
];

const REPORT_WORDS: Readonly<Record<RelationshipReportKind, string>> = {
  MEETING_SUMMARY: "Meeting summary",
  DILIGENCE: "Diligence report",
  INVESTMENT_MEMO: "Investment memo",
  CLOSING: "Closing report",
  PASS: "Pass report",
};

const STEP_WORDS: Readonly<Record<string, string>> = {
  START_DILIGENCE: "Start diligence from “How did it go?” on the Overview.",
  SOFT_COMMIT:
    "The investor states an amount on the Commitment card; the company confirms it.",
  SEND_FUNDS:
    "When you have sent the money, mark it sent on the Commitment card. The company then confirms it arrived.",
  CONFIRM_FUNDS:
    "When the money is in your account, confirm it on the Commitment card. Only you can confirm receipt.",
  PASS: "If you decide not to go ahead, use “Not proceeding for now” on this relationship. It is archived, never deleted, and you can reconsider later.",
};

const newKey = (what: string) => `web-deal-${what}-${crypto.randomUUID()}`;

const money = (amount: string, currency: string) =>
  `${currency} ${formatAmountForDisplay(amount)}`;

const shortDoc = (id: string) => `Shared document ${id.slice(0, 8)}`;

const currencyName = (code: string) =>
  CURRENCIES.find((currency) => currency.code === code)?.label ?? code;

const instrumentName = (code: DealInstrument) =>
  INSTRUMENTS.find((i) => i.code === code)?.label ?? code;

/** The terms in one line; `t` puts the words in the reader's language. */
export function termsLine(
  terms: NonNullable<DealViewDto["terms"]>,
  t: (english: string) => string = (english) => english,
): string {
  const parts = [
    `${t(instrumentName(terms.instrument))} · ${money(terms.amount, terms.currencyCode)}`,
  ];
  if (terms.valuationCap !== null) {
    parts.push(
      t(
        `cap ${money(terms.valuationCap, terms.currencyCode)}${terms.valuationBasis === "PRE_MONEY" ? " pre-money" : " post-money"}`,
      ),
    );
  }
  if (terms.preMoneyValuation !== null) {
    parts.push(
      t(`pre-money ${money(terms.preMoneyValuation, terms.currencyCode)}`),
    );
  }
  if (terms.discountPercent !== null)
    parts.push(t(`${terms.discountPercent}% discount`));
  if (terms.proRata !== null)
    parts.push(t(terms.proRata ? "pro-rata" : "no pro-rata"));
  return parts.join(" · ");
}

/** A short, stable fingerprint of a payload: FNV-1a, 32 bits, hex. */
export function payloadFingerprint(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * The approval's key, bound to the exact payload: the same terms pressed
 * again are the same approval (recorded once); different terms are a new
 * one. The nonce keeps one page's approvals apart from another's.
 */
export function termsApprovalKey(
  nonce: string,
  terms: RecordDealTermsRequest,
): string {
  return `web-deal-terms-${nonce}-${payloadFingerprint(terms)}`;
}

const sameNumber = (a: string | null | undefined, b: string | null) =>
  (a ?? null) === null || b === null
    ? (a ?? null) === b
    : Number(a) === Number(b);

/** Which payload lines differ from the recorded version (null: none recorded). */
export function changedFields(
  terms: RecordDealTermsRequest,
  recorded: DealTermsDto | null,
): ReadonlySet<string> {
  if (recorded === null) return new Set();
  const changed = new Set<string>();
  if (terms.instrument !== recorded.instrument) changed.add("instrument");
  if (!sameNumber(terms.amount, recorded.amount)) changed.add("amount");
  if (terms.currencyCode !== recorded.currencyCode) changed.add("currency");
  if (
    !sameNumber(terms.valuationCap, recorded.valuationCap) ||
    (terms.valuationCap !== undefined &&
      (terms.valuationBasis ?? null) !== recorded.valuationBasis)
  )
    changed.add("cap");
  if (!sameNumber(terms.preMoneyValuation, recorded.preMoneyValuation))
    changed.add("cap");
  if (!sameNumber(terms.discountPercent, recorded.discountPercent))
    changed.add("discount");
  if ((terms.proRata ?? null) !== recorded.proRata) changed.add("proRata");
  if ((terms.otherTerms ?? null) !== recorded.otherTerms) changed.add("other");
  if ((terms.termsDocumentId ?? null) !== recorded.termsDocumentId)
    changed.add("document");
  return changed;
}

function Confirm({
  label,
  title,
  description,
  confirmLabel,
  disabled,
  onConfirm,
  children,
  primary = false,
}: {
  readonly label: string;
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
  readonly disabled: boolean;
  /** Runs with the key made when this confirm opened. */
  readonly onConfirm: (key: string) => Promise<boolean>;
  readonly children?: ReactNode;
  readonly primary?: boolean;
}) {
  const t = useT();

  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(() => newKey("x"));
  const [busy, setBusy] = useState(false);
  return (
    <DialogRoot
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setKey(newKey("x"));
      }}
    >
      <Button
        variant={primary ? "primary" : "secondary"}
        className="min-h-11 self-start"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        {t(label)}
      </Button>
      {open ? (
        <DialogContent
          title={t(title)}
          description={t(description)}
          actions={
            <>
              <Button
                variant="secondary"
                className="min-h-11"
                disabled={busy}
                onClick={() => setOpen(false)}
              >
                {t("Cancel")}
              </Button>
              <Button
                variant="primary"
                className="min-h-11"
                disabled={busy || disabled}
                onClick={() => {
                  setBusy(true);
                  void onConfirm(key).then((done) => {
                    setBusy(false);
                    if (done) setOpen(false);
                  });
                }}
              >
                {busy ? "Saving…" : confirmLabel}
              </Button>
            </>
          }
        >
          {children}
        </DialogContent>
      ) : null}
    </DialogRoot>
  );
}

const INPUT =
  "cq-body min-h-11 w-full rounded-(--cq-radius-md) border border-(--cq-border) bg-(--cq-surface-raised) px-3 py-2 text-(--cq-text-primary) placeholder:text-(--cq-text-tertiary) transition-[border-color,box-shadow] duration-(--cq-motion-fast) focus-visible:border-(--cq-text-secondary) focus-visible:shadow-[0_0_0_3px_var(--cq-accent-soft)] focus-visible:outline-none";

/** A segmented control: one choice of a few, its words always shown. */
function Segmented<V extends string>({
  label,
  options,
  value,
  onChange,
}: {
  readonly label: string;
  readonly options: readonly { readonly value: V; readonly label: string }[];
  readonly value: V | null;
  /** Pressing the chosen one again clears it when `clearable`. */
  readonly onChange: (value: V) => void;
}) {
  const t = useT();
  return (
    <div
      role="radiogroup"
      aria-label={t(label)}
      className="inline-flex flex-wrap gap-0.5 self-start rounded-(--cq-radius-lg) bg-(--cq-surface-subtle) p-[3px]"
    >
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(option.value)}
            className={cx(
              "cq-body-sm inline-flex min-h-[38px] items-center rounded-(--cq-radius-md) px-3 font-medium transition-[background-color,color,box-shadow] duration-(--cq-motion-fast) max-sm:min-h-11",
              on
                ? "bg-(--cq-surface-raised) text-(--cq-text-primary) shadow-[0_1px_2px_var(--cq-border),0_0_0_1px_var(--cq-border-subtle)]"
                : "text-(--cq-text-secondary) hover:text-(--cq-text-primary)",
            )}
          >
            {t(option.label)}
          </button>
        );
      })}
    </div>
  );
}

/** What their pitch or deck stated about the round, as their claim. */
export type PitchTerm = {
  readonly label: string;
  readonly value: string;
  readonly source: string;
};

type Basis = "POST_MONEY" | "PRE_MONEY" | "PRICED";

function TermsWorkspace({
  view,
  pending,
  pitchTerms,
  onRecord,
}: {
  readonly view: DealViewDto;
  readonly pending: boolean;
  readonly pitchTerms: readonly PitchTerm[];
  readonly onRecord: (
    terms: RecordDealTermsRequest,
    key: string,
  ) => Promise<boolean>;
}) {
  const t = useT();

  const id = useId();
  const current = view.terms;
  // One page's approvals apart from another's; the payload does the rest.
  const [nonce] = useState(() => crypto.randomUUID().slice(0, 12));
  const [instrument, setInstrument] = useState<DealInstrument>(
    current?.instrument ?? "SAFE",
  );
  const [amount, setAmount] = useState<MoneyValue>({
    amount: current?.amount ?? "",
    currency: current?.currencyCode ?? "USD",
  });
  const [cap, setCap] = useState(
    current?.valuationCap ?? current?.preMoneyValuation ?? "",
  );
  const [basis, setBasis] = useState<Basis>(
    current?.preMoneyValuation !== null &&
      current?.preMoneyValuation !== undefined
      ? "PRICED"
      : (current?.valuationBasis ?? "POST_MONEY"),
  );
  const [discount, setDiscount] = useState(current?.discountPercent ?? "");
  const [proRata, setProRata] = useState<"YES" | "NO" | null>(
    current?.proRata === true ? "YES" : current?.proRata === false ? "NO" : null,
  );
  const [other, setOther] = useState(current?.otherTerms ?? "");
  const [document, setDocument] = useState(current?.termsDocumentId ?? "");

  const pricedBasis: Basis =
    instrument === "PRICED_EQUITY"
      ? "PRICED"
      : basis === "PRICED"
        ? "POST_MONEY"
        : basis;
  const terms: RecordDealTermsRequest = {
    instrument,
    amount: amount.amount,
    currencyCode: amount.currency,
    ...(cap.trim() === ""
      ? {}
      : pricedBasis === "PRICED"
        ? { preMoneyValuation: cap.trim() }
        : { valuationCap: cap.trim(), valuationBasis: pricedBasis }),
    ...(discount.trim() === "" ? {} : { discountPercent: discount.trim() }),
    ...(proRata === null ? {} : { proRata: proRata === "YES" }),
    ...(other.trim() === "" ? {} : { otherTerms: other.trim() }),
    ...(document === "" ? {} : { termsDocumentId: document }),
  };
  const changed = changedFields(terms, current);
  const recordedAsShown = current !== null && changed.size === 0;
  const nextVersion = (current?.version ?? 0) + 1;
  const capLabel =
    pricedBasis === "PRICED"
      ? "Pre-money valuation"
      : pricedBasis === "PRE_MONEY"
        ? "Pre-money cap"
        : "Post-money cap";

  const rows: readonly {
    readonly key: string;
    readonly label: string;
    readonly value: string;
  }[] = [
    {
      key: "instrument",
      label: "Instrument",
      value:
        instrument === "SAFE"
          ? pricedBasis === "PRE_MONEY"
            ? "Pre-money SAFE"
            : "Post-money SAFE"
          : instrumentName(instrument),
    },
    {
      key: "cap",
      label: capLabel,
      value:
        cap.trim() === ""
          ? "Not stated"
          : `${symbolOf(amount.currency)}${formatAmountForDisplay(cap.trim())}`,
    },
    {
      key: "discount",
      label: "Discount",
      value: discount.trim() === "" ? "None" : `${discount.trim()}%`,
    },
    {
      key: "proRata",
      label: "Pro-rata right",
      value: proRata === null ? "Not stated" : proRata === "YES" ? "Yes" : "No",
    },
    {
      key: "amount",
      label: "Your amount",
      value:
        amount.amount === ""
          ? "Not stated"
          : `${symbolOf(amount.currency)}${formatAmountForDisplay(amount.amount)}`,
    },
    {
      key: "currency",
      label: "Currency",
      value: currencyName(amount.currency),
    },
    ...(terms.otherTerms === undefined
      ? []
      : [{ key: "other", label: "Other terms", value: terms.otherTerms }]),
    ...(terms.termsDocumentId === undefined
      ? []
      : [
          {
            key: "document",
            label: "Term sheet",
            value: shortDoc(terms.termsDocumentId),
          },
        ]),
  ];
  const changedWords = [...changed]
    .map((key) => rows.find((row) => row.key === key)?.label.toLowerCase())
    .filter((word): word is string => word !== undefined);

  const stated = pitchTerms.filter(
    (term) => /instrument|cap|valuation|raise/i.test(term.label),
  );

  return (
    <div
      className="grid items-start gap-7 lg:grid-cols-[minmax(0,1fr)_380px]"
      data-terms-form
    >
      <div className="flex min-w-0 flex-col gap-4 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) px-5 py-[18px]">
        <div className="flex flex-col gap-1.5">
          <span className="cq-body-sm font-medium text-(--cq-text-secondary)">
            {t("Instrument")}
          </span>
          <Segmented
            label="Instrument"
            options={INSTRUMENTS.map((option) => ({
              value: option.code,
              label: option.label,
            }))}
            value={instrument}
            onChange={setInstrument}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5" htmlFor={`${id}-cap`}>
            <span className="cq-body-sm font-medium text-(--cq-text-secondary)">
              {t(capLabel)}
            </span>
            <input
              id={`${id}-cap`}
              inputMode="decimal"
              className={INPUT}
              placeholder={t("Not stated")}
              value={cap}
              onChange={(e) => setCap(e.target.value.replace(/[^0-9.]/g, ""))}
            />
            {instrument === "PRICED_EQUITY" ? null : (
              <button
                type="button"
                className="cq-caption inline-flex min-h-8 items-center self-start text-(--cq-text-tertiary) underline underline-offset-2 hover:text-(--cq-text-primary)"
                onClick={() =>
                  setBasis(pricedBasis === "PRE_MONEY" ? "POST_MONEY" : "PRE_MONEY")
                }
              >
                {pricedBasis === "PRE_MONEY"
                  ? t("Post-money instead")
                  : t("Pre-money instead")}
              </button>
            )}
          </label>
          <label className="flex flex-col gap-1.5" htmlFor={`${id}-discount`}>
            <span className="cq-body-sm font-medium text-(--cq-text-secondary)">
              {t("Discount % (optional)")}
            </span>
            <input
              id={`${id}-discount`}
              inputMode="decimal"
              className={INPUT}
              placeholder={t("None")}
              value={discount}
              onChange={(e) =>
                setDiscount(e.target.value.replace(/[^0-9.]/g, ""))
              }
            />
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <MoneyInput
            id={`${id}-amount`}
            label={t("Your amount")}
            value={amount}
            currencies={CURRENCIES}
            onChange={setAmount}
            disabled={pending}
          />
          <div className="flex flex-col gap-1.5">
            <span className="cq-body-sm font-medium text-(--cq-text-secondary)">
              {t("Pro-rata right")}
            </span>
            <Segmented
              label="Pro-rata right"
              options={[
                { value: "YES" as const, label: "Yes" },
                { value: "NO" as const, label: "No" },
              ]}
              value={proRata}
              // Pressing the chosen one again: not stated (unknown stays unknown).
              onChange={(next) => setProRata(next === proRata ? null : next)}
            />
          </div>
        </div>
        <details className="group">
          <summary className="cq-body-sm inline-flex min-h-11 cursor-pointer list-none items-center text-(--cq-text-secondary) hover:text-(--cq-text-primary) [&::-webkit-details-marker]:hidden">
            {t("Other terms and the term sheet")}
          </summary>
          <div className="flex flex-col gap-3 pt-2">
            <label className="flex flex-col gap-1.5" htmlFor={`${id}-other`}>
              <span className="cq-body-sm font-medium text-(--cq-text-secondary)">
                {t("Other terms (optional)")}
              </span>
              <textarea
                id={`${id}-other`}
                rows={2}
                maxLength={2000}
                className={INPUT}
                value={other}
                onChange={(e) => setOther(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1.5" htmlFor={`${id}-doc`}>
              <span className="cq-body-sm font-medium text-(--cq-text-secondary)">
                {t("Terms document (shared in the data room)")}
              </span>
              <select
                id={`${id}-doc`}
                className={INPUT}
                value={document}
                onChange={(e) => setDocument(e.target.value)}
              >
                <option value="">{t("None attached")}</option>
                {view.sharedDocumentIds.map((doc) => (
                  <option key={doc} value={doc}>
                    {t(shortDoc(doc))}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </details>
        {stated.length === 0 ? null : (
          <QLine
            note={t(
              document === ""
                ? "Founder's claim until the term sheet is uploaded."
                : "Founder's claim; check it against the attached term sheet.",
            )}
          >
            {t("Their pitch states:")}{" "}
            {stated.map((term) => `${term.label} ${term.value}`).join(" · ")}
            {t(` (${stated[0]?.source ?? ""}).`)}
          </QLine>
        )}
      </div>

      <aside className="flex flex-col gap-3 lg:sticky lg:top-4">
        <section
          aria-labelledby={`${id}-record`}
          className="flex flex-col gap-3 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) px-5 py-[18px]"
        >
          <h3
            id={`${id}-record`}
            className="cq-body-sm font-medium text-(--cq-text-secondary)"
          >
            {t("What will be recorded")}
          </h3>
          <dl
            className="overflow-hidden rounded-(--cq-radius-md) border border-(--cq-border-subtle) bg-(--cq-surface)"
            data-terms-preview
          >
            {rows.map((row) => (
              <div
                key={row.key}
                className={cx(
                  "cq-body-sm flex justify-between gap-3 px-3.5 py-2.5 transition-colors duration-(--cq-motion-base) not-first:border-t not-first:border-(--cq-border-subtle)",
                  changed.has(row.key) ? "bg-(--cq-accent-soft)" : undefined,
                )}
                data-changed={changed.has(row.key) ? "yes" : undefined}
              >
                <dt className="text-(--cq-text-secondary)">{t(row.label)}</dt>
                <dd className="cq-numeric text-end font-semibold text-(--cq-text-primary)">
                  {t(row.value)}
                </dd>
              </div>
            ))}
          </dl>
          {recordedAsShown && current !== null ? (
            <p
              className="cq-body-sm cq-swap flex items-center gap-2.5 rounded-(--cq-radius-md) bg-(--cq-positive-soft) px-3.5 py-3 text-(--cq-positive)"
              data-terms-state="approved"
            >
              <Check size={ICON_SIZE.compact} aria-hidden="true" />
              {t(
                `Approved ${approvedWhen(current.recordedAt)}, as shown above.`,
              )}
            </p>
          ) : current !== null ? (
            <p
              className="cq-body-sm cq-swap flex items-start gap-2.5 rounded-(--cq-radius-md) bg-(--cq-warning-soft) px-3.5 py-3 text-(--cq-warning)"
              data-terms-state="stale"
            >
              <CircleHelp
                size={ICON_SIZE.compact}
                aria-hidden="true"
                className="mt-0.5 flex-none"
              />
              {t(
                `The ${changedWords.join(", ")} changed after approval. Approve again to record revision ${String(nextVersion)}.`,
              )}
            </p>
          ) : null}
          <Button
            variant="primary"
            disabled={pending || amount.amount === "" || recordedAsShown}
            onClick={() =>
              void onRecord(terms, termsApprovalKey(nonce, terms))
            }
          >
            {pending
              ? t("Recording…")
              : current === null
                ? t("Approve and record")
                : recordedAsShown
                  ? t("Recorded")
                  : t(`Approve revision ${String(nextVersion)}`)}
          </Button>
        </section>
        <span className="cq-caption text-(--cq-text-tertiary)">
          {t(
            "Both sides see recorded terms. Corrections add a revision; nothing is overwritten.",
          )}
        </span>
      </aside>
    </div>
  );
}

const SYMBOLS: Readonly<Record<string, string>> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  NGN: "₦",
  KES: "KSh ",
  ZAR: "R ",
};
const symbolOf = (code: string) => SYMBOLS[code] ?? `${code} `;

/** "14:02 today", or "on 20 Oct". */
function approvedWhen(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return at.toDateString() === now.toDateString()
    ? `${new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(at)} today`
    : `on ${dealDay(iso)}`;
}

/** The deal's heading: the step it is on, and the last thing recorded. */
function dealHeading(view: DealViewDto): {
  readonly title: string;
  readonly sub: string | null;
} {
  if (view.end?.kind === "CLOSED") {
    return { title: "Investment closed", sub: `On ${dealDay(view.end.at)}` };
  }
  if (view.end?.kind === "PASSED") {
    return { title: "Not proceeding", sub: `Since ${dealDay(view.end.at)}` };
  }
  const steps = view.nextSteps;
  const title = steps.includes("RECORD_TERMS")
    ? view.terms === null
      ? "Record the terms"
      : "The terms"
    : steps.includes("MARK_SIGNED")
      ? "Record as signed"
      : steps.includes("CLOSE")
        ? "Close the investment"
        : "Deal";
  const reached = view.stages
    .filter((stage) => stage.reachedAt !== null)
    .at(-1);
  return {
    title,
    sub:
      reached === undefined || reached.reachedAt === null
        ? null
        : `${DEAL_STAGE_WORDS[reached.stage]} recorded ${dealDay(reached.reachedAt)}`,
  };
}

/**
 * The Overview's deal card (record option 3): the strip and where it
 * stands in a sentence, and the way to the terms. A failed read shows
 * nothing, as before.
 */
export function DealSummary({
  relationshipId,
  href,
  initial = null,
}: {
  readonly relationshipId: string;
  readonly href: string;
  readonly initial?: DealViewDto | null | undefined;
}) {
  const t = useT();
  const [view, setView] = useState<DealViewDto | null>(initial);
  useEffect(() => {
    if (initial !== null) return;
    let live = true;
    void readDealAction(relationshipId)
      .then((result) => {
        if (live && result.ok) setView(result.value);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [relationshipId, initial]);
  if (view === null) {
    return (
      <span className="cq-caption text-(--cq-text-tertiary)">
        {t("Reading the deal…")}
      </span>
    );
  }
  return (
    <div className="flex flex-col gap-3" data-deal-summary>
      <DealStageStrip view={view} compact />
      <DealGuide view={view} />
      <Link
        href={href}
        className={buttonClassName("secondary", "compact", "self-start")}
      >
        {t(view.nextSteps.includes("RECORD_TERMS") ? "Record the terms" : "Deal and close")}
        <ArrowUpRight size={ICON_SIZE.compact} aria-hidden="true" />
      </Link>
    </div>
  );
}

export function RelationshipDeal({
  relationshipId,
  counterpart,
  side,
  initial = null,
  pitchTerms = [],
}: {
  readonly relationshipId: string;
  readonly counterpart: string;
  readonly side: RelationshipSide;
  /** For the design harness: a view to render without reading. */
  readonly initial?: DealViewDto | null | undefined;
  /** What their pitch stated about the round, shown as their claim. */
  readonly pitchTerms?: readonly PitchTerm[] | undefined;
}) {
  const t = useT();

  const [view, setView] = useState<DealViewDto | null>(initial);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [signedDoc, setSignedDoc] = useState("");
  const [closeNote, setCloseNote] = useState("");
  const [reportKind, setReportKind] =
    useState<RelationshipReportKind>("DILIGENCE");
  const noteId = useId();

  useEffect(() => {
    if (initial !== null) return;
    let live = true;
    // A failed read leaves the panel unrendered, as a refused one does;
    // never an unhandled rejection.
    void readDealAction(relationshipId)
      .then((result) => {
        if (live && result.ok) setView(result.value);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [relationshipId, initial]);

  if (view === null) return null;

  const apply = (
    work: Promise<
      { ok: true; value: DealViewDto } | { ok: false; message: string }
    >,
  ) =>
    new Promise<boolean>((resolve) => {
      startTransition(async () => {
        setMessage(null);
        const result = await work;
        if (result.ok) {
          setView(result.value);
          resolve(true);
        } else {
          setMessage(result.message);
          resolve(false);
        }
      });
    });

  const steps = view.nextSteps;
  const base = `/relationships/deal/${relationshipId}`;
  const reportKinds: RelationshipReportKind[] =
    side === "INVESTOR"
      ? [
          "MEETING_SUMMARY",
          "DILIGENCE",
          "INVESTMENT_MEMO",
          ...(view.end?.kind === "CLOSED" ? (["CLOSING"] as const) : []),
          ...(view.end?.kind === "PASSED" ? (["PASS"] as const) : []),
        ]
      : [
          "MEETING_SUMMARY",
          "DILIGENCE",
          ...(view.end?.kind === "CLOSED" ? (["CLOSING"] as const) : []),
        ];
  const signCandidates = view.sharedDocumentIds.filter(
    (doc) => doc !== view.terms?.termsDocumentId,
  );
  const heading = dealHeading(view);

  return (
    <div
      className="flex flex-col gap-5"
      data-deal={view.end?.kind ?? view.current ?? "NONE"}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-[20px] leading-tight font-semibold tracking-[-0.01em] text-(--cq-text-primary)">
          {t(heading.title)}
        </h2>
        {heading.sub === null ? null : (
          <span className="cq-caption text-(--cq-text-tertiary)">
            {t(heading.sub)}
          </span>
        )}
      </div>
      <DealStageStrip view={view} />
      <DealGuide view={view} />

      {view.end?.kind === "CLOSED" ? (
        <section
          className="cq-swap flex flex-col gap-3 rounded-(--cq-radius-lg) bg-(--cq-positive-soft) p-5"
          aria-label={t("Investment closed")}
          data-deal-final="CLOSED"
        >
          <p className="cq-body text-(--cq-text-primary)">
            <strong>{t("Investment closed")}</strong> {t("on")}{" "}
            {t(dealDay(view.end.at))}
            {view.terms === null ? "" : `: ${termsLine(view.terms, t)}`}
            {t(". This is the final state; the history and reports stay.")}
          </p>
          {side === "INVESTOR" ? (
            <p className="cq-body-sm text-(--cq-text-secondary)">
              {t(`${counterpart} is in your portfolio: it counts in`)}{" "}
              <a
                className="underline underline-offset-2"
                href="/relationships?view=overview"
              >
                {t("the CRM Overview")}
              </a>{" "}
              {t("from the money received.")}
            </p>
          ) : null}
          {view.updateCadence === null ? null : (
            <p className="cq-body-sm text-(--cq-text-secondary)">
              {t("Q suggests:")} {t(view.updateCadence)}
            </p>
          )}
          <h3 className="cq-body font-semibold text-(--cq-text-primary)">
            {side === "COMPANY"
              ? t("Investor onboarded")
              : t("Portfolio entry")}
          </h3>
          <ul className="flex flex-col gap-1" data-deal-checklist>
            {view.checklist.map((item) => (
              <li key={item.code} className="flex min-h-11 items-center gap-3">
                <input
                  type="checkbox"
                  className="size-5 accent-(--cq-accent)"
                  checked={item.done}
                  disabled={item.done || pending}
                  aria-label={t(item.label)}
                  onChange={() =>
                    void apply(tickChecklistAction(relationshipId, item.code))
                  }
                />
                <span
                  className={`cq-body ${item.done ? "text-(--cq-text-secondary)" : "text-(--cq-text-primary)"}`}
                >
                  {t(item.label)}
                  {item.fromRecord ? (
                    <span className="cq-caption text-(--cq-text-tertiary)">
                      {" "}
                      {t("· from the record")}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {view.end?.kind === "PASSED" ? (
        <p
          className="cq-body rounded-(--cq-radius-lg) border border-dashed border-(--cq-border) px-4 py-3 text-(--cq-text-primary)"
          data-deal-final="PASSED"
        >
          {side === "INVESTOR" ? t("You decided") : t(`${counterpart} decided`)}{" "}
          {t("not to proceed on")} {t(dealDay(view.end.at))}
          {t(
            ". The relationship is archived, never deleted: its history and reports stay here.",
          )}
        </p>
      ) : null}

      {steps.includes("RECORD_TERMS") ? (
        <TermsWorkspace
          view={view}
          pending={pending}
          pitchTerms={pitchTerms}
          onRecord={(terms, key) =>
            apply(recordTermsAction(relationshipId, terms, key))
          }
        />
      ) : view.terms === null ? null : (
        <div
          className="flex flex-col gap-1 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) px-5 py-[18px]"
          data-deal-terms
        >
          <span className="cq-caption text-(--cq-text-tertiary)">
            {t(`Terms · version ${String(view.terms.version)} · recorded by`)}{" "}
            {t(
              view.terms.recordedBy ??
                (view.terms.recordedBySide === side
                  ? "your side"
                  : counterpart),
            )}{" "}
            {t("on")} {t(dealDay(view.terms.recordedAt))}
          </span>
          <span className="cq-body text-(--cq-text-primary)">
            {termsLine(view.terms, t)}
          </span>
          <span className="cq-body-sm text-(--cq-text-secondary)">
            {view.terms.signedAt === null
              ? t("Not signed yet.")
              : t(
                  `Signed ${dealDay(view.terms.signedAt)}, signed copy on file.`,
                )}
          </span>
        </div>
      )}

      {!steps.some((step) => step !== "RECORD_TERMS") ? null : (
        <div className="flex flex-col gap-3" data-deal-next>
          {steps
            .filter((step) => STEP_WORDS[step] !== undefined)
            .map((step) => (
              <p key={step} className="cq-body-sm text-(--cq-text-secondary)">
                {t(STEP_WORDS[step] ?? "")}
              </p>
            ))}
          {steps.includes("MARK_SIGNED") && view.terms !== null ? (
            <div className="flex flex-col gap-2">
              <label
                className="cq-body-sm font-medium text-(--cq-text-secondary)"
                htmlFor={`${noteId}-signed`}
              >
                {t("Signed copy (shared with")} {counterpart}{" "}
                {t("in the data room)")}
              </label>
              <select
                id={`${noteId}-signed`}
                className={INPUT}
                value={signedDoc}
                onChange={(e) => setSignedDoc(e.target.value)}
              >
                <option value="">{t("Choose the signed copy")}</option>
                {signCandidates.map((doc) => (
                  <option key={doc} value={doc}>
                    {t(shortDoc(doc))}
                  </option>
                ))}
              </select>
              <Confirm
                label={t("Record as signed")}
                title={t(
                  `Record terms v${String(view.terms.version)} as signed?`,
                )}
                description={t(
                  "Both sides see the terms marked signed with the signed copy attached. It applies to exactly this version: if the terms change first, nothing is recorded.",
                )}
                confirmLabel={t("Approve and record")}
                primary
                disabled={pending || signedDoc === ""}
                onConfirm={(key) =>
                  view.terms === null
                    ? Promise.resolve(false)
                    : apply(
                        markSignedAction(
                          relationshipId,
                          view.terms.termsId,
                          signedDoc,
                          key,
                        ),
                      )
                }
              >
                <p className="cq-body text-(--cq-text-primary)">
                  {termsLine(view.terms, t)}
                </p>
                <p className="cq-body-sm text-(--cq-text-secondary)">
                  {signedDoc === "" ? "" : t(shortDoc(signedDoc))}
                </p>
              </Confirm>
            </div>
          ) : null}
          {steps.includes("CLOSE") ? (
            <Confirm
              label={t("Close the investment")}
              title={t(`Close the investment with ${counterpart}?`)}
              description={t(
                "Signed terms and received money: both sides see it closed, a closing report is filed, and this becomes the relationship's final state.",
              )}
              confirmLabel={t("Approve and close")}
              primary
              disabled={pending}
              onConfirm={(key) =>
                apply(closeDealAction(relationshipId, closeNote, key))
              }
            >
              <label
                className="cq-body-sm text-(--cq-text-secondary)"
                htmlFor={`${noteId}-close`}
              >
                {t("A closing note both sides see (optional)")}
              </label>
              <textarea
                id={`${noteId}-close`}
                rows={2}
                maxLength={1000}
                className={INPUT}
                value={closeNote}
                onChange={(e) => setCloseNote(e.target.value)}
              />
            </Confirm>
          ) : null}
        </div>
      )}

      {message === null ? null : (
        <p className="cq-body-sm text-(--cq-text-primary)" role="status">
          {t(message)}
        </p>
      )}

      <section
        className="flex flex-col gap-2 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) px-5 py-[18px]"
        aria-label={t("Reports")}
        data-deal-reports
      >
        <h3 className="cq-body-sm font-medium text-(--cq-text-secondary)">
          {t("Reports")}
        </h3>
        {view.reports.length === 0 ? (
          <p className="cq-body-sm text-(--cq-text-secondary)">
            {t(
              "No report filed yet. Reports are compiled from the record at each stage.",
            )}
          </p>
        ) : (
          <ul className="flex flex-col">
            {view.reports.map((report) => (
              <li
                key={report.reportId}
                className="flex items-center justify-between gap-3 border-t border-(--cq-border-subtle) py-2 first:border-t-0"
                data-report={report.kind}
              >
                <span className="flex min-w-0 flex-col">
                  <span className="cq-body text-(--cq-text-primary)">
                    {t(REPORT_WORDS[report.kind])}
                  </span>
                  <span className="cq-caption text-(--cq-text-tertiary)">
                    v{report.version} · {t(dealDay(report.createdAt))} ·{" "}
                    {report.visibility === "relationship_shared"
                      ? t(`Shared with ${counterpart}`)
                      : t("Only your organisation")}
                  </span>
                </span>
                <a
                  className={buttonClassName("secondary", "compact")}
                  href={`${base}/reports/${report.reportId}`}
                  download
                >
                  PDF
                </a>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor={`${noteId}-kind`}>
            {t("Report")}
          </label>
          <select
            id={`${noteId}-kind`}
            className={INPUT.replace("w-full", "w-full sm:w-auto")}
            value={reportKind}
            onChange={(e) =>
              setReportKind(e.target.value as RelationshipReportKind)
            }
          >
            {reportKinds.map((kind) => (
              <option key={kind} value={kind}>
                {t(REPORT_WORDS[kind])}
              </option>
            ))}
          </select>
          <Button
            variant="secondary"
            className="min-h-11"
            disabled={pending}
            onClick={() =>
              void apply(
                generateReportAction(
                  relationshipId,
                  reportKind,
                  newKey("report"),
                ),
              )
            }
          >
            {t("File a report")}
          </Button>
          <a
            className="cq-body-sm inline-flex min-h-11 items-center rounded-(--cq-radius-md) px-3 text-(--cq-text-secondary) underline underline-offset-2"
            href={`${base}/audit`}
            download
          >
            {t("Audit trail (CSV)")}
          </a>
        </div>
      </section>
    </div>
  );
}
