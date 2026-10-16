"use client";

import {
  useEffect,
  useId,
  useState,
  useTransition,
  type ReactNode,
} from "react";

import type {
  DealInstrument,
  DealViewDto,
  RecordDealTermsRequest,
  RelationshipReportKind,
} from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";
import { DialogContent, DialogRoot } from "@capital-q/ui/dialog";
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
import { DealGuide, DealStageStrip, dealDay } from "./deal-stage-strip";
import type { RelationshipSide } from "./relationship-words";
import { useT } from "@/features/i18n/language";

/**
 * The deal on the ONE relationship (founder, 2026-10-08; design
 * docs/design/2026-10-08/deal-close): the stage strip both sides see, the
 * next step this side may take, the terms, the reports at every stage, and
 * a clear final state -- closed (onboarding checklist, update cadence) or
 * not proceeding (archived, never deleted).
 *
 * Terms, signing and close each open a confirm that shows exactly what is
 * recorded; confirming is the approval, and a new key is made each time it
 * opens, so a retried press records once. Money (soft commit, sent,
 * received) stays on the Commitment card. Every state is the server's.
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
  START_DILIGENCE: "Start diligence from “How did it go?” above.",
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

/** The terms in one line; `t` puts the words in the reader's language. */
export function termsLine(
  terms: NonNullable<DealViewDto["terms"]>,
  t: (english: string) => string = (english) => english,
): string {
  const parts = [
    `${t(INSTRUMENTS.find((i) => i.code === terms.instrument)?.label ?? terms.instrument)} · ${money(terms.amount, terms.currencyCode)}`,
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
                Cancel
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
  "cq-body min-h-11 w-full border border-(--cq-border) bg-(--cq-surface) px-3 py-2 text-(--cq-text-primary)";

function TermsForm({
  view,
  pending,
  onRecord,
}: {
  readonly view: DealViewDto;
  readonly pending: boolean;
  readonly onRecord: (
    terms: RecordDealTermsRequest,
    key: string,
  ) => Promise<boolean>;
}) {
  const t = useT();

  const id = useId();
  const current = view.terms;
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
  const [basis, setBasis] = useState<"POST_MONEY" | "PRE_MONEY" | "PRICED">(
    current?.preMoneyValuation !== null &&
      current?.preMoneyValuation !== undefined
      ? "PRICED"
      : (current?.valuationBasis ?? "POST_MONEY"),
  );
  const [discount, setDiscount] = useState(current?.discountPercent ?? "");
  const [proRata, setProRata] = useState<"YES" | "NO" | "UNKNOWN">(
    current?.proRata === true
      ? "YES"
      : current?.proRata === false
        ? "NO"
        : "UNKNOWN",
  );
  const [other, setOther] = useState(current?.otherTerms ?? "");
  const [document, setDocument] = useState(current?.termsDocumentId ?? "");

  const terms: RecordDealTermsRequest = {
    instrument,
    amount: amount.amount,
    currencyCode: amount.currency,
    ...(cap.trim() === ""
      ? {}
      : basis === "PRICED"
        ? { preMoneyValuation: cap.trim() }
        : { valuationCap: cap.trim(), valuationBasis: basis }),
    ...(discount.trim() === "" ? {} : { discountPercent: discount.trim() }),
    ...(proRata === "UNKNOWN" ? {} : { proRata: proRata === "YES" }),
    ...(other.trim() === "" ? {} : { otherTerms: other.trim() }),
    ...(document === "" ? {} : { termsDocumentId: document }),
  };
  const preview = [
    `${t(INSTRUMENTS.find((i) => i.code === instrument)?.label ?? instrument)}, ${amount.amount === "" ? t("no amount") : money(amount.amount, amount.currency)}`,
    terms.valuationCap === undefined
      ? null
      : t(
          `cap ${money(terms.valuationCap, amount.currency)} ${basis === "PRE_MONEY" ? "pre-money" : "post-money"}`,
        ),
    terms.preMoneyValuation === undefined
      ? null
      : t(
          `pre-money valuation ${money(terms.preMoneyValuation, amount.currency)}`,
        ),
    terms.discountPercent === undefined
      ? null
      : t(`${terms.discountPercent}% discount`),
    terms.proRata === undefined
      ? t("pro-rata not stated")
      : terms.proRata
        ? t("pro-rata right")
        : t("no pro-rata right"),
    terms.otherTerms ?? null,
    terms.termsDocumentId === undefined
      ? t("no document attached")
      : t(shortDoc(terms.termsDocumentId)),
  ].filter((part): part is string => part !== null);

  return (
    <div className="flex flex-col gap-3" data-terms-form>
      <label className="flex flex-col gap-1.5" htmlFor={`${id}-instrument`}>
        <span className="cq-label text-(--cq-text-primary)">
          {t("Instrument")}
        </span>
        <select
          id={`${id}-instrument`}
          className={INPUT}
          value={instrument}
          onChange={(e) => setInstrument(e.target.value as DealInstrument)}
        >
          {INSTRUMENTS.map((option) => (
            <option key={option.code} value={option.code}>
              {t(option.label)}
            </option>
          ))}
        </select>
      </label>
      <MoneyInput
        id={`${id}-amount`}
        label={t("Investment")}
        value={amount}
        currencies={CURRENCIES}
        onChange={setAmount}
        disabled={pending}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5" htmlFor={`${id}-cap`}>
          <span className="cq-label text-(--cq-text-primary)">
            {basis === "PRICED" ? t("Pre-money valuation") : t("Valuation cap")}{" "}
            {t("(optional)")}
          </span>
          <input
            id={`${id}-cap`}
            inputMode="decimal"
            className={INPUT}
            value={cap}
            onChange={(e) => setCap(e.target.value.replace(/[^0-9.]/g, ""))}
          />
        </label>
        <label className="flex flex-col gap-1.5" htmlFor={`${id}-basis`}>
          <span className="cq-label text-(--cq-text-primary)">
            {t("Basis")}
          </span>
          <select
            id={`${id}-basis`}
            className={INPUT}
            value={basis}
            onChange={(e) => setBasis(e.target.value as typeof basis)}
          >
            <option value="POST_MONEY">{t("Post-money cap")}</option>
            <option value="PRE_MONEY">{t("Pre-money cap")}</option>
            <option value="PRICED">{t("Priced (pre-money valuation)")}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5" htmlFor={`${id}-discount`}>
          <span className="cq-label text-(--cq-text-primary)">
            {t("Discount % (optional)")}
          </span>
          <input
            id={`${id}-discount`}
            inputMode="decimal"
            className={INPUT}
            value={discount}
            onChange={(e) =>
              setDiscount(e.target.value.replace(/[^0-9.]/g, ""))
            }
          />
        </label>
        <label className="flex flex-col gap-1.5" htmlFor={`${id}-prorata`}>
          <span className="cq-label text-(--cq-text-primary)">
            {t("Pro-rata right")}
          </span>
          <select
            id={`${id}-prorata`}
            className={INPUT}
            value={proRata}
            onChange={(e) => setProRata(e.target.value as typeof proRata)}
          >
            <option value="UNKNOWN">{t("Not stated")}</option>
            <option value="YES">{t("Yes")}</option>
            <option value="NO">{t("No")}</option>
          </select>
        </label>
      </div>
      <label className="flex flex-col gap-1.5" htmlFor={`${id}-other`}>
        <span className="cq-label text-(--cq-text-primary)">
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
        <span className="cq-label text-(--cq-text-primary)">
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
      <Confirm
        label={
          current === null ? t("Record the terms") : t("Record a revision")
        }
        title={t("Record these terms?")}
        description={t(
          "Both sides see exactly these terms on the relationship. A later change is a new version; nothing is edited.",
        )}
        confirmLabel={t("Approve and record")}
        primary
        disabled={pending || amount.amount === ""}
        onConfirm={(key) => onRecord(terms, key)}
      >
        <ul
          className="cq-body flex list-disc flex-col gap-1 ps-5 text-(--cq-text-primary)"
          data-terms-preview
        >
          {preview.map((part) => (
            <li key={part}>{t(part)}</li>
          ))}
        </ul>
      </Confirm>
    </div>
  );
}

export function RelationshipDeal({
  relationshipId,
  counterpart,
  side,
  initial = null,
}: {
  readonly relationshipId: string;
  readonly counterpart: string;
  readonly side: RelationshipSide;
  /** For the design harness: a view to render without reading. */
  readonly initial?: DealViewDto | null | undefined;
}) {
  const t = useT();

  const [view, setView] = useState<DealViewDto | null>(initial);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [editingTerms, setEditingTerms] = useState(false);
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

  return (
    <div
      className="flex flex-col gap-5"
      data-deal={view.end?.kind ?? view.current ?? "NONE"}
    >
      <DealStageStrip view={view} />
      <DealGuide view={view} />

      {view.end?.kind === "CLOSED" ? (
        <section
          className="flex flex-col gap-3"
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
          className="cq-body border-s-2 border-(--cq-border) ps-3 text-(--cq-text-primary)"
          data-deal-final="PASSED"
        >
          {side === "INVESTOR" ? t("You decided") : t(`${counterpart} decided`)}{" "}
          {t("not to proceed on")} {t(dealDay(view.end.at))}
          {t(
            ". The relationship is archived, never deleted: its history and reports stay here.",
          )}
        </p>
      ) : null}

      {view.terms === null || editingTerms ? null : (
        <div className="flex flex-col gap-1" data-deal-terms>
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

      {steps.length === 0 ? null : (
        <div className="flex flex-col gap-3" data-deal-next>
          <h3 className="cq-body font-semibold text-(--cq-text-primary)">
            {t("Next step")}
          </h3>
          {steps
            .filter((step) => STEP_WORDS[step] !== undefined)
            .map((step) => (
              <p key={step} className="cq-body-sm text-(--cq-text-secondary)">
                {STEP_WORDS[step]}
              </p>
            ))}
          {steps.includes("RECORD_TERMS") ? (
            editingTerms || view.terms === null ? (
              <TermsForm
                view={view}
                pending={pending}
                onRecord={async (terms, key) => {
                  const done = await apply(
                    recordTermsAction(relationshipId, terms, key),
                  );
                  if (done) setEditingTerms(false);
                  return done;
                }}
              />
            ) : (
              <Button
                variant="quiet"
                className="min-h-11 self-start"
                onClick={() => setEditingTerms(true)}
              >
                {t("Revise the terms")}
              </Button>
            )
          ) : null}
          {steps.includes("MARK_SIGNED") && view.terms !== null ? (
            <div className="flex flex-col gap-2">
              <label
                className="cq-label text-(--cq-text-primary)"
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

      <section
        className="flex flex-col gap-2"
        aria-label={t("Reports")}
        data-deal-reports
      >
        <h3 className="cq-body font-semibold text-(--cq-text-primary)">
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
                  className="cq-body-sm inline-flex min-h-11 items-center border border-(--cq-border) px-3 text-(--cq-text-primary) hover:bg-(--cq-surface-subtle)"
                  href={`${base}/reports/${report.reportId}`}
                  download
                >
                  {t("PDF")}
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
            className="cq-body-sm inline-flex min-h-11 items-center px-3 text-(--cq-text-secondary) underline underline-offset-2"
            href={`${base}/audit`}
            download
          >
            {t("Audit trail (CSV)")}
          </a>
        </div>
      </section>

      {message === null ? null : (
        <p className="cq-body-sm text-(--cq-text-secondary)" role="status">
          {t(message)}
        </p>
      )}
    </div>
  );
}
