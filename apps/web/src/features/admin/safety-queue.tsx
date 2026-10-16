"use client";

import Link from "next/link";
import { useId, useState } from "react";

import type {
  AdminBreakGlassRowDto,
  AdminSafetyReportDto,
} from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";
import { DialogContent, DialogRoot } from "@capital-q/ui/dialog";
import { Select } from "@capital-q/ui/select";
import { Textarea } from "@capital-q/ui/input";

import {
  decideBreakGlassAction,
  requestBreakGlassAction,
  reviewReportAction,
} from "./console-actions";
import { ReasonAction, ResultLine, useConsoleAction } from "./console-ui";
import { useT } from "@/features/i18n/language";

type Outcome = "NO_ACTION" | "WARNED" | "ACCOUNT_SUSPENDED" | "ESCALATED";

const OUTCOMES: readonly { readonly value: Outcome; readonly label: string }[] =
  [
    { value: "NO_ACTION", label: "No action" },
    { value: "WARNED", label: "Warned" },
    { value: "ACCOUNT_SUSPENDED", label: "Suspend an account" },
    { value: "ESCALATED", label: "Escalate" },
  ];

const OUTCOME_WORDS: Readonly<Record<Outcome, string>> = {
  NO_ACTION: "No action",
  WARNED: "Warned",
  ACCOUNT_SUSPENDED: "Account suspended",
  ESCALATED: "Escalated",
};

function ReviewReport({ report }: { readonly report: AdminSafetyReportDto }) {
  const t = useT();

  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>("NO_ACTION");
  const [note, setNote] = useState("");
  const [member, setMember] = useState(report.reportedMembers[0]?.userId ?? "");
  const { perform, pending, result } = useConsoleAction();
  const outcomeId = useId();
  const memberId = useId();
  const noteId = useId();
  const needsMember = outcome === "ACCOUNT_SUSPENDED";
  const ready = note.trim().length >= 3 && (!needsMember || member !== "");
  return (
    <div className="flex flex-col items-start gap-1">
      <Button size="compact" disabled={pending} onClick={() => setOpen(true)}>
        {t("Review")}
      </Button>
      <ResultLine result={result} />
      <DialogRoot open={open} onOpenChange={setOpen}>
        <DialogContent
          title={t("Review this report")}
          description={t("Your decision and note are kept in the audit log.")}
          actions={
            <>
              <Button variant="quiet" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                variant={needsMember ? "danger" : "primary"}
                disabled={!ready || pending}
                onClick={() => {
                  setOpen(false);
                  perform(() =>
                    reviewReportAction({
                      reportId: report.reportId,
                      outcome,
                      note: note.trim(),
                      suspendUserId: needsMember ? member : null,
                    }),
                  );
                }}
              >
                Record review
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            <Select
              id={outcomeId}
              label={t("Decision")}
              value={outcome}
              options={OUTCOMES}
              onChange={(event) => setOutcome(event.target.value as Outcome)}
            />
            {needsMember ? (
              report.reportedMembers.length === 0 ? (
                <p className="cq-caption text-(--cq-text-secondary)">
                  {t("The reported side has no active member to suspend.")}
                </p>
              ) : (
                <Select
                  id={memberId}
                  label={t("Account to suspend")}
                  value={member}
                  options={report.reportedMembers.map((m) => ({
                    value: m.userId,
                    label: m.name ?? "Unnamed member",
                  }))}
                  onChange={(event) => setMember(event.target.value)}
                />
              )
            ) : null}
            <Textarea
              id={noteId}
              label={t("Note")}
              description={t("At least 3 characters.")}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
        </DialogContent>
      </DialogRoot>
    </div>
  );
}

export function SafetyReports({
  reports,
  canDecide,
  canBreakGlass,
}: {
  readonly reports: readonly AdminSafetyReportDto[];
  readonly canDecide: boolean;
  readonly canBreakGlass: boolean;
}) {
  const t = useT();

  return (
    <ul className="divide-y divide-(--cq-border-subtle) border-y border-(--cq-border-subtle)">
      {reports.map((report) => (
        <li key={report.reportId} className="flex flex-col gap-3 py-4">
          <div className="flex flex-col gap-1">
            <span className="cq-body font-medium text-(--cq-text-primary)">
              {t(report.reasonLabel)} · {report.companyName} ↔{" "}
              {report.investorName}
            </span>
            <span className="cq-caption text-(--cq-text-secondary)">
              {t("Reported by")} {t(report.reporterName ?? "a member")}{" "}
              {t("on the")}{" "}
              {report.reporterSide === "COMPANY" ? "company" : "investor"}{" "}
              {t("side")}
              {report.aboutMessage
                ? t(" about a message")
                : t(" about the conversation")}{" "}
              · {t(new Date(report.createdAt).toLocaleDateString("en-GB"))}
            </span>
            {report.note === null ? null : (
              <span className="cq-body-sm text-(--cq-text-primary)">
                &ldquo;{report.note}&rdquo;
              </span>
            )}
            {report.review === null ? null : (
              <span className="cq-caption text-(--cq-text-secondary)">
                {t(OUTCOME_WORDS[report.review.outcome])} {t("by")}{" "}
                {t(report.review.reviewerName ?? "an admin")}:{" "}
                {report.review.note}
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {canDecide ? <ReviewReport report={report} /> : null}
            {canBreakGlass ? (
              <ReasonAction
                label={t("Ask to read the chat")}
                title={t("Ask to read this conversation?")}
                description={t(
                  "Chats are private. A second admin must approve; access lasts 30 minutes and every read is logged.",
                )}
                confirm="Send request"
                minLength={20}
                reasonLabel="Why you need to read it"
                run={(reason) =>
                  requestBreakGlassAction({
                    targetType: "RELATIONSHIP_CHAT",
                    targetId: report.relationshipId,
                    reason,
                  })
                }
              />
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

const STATUS_WORDS = {
  PENDING: "Waiting for a second admin",
  APPROVED: "Approved",
  DENIED: "Denied",
  EXPIRED: "Expired",
} as const;

export function BreakGlassList({
  rows,
  viewerId,
}: {
  readonly rows: readonly AdminBreakGlassRowDto[];
  readonly viewerId: string | null;
}) {
  const t = useT();

  return (
    <ul className="divide-y divide-(--cq-border-subtle) border-y border-(--cq-border-subtle)">
      {rows.map((row) => {
        const mine = row.requesterUserId === viewerId;
        return (
          <li key={row.requestId} className="flex flex-col gap-2 py-4">
            <span className="cq-body text-(--cq-text-primary)">
              {row.targetLabel ??
                (row.targetType === "Q_RUN"
                  ? t("A Q run")
                  : t("A conversation"))}{" "}
              · {t(STATUS_WORDS[row.status])}
              {row.approvalKind === "SOLO"
                ? t(" · Approved alone (no other admin)")
                : ""}
            </span>
            <span className="cq-caption text-(--cq-text-secondary)">
              {row.requesterName ?? t("An admin")}: &ldquo;{t(row.reason)}
              &rdquo;
              {row.decidedByName === null
                ? ""
                : t(` · decided by ${row.decidedByName}`)}
              {row.expiresAt === null || row.status !== "APPROVED"
                ? ""
                : t(
                    ` · until ${new Date(row.expiresAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`,
                  )}
              {row.reads === 0 ? "" : t(` · read ${String(row.reads)} times`)}
            </span>
            <div className="flex flex-wrap gap-2">
              {row.canDecide === null ? null : (
                <>
                  <ReasonAction
                    label={
                      row.canDecide === "SOLO"
                        ? t("Approve alone")
                        : t("Approve")
                    }
                    title={t("Approve this request?")}
                    description={
                      row.canDecide === "SOLO"
                        ? t(
                            "No other admin can approve, so this is recorded as a solo approval.",
                          )
                        : t(
                            "They can read the content for 30 minutes. Every read is logged.",
                          )
                    }
                    confirm="Approve"
                    variant="primary"
                    reasonLabel="Note"
                    run={(note) =>
                      decideBreakGlassAction({
                        requestId: row.requestId,
                        approve: true,
                        note,
                      })
                    }
                  />
                  {row.canDecide === "SECOND_PERSON" ? (
                    <ReasonAction
                      label={t("Deny")}
                      title={t("Deny this request?")}
                      confirm="Deny"
                      reasonLabel="Note"
                      run={(note) =>
                        decideBreakGlassAction({
                          requestId: row.requestId,
                          approve: false,
                          note,
                        })
                      }
                    />
                  ) : null}
                </>
              )}
              {mine && row.status === "APPROVED" ? (
                <Link
                  className="cq-body-sm inline-flex min-h-11 items-center underline underline-offset-4"
                  href={
                    row.targetType === "Q_RUN"
                      ? `/admin/q/runs/${row.targetId}`
                      : `/admin/safety/break-glass/${row.requestId}`
                  }
                >
                  {row.targetType === "Q_RUN"
                    ? t("Open the run")
                    : t("Read the conversation")}
                </Link>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
