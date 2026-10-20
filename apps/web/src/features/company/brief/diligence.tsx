"use client";

import type { ReactNode } from "react";

import type { AssumptionBoardDto, DataRoomView } from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";
import { ChevronDown, ICON_SIZE } from "@capital-q/ui/icons";

import { useT } from "@/features/i18n/language";

import { useBrief } from "./brief-context";
import { ledgerCounts, type LedgerFold, type LedgerRow } from "./diligence-model";
import { callMoment } from "./journey";
import { plural } from "./model";
import type { NextCall } from "./next-step";
import {
  BriefCard,
  BriefGrid,
  EvidenceBar,
  EvidenceLegend,
  EvidenceTag,
  QReadCard,
} from "./parts";

const shortDay = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(iso));

/**
 * The Diligence tab as the decision brief (ptabs "Diligence"): what is
 * document-supported, what is the founder's claim and what is not known
 * yet, counted and laid out in folds; the questions to investigate; and,
 * on the rail, the reader's own requests. Unknown never counts against
 * the company.
 */
export function DiligenceBrief({
  companyName,
  folds,
  board,
  dataRoom,
  nextCall,
  investor,
  lead,
  extras,
}: {
  readonly companyName: string;
  readonly folds: readonly LedgerFold[];
  readonly board: AssumptionBoardDto | null;
  readonly dataRoom: DataRoomView | null;
  readonly nextCall: NextCall | null;
  readonly investor: boolean;
  /** Above everything (the owner's pitch-and-raise notice). */
  readonly lead?: ReactNode;
  /** Rendered inside a fold, after its rows, by fold id. */
  readonly extras?: Readonly<Record<string, ReactNode>>;
}) {
  const t = useT();
  const brief = useBrief();
  const counts = ledgerCounts(folds);
  const drafts = brief?.drafts ?? [];
  const asked = (board?.assumptions ?? []).filter((a) => a.asked !== undefined);
  const room =
    dataRoom !== null && dataRoom.viewer === "INVESTOR" ? dataRoom.documents : [];
  const requested = brief?.requested ?? new Set<string>();
  const onRequest = room.filter(
    (doc) => doc.access === "REQUESTABLE" || doc.access === "REQUESTED",
  );

  const main = (
    <>
      {lead}
      <div className="cq-brief-covhead" data-diligence-counts>
        <div>
          <span className="cq-brief-label">{t("Document-supported")}</span>
          <b>{counts.doc}</b>
        </div>
        <div>
          <span className="cq-brief-label">{t("Founder’s claims")}</span>
          <b>{counts.claim}</b>
        </div>
        <div>
          <span className="cq-brief-label">{t("Not known yet")}</span>
          <b data-tone="gap">{counts.unknown}</b>
        </div>
      </div>
      <div className="flex flex-col gap-2.5">
        <EvidenceBar
          marks={counts.marks}
          label={`${String(counts.doc)} document-supported, ${String(counts.claim)} founder’s claims, ${String(counts.unknown)} not known yet`}
        />
        <EvidenceLegend />
      </div>
      {investor ? (
        <section
          className="cq-brief-card"
          aria-labelledby="questions-title"
          data-overview-fold="company-assumptions"
        >
          <div className="cq-brief-row">
            <h2 id="questions-title" className="cq-brief-title m-0">
              {t("Questions to investigate")}
            </h2>
            <span className="cq-brief-label">{t("What to ask before a call")}</span>
          </div>
          {drafts.length === 0 && asked.length === 0 ? (
            <p className="cq-body-sm text-(--cq-text-secondary)">
              {t("No open questions yet. Q adds one when it finds a gap.")}
            </p>
          ) : (
            <ol className="m-0 flex list-none flex-col p-0">
              {drafts.map((draft, index) => (
                <li key={draft.id} className="cq-brief-qrow" data-question="DRAFT">
                  <span className="cq-brief-num" aria-hidden="true">
                    {index + 1}
                  </span>
                  <div className="min-w-0">
                    <b>{draft.question}</b>
                    <span className="cq-brief-label">
                      {draft.from === "GAP"
                        ? "You added this from a gap. Not sent yet."
                        : "Q drafted this from a gap. Not sent yet."}
                    </span>
                  </div>
                </li>
              ))}
              {asked.map((a, index) => (
                <li
                  key={a.id}
                  className="cq-brief-qrow"
                  data-question={a.asked?.answer === null ? "WAITING" : "ANSWERED"}
                >
                  <span className="cq-brief-num" aria-hidden="true">
                    {drafts.length + index + 1}
                  </span>
                  <div className="min-w-0">
                    <b>{a.question}</b>
                    {a.asked === undefined ? null : a.asked.answer === null ? (
                      <span className="cq-brief-label">
                        You asked on {shortDay(a.asked.askedAt)}. Waiting for an
                        answer.
                      </span>
                    ) : (
                      <span className="flex flex-col gap-1 pt-1">
                        <span className="cq-body-sm text-(--cq-text-primary)">
                          {a.asked.answer.text}
                        </span>
                        <span className="cq-brief-label">
                          Founder’s answer, {shortDay(a.asked.answer.answeredAt)} ·{" "}
                          {a.asked.answer.evidenceStatus === "DOCUMENT_SUPPORTED"
                            ? "their claim, with a document"
                            : "their claim, self-reported"}
                        </span>
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      ) : null}
      <div className="cq-brief-folds">
        {folds.map((fold, index) => (
          <LedgerFoldView
            key={fold.id}
            fold={fold}
            open={index === 0}
            extra={extras?.[fold.id]}
          />
        ))}
      </div>
    </>
  );

  const rail = investor ? (
    <>
      <QReadCard>
        <p data-size="sm">
          {counts.doc === 0
            ? `Everything known so far comes from ${companyName}’s own deck, pitch and answers. Nothing is backed by a document yet.`
            : counts.claim >= counts.doc
              ? `Most of what is known comes from ${companyName}’s own deck and pitch. ${plural(counts.doc, "fact is", "facts are")} backed by a document so far.`
              : `${plural(counts.doc, "fact is", "facts are")} backed by a document, ${plural(counts.claim, "is", "are")} ${companyName}’s own claim.`}
        </p>
        {drafts.length + onRequest.length === 0 ? null : (
          <p className="qual">
            {[
              drafts.length === 0 ? null : plural(drafts.length, "question"),
              onRequest.length === 0
                ? null
                : `${plural(onRequest.length, "document")} on request`,
            ]
              .filter((part) => part !== null)
              .join(" and ")}{" "}
            would turn the largest claims into something you can check.
          </p>
        )}
      </QReadCard>
      <BriefCard title={t("Your requests")} data-diligence-requests="">
        <div className="cq-brief-rq">
          <span className="cq-brief-dot" data-k={drafts.length === 0 ? "ok" : "req"} />
          <div>
            <b>
              {drafts.length === 0
                ? brief !== null && brief.waiting > 0
                  ? `${plural(brief.waiting, "question")} waiting for ${brief.who}`
                  : "No questions waiting to send"
                : `${plural(drafts.length, "question")} for ${brief?.who ?? companyName}`}
            </b>
            <span className="cq-brief-label">
              {drafts.length === 0
                ? "You’ll get a message here when they answer."
                : "Drafted by Q. You approve before anything is sent."}
            </span>
          </div>
        </div>
        <div className="cq-brief-rq">
          <span
            className="cq-brief-dot"
            data-k={onRequest.length === 0 ? "miss" : "req"}
          />
          <div>
            <b>
              {onRequest.length === 0
                ? "No documents on request"
                : `${plural(onRequest.length, "document")} on request`}
            </b>
            <span className="cq-brief-label">
              {onRequest.length === 0
                ? "Documents listed to you on request appear here."
                : onRequest
                    .map((doc) =>
                      doc.access === "REQUESTED" ||
                      requested.has(doc.documentId) ||
                      requested.has("*")
                        ? `${doc.title} (asked)`
                        : doc.title,
                    )
                    .join(", ")}
            </span>
          </div>
        </div>
        <div className="cq-brief-rq">
          <span className="cq-brief-dot" data-k={nextCall === null ? "miss" : "ok"} />
          <div>
            <b>
              {nextCall === null
                ? "No call booked"
                : `Call on ${callMoment(nextCall.startsAt, nextCall.timeZone)}`}
            </b>
            <span className="cq-brief-label">
              {nextCall === null
                ? "Book one from your relationship’s calls."
                : nextCall.hasBrief
                  ? "Booked. Q’s brief is ready."
                  : "Booked. Q will prepare a brief."}
            </span>
          </div>
        </div>
        {brief === null || drafts.length === 0 ? null : (
          <Button variant="secondary" onClick={() => brief.openQuestions()}>
            {t("Review the questions")}
          </Button>
        )}
      </BriefCard>
    </>
  ) : null;

  return (
    <div data-profile-diligence>
      <BriefGrid main={main} rail={rail} />
    </div>
  );
}

function LedgerRowView({ row }: { readonly row: LedgerRow }) {
  return (
    <div className="cq-brief-erow" data-gap={row.value === null ? "" : undefined}>
      <span className="ek">{row.label}</span>
      <span className="evv">{row.value ?? "Not stated"}</span>
      <span className="et">
        <EvidenceTag
          evidence={row.value === null ? "unk" : row.evidence}
          where={row.where}
        />
      </span>
    </div>
  );
}

function LedgerFoldView({
  fold,
  open,
  extra,
}: {
  readonly fold: LedgerFold;
  readonly open: boolean;
  readonly extra: ReactNode;
}) {
  return (
    <details className="cq-brief-fold" data-overview-fold={fold.id} open={open}>
      <summary>
        <div className="min-w-0">
          <h3 id={fold.id} className="ft m-0">
            {fold.title}
          </h3>
          <p className="fs m-0">{fold.summary}</p>
        </div>
        <span className="ftally">
          <EvidenceBar
            size="sm"
            marks={fold.rows.map((row) => (row.value === null ? "unk" : row.evidence))}
          />
        </span>
        <span className="chev">
          <ChevronDown size={ICON_SIZE.regular} aria-hidden="true" />
        </span>
      </summary>
      <div className="fbi">
        {fold.lead === null ? null : (
          <p className="cq-brief-fnote" data-raise-explainer="PITCH_ONLY">
            {fold.lead}
          </p>
        )}
        {fold.rows.map((row) => (
          <LedgerRowView key={row.key} row={row} />
        ))}
        {fold.note === null ? null : (
          <p className="cq-brief-label" style={{ marginTop: 8 }}>
            {fold.note}
          </p>
        )}
        {extra === undefined || extra === null ? null : (
          <div className="flex flex-col gap-3 pt-3">{extra}</div>
        )}
      </div>
    </details>
  );
}
