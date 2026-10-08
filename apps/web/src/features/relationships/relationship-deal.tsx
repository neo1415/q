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
import { DealStageStrip, dealDay } from "./deal-stage-strip";
import type { RelationshipSide } from "./relationship-words";

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
  SOFT_COMMIT: "Record a soft commit on the Commitment card.",
  SEND_FUNDS: "Mark the money sent on the Commitment card.",
  CONFIRM_FUNDS: "Confirm the money arrived on the Commitment card.",
};

const newKey = (what: string) => `web-deal-${what}-${crypto.randomUUID()}`;

const money = (amount: string, currency: string) =>
  `${currency} ${formatAmountForDisplay(amount)}`;

const shortDoc = (id: string) => `Shared document ${id.slice(0, 8)}`;

export function termsLine(terms: NonNullable<DealViewDto["terms"]>): string {
  const parts = [
    `${INSTRUMENTS.find((i) => i.code === terms.instrument)?.label ?? terms.instrument} · ${money(terms.amount, terms.currencyCode)}`,
  ];
  if (terms.valuationCap !== null) {
    parts.push(
      `cap ${money(terms.valuationCap, terms.currencyCode)}${terms.valuationBasis === "PRE_MONEY" ? " pre-money" : " post-money"}`,
    );
  }
  if (terms.preMoneyValuation !== null) {
    parts.push(
      `pre-money ${money(terms.preMoneyValuation, terms.currencyCode)}`,
    );
  }
  if (terms.discountPercent !== null)
    parts.push(`${terms.discountPercent}% discount`);
  if (terms.proRata !== null)
    parts.push(terms.proRata ? "pro-rata" : "no pro-rata");
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
        className="min-h-11"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        {label}
      </Button>
      {open ? (
        <DialogContent
          title={title}
          description={description}
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
  "cq-body min-h-11 w-full rounded-md border border-(--cq-border) bg-(--cq-surface) px-3 py-2 text-(--cq-text-primary)";

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
    `${INSTRUMENTS.find((i) => i.code === instrument)?.label ?? instrument}, ${amount.amount === "" ? "no amount" : money(amount.amount, amount.currency)}`,
    terms.valuationCap === undefined
      ? null
      : `cap ${money(terms.valuationCap, amount.currency)} ${basis === "PRE_MONEY" ? "pre-money" : "post-money"}`,
    terms.preMoneyValuation === undefined
      ? null
      : `pre-money valuation ${money(terms.preMoneyValuation, amount.currency)}`,
    terms.discountPercent === undefined
      ? null
      : `${terms.discountPercent}% discount`,
    terms.proRata === undefined
      ? "pro-rata not stated"
      : terms.proRata
        ? "pro-rata right"
        : "no pro-rata right",
    terms.otherTerms ?? null,
    terms.termsDocumentId === undefined
      ? "no document attached"
      : shortDoc(terms.termsDocumentId),
  ].filter((part): part is string => part !== null);

  return (
    <div className="flex flex-col gap-3" data-terms-form>
      <label className="flex flex-col gap-1.5" htmlFor={`${id}-instrument`}>
        <span className="cq-label text-(--cq-text-primary)">Instrument</span>
        <select
          id={`${id}-instrument`}
          className={INPUT}
          value={instrument}
          onChange={(e) => setInstrument(e.target.value as DealInstrument)}
        >
          {INSTRUMENTS.map((option) => (
            <option key={option.code} value={option.code}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <MoneyInput
        id={`${id}-amount`}
        label="Investment"
        value={amount}
        currencies={CURRENCIES}
        onChange={setAmount}
        disabled={pending}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5" htmlFor={`${id}-cap`}>
          <span className="cq-label text-(--cq-text-primary)">
            {basis === "PRICED" ? "Pre-money valuation" : "Valuation cap"}{" "}
            (optional)
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
          <span className="cq-label text-(--cq-text-primary)">Basis</span>
          <select
            id={`${id}-basis`}
            className={INPUT}
            value={basis}
            onChange={(e) => setBasis(e.target.value as typeof basis)}
          >
            <option value="POST_MONEY">Post-money cap</option>
            <option value="PRE_MONEY">Pre-money cap</option>
            <option value="PRICED">Priced (pre-money valuation)</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5" htmlFor={`${id}-discount`}>
          <span className="cq-label text-(--cq-text-primary)">
            Discount % (optional)
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
            Pro-rata right
          </span>
          <select
            id={`${id}-prorata`}
            className={INPUT}
            value={proRata}
            onChange={(e) => setProRata(e.target.value as typeof proRata)}
          >
            <option value="UNKNOWN">Not stated</option>
            <option value="YES">Yes</option>
            <option value="NO">No</option>
          </select>
        </label>
      </div>
      <label className="flex flex-col gap-1.5" htmlFor={`${id}-other`}>
        <span className="cq-label text-(--cq-text-primary)">
          Other terms (optional)
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
          Terms document (shared in the data room)
        </span>
        <select
          id={`${id}-doc`}
          className={INPUT}
          value={document}
          onChange={(e) => setDocument(e.target.value)}
        >
          <option value="">None attached</option>
          {view.sharedDocumentIds.map((doc) => (
            <option key={doc} value={doc}>
              {shortDoc(doc)}
            </option>
          ))}
        </select>
      </label>
      <Confirm
        label={current === null ? "Record the terms" : "Record a revision"}
        title="Record these terms?"
        description="Both sides see exactly these terms on the relationship. A later change is a new version; nothing is edited."
        confirmLabel="Approve and record"
        primary
        disabled={pending || amount.amount === ""}
        onConfirm={(key) => onRecord(terms, key)}
      >
        <ul
          className="cq-body flex list-disc flex-col gap-1 pl-5 text-(--cq-text-primary)"
          data-terms-preview
        >
          {preview.map((part) => (
            <li key={part}>{part}</li>
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
    void readDealAction(relationshipId).then((result) => {
      if (live && result.ok) setView(result.value);
    });
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

      {view.end?.kind === "CLOSED" ? (
        <section
          className="flex flex-col gap-3"
          aria-label="Investment closed"
          data-deal-final="CLOSED"
        >
          <p className="cq-body text-(--cq-text-primary)">
            <strong>Investment closed</strong> on {dealDay(view.end.at)}
            {view.terms === null ? "" : `: ${termsLine(view.terms)}`}. This is
            the final state; the history and reports stay.
          </p>
          {side === "INVESTOR" ? (
            <p className="cq-body-sm text-(--cq-text-secondary)">
              {counterpart} is in your portfolio: it counts in{" "}
              <a className="underline underline-offset-2" href="/results">
                Results
              </a>{" "}
              from the money received.
            </p>
          ) : null}
          {view.updateCadence === null ? null : (
            <p className="cq-body-sm text-(--cq-text-secondary)">
              Q suggests: {view.updateCadence}
            </p>
          )}
          <h3 className="cq-body font-semibold text-(--cq-text-primary)">
            {side === "COMPANY" ? "Investor onboarded" : "Portfolio entry"}
          </h3>
          <ul className="flex flex-col gap-1" data-deal-checklist>
            {view.checklist.map((item) => (
              <li key={item.code} className="flex min-h-11 items-center gap-3">
                <input
                  type="checkbox"
                  className="size-5 accent-(--cq-accent)"
                  checked={item.done}
                  disabled={item.done || pending}
                  aria-label={item.label}
                  onChange={() =>
                    void apply(tickChecklistAction(relationshipId, item.code))
                  }
                />
                <span
                  className={`cq-body ${item.done ? "text-(--cq-text-secondary)" : "text-(--cq-text-primary)"}`}
                >
                  {item.label}
                  {item.fromRecord ? (
                    <span className="cq-caption text-(--cq-text-tertiary)">
                      {" "}
                      · from the record
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
          className="cq-body border-l-2 border-(--cq-border) pl-3 text-(--cq-text-primary)"
          data-deal-final="PASSED"
        >
          {side === "INVESTOR" ? "You decided" : `${counterpart} decided`} not
          to proceed on {dealDay(view.end.at)}. The relationship is archived,
          never deleted: its history and reports stay here.
        </p>
      ) : null}

      {view.terms === null || editingTerms ? null : (
        <div className="flex flex-col gap-1" data-deal-terms>
          <span className="cq-caption text-(--cq-text-tertiary)">
            Terms · version {view.terms.version} · recorded by{" "}
            {view.terms.recordedBy ??
              (view.terms.recordedBySide === side
                ? "your side"
                : counterpart)}{" "}
            on {dealDay(view.terms.recordedAt)}
          </span>
          <span className="cq-body text-(--cq-text-primary)">
            {termsLine(view.terms)}
          </span>
          <span className="cq-body-sm text-(--cq-text-secondary)">
            {view.terms.signedAt === null
              ? "Not signed yet."
              : `Signed ${dealDay(view.terms.signedAt)}, signed copy on file.`}
          </span>
        </div>
      )}

      {steps.length === 0 ? null : (
        <div className="flex flex-col gap-3" data-deal-next>
          <h3 className="cq-body font-semibold text-(--cq-text-primary)">
            Next step
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
                Revise the terms
              </Button>
            )
          ) : null}
          {steps.includes("MARK_SIGNED") && view.terms !== null ? (
            <div className="flex flex-col gap-2">
              <label
                className="cq-label text-(--cq-text-primary)"
                htmlFor={`${noteId}-signed`}
              >
                Signed copy (shared with {counterpart} in the data room)
              </label>
              <select
                id={`${noteId}-signed`}
                className={INPUT}
                value={signedDoc}
                onChange={(e) => setSignedDoc(e.target.value)}
              >
                <option value="">Choose the signed copy</option>
                {signCandidates.map((doc) => (
                  <option key={doc} value={doc}>
                    {shortDoc(doc)}
                  </option>
                ))}
              </select>
              <Confirm
                label="Record as signed"
                title={`Record terms v${String(view.terms.version)} as signed?`}
                description="Both sides see the terms marked signed with the signed copy attached. It applies to exactly this version: if the terms change first, nothing is recorded."
                confirmLabel="Approve and record"
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
                  {termsLine(view.terms)}
                </p>
                <p className="cq-body-sm text-(--cq-text-secondary)">
                  {signedDoc === "" ? "" : shortDoc(signedDoc)}
                </p>
              </Confirm>
            </div>
          ) : null}
          {steps.includes("CLOSE") ? (
            <Confirm
              label="Close the investment"
              title={`Close the investment with ${counterpart}?`}
              description="Signed terms and received money: both sides see it closed, a closing report is filed, and this becomes the relationship's final state."
              confirmLabel="Approve and close"
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
                A closing note both sides see (optional)
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
        aria-label="Reports"
        data-deal-reports
      >
        <h3 className="cq-body font-semibold text-(--cq-text-primary)">
          Reports
        </h3>
        {view.reports.length === 0 ? (
          <p className="cq-body-sm text-(--cq-text-secondary)">
            No report filed yet. Reports are compiled from the record at each
            stage.
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
                    {REPORT_WORDS[report.kind]}
                  </span>
                  <span className="cq-caption text-(--cq-text-tertiary)">
                    v{report.version} · {dealDay(report.createdAt)} ·{" "}
                    {report.visibility === "relationship_shared"
                      ? `Shared with ${counterpart}`
                      : "Only your organisation"}
                  </span>
                </span>
                <a
                  className="cq-body-sm inline-flex min-h-11 items-center rounded-md border border-(--cq-border) px-3 text-(--cq-text-primary) hover:bg-(--cq-surface-subtle)"
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
            Report
          </label>
          <select
            id={`${noteId}-kind`}
            className={`${INPUT} w-auto`}
            value={reportKind}
            onChange={(e) =>
              setReportKind(e.target.value as RelationshipReportKind)
            }
          >
            {reportKinds.map((kind) => (
              <option key={kind} value={kind}>
                {REPORT_WORDS[kind]}
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
            File a report
          </Button>
          <a
            className="cq-body-sm inline-flex min-h-11 items-center rounded-md px-3 text-(--cq-text-secondary) underline underline-offset-2"
            href={`${base}/audit`}
            download
          >
            Audit trail (CSV)
          </a>
        </div>
      </section>

      {message === null ? null : (
        <p className="cq-body-sm text-(--cq-text-secondary)" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
