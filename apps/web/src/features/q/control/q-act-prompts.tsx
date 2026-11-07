"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "@capital-q/ui/button";

import { useT } from "@/features/i18n/language";
import { useActSlot } from "@/features/workspace/act-slot";

import { subscribeConfirms, type ConfirmRequest } from "./approval";
import {
  approveRequest,
  declineRequest,
  subscribeApprovals,
  type ApprovalRequest,
} from "./approval-requests";

/**
 * W5.1 (plan §7): what Q asks of the person before it acts on a page.
 *
 * - CONFIRM: one line and one tap ("Save Brightwell to your list").
 * - APPROVAL: what Q prepared, with its exact payload in full, and
 *   Approve / Not now. Approve runs it on that payload only; anything
 *   edited after needs approving again (approval.ts).
 *
 * Mounted once, by the shell's control runtime. Nothing here runs on a
 * model's word: only the person's own tap answers.
 */
export function QActPrompts() {
  const t = useT();
  const [confirms, setConfirms] = useState<readonly ConfirmRequest[]>([]);
  const [approvals, setApprovals] = useState<readonly ApprovalRequest[]>([]);
  useEffect(() => subscribeConfirms(setConfirms), []);
  useEffect(() => subscribeApprovals(setApprovals), []);
  const [failed, setFailed] = useState<string | null>(null);
  // Q Workspace (batch 8): in the Q pane's own slot, in its flow and at its
  // width; floating over the screen only where there is no pane.
  const slot = useActSlot();

  if (confirms.length === 0 && approvals.length === 0 && failed === null) {
    return null;
  }
  const prompts = (
    <div
      className={
        slot === null
          ? "fixed inset-x-4 bottom-24 z-(--cq-z-toast) mx-auto flex w-full max-w-[min(32rem,calc(100vw-2rem))] flex-col gap-2"
          : "flex max-h-[45vh] w-full flex-col gap-2 overflow-y-auto"
      }
      data-q-act-prompts={slot === null ? "floating" : "in-pane"}
    >
      {confirms.map((request) => (
        <div
          key={request.id}
          role="alertdialog"
          aria-label={t("Confirm what Q will do")}
          className="flex flex-wrap items-center gap-3 rounded-md border border-(--cq-border-subtle) bg-(--cq-surface-raised) px-4 py-3 shadow-(--cq-shadow-overlay)"
          data-q-confirm
        >
          <p className="m-0 min-w-0 flex-1 cq-body-sm text-(--cq-text-primary)">
            {request.summary}
          </p>
          <div className="flex gap-2">
            <Button
              variant="quiet"
              className="min-h-11"
              onClick={() => request.answer(false)}
            >
              {t("Not now")}
            </Button>
            <Button
              className="min-h-11"
              onClick={() => request.answer(true)}
              data-q-confirm-yes
            >
              {t("Confirm")}
            </Button>
          </div>
        </div>
      ))}
      {approvals.map((request) => (
        <section
          key={request.id}
          role="alertdialog"
          aria-label={t("Q prepared this for your approval")}
          className="flex flex-col gap-3 rounded-md border border-(--cq-border-subtle) bg-(--cq-surface-raised) px-4 py-3 shadow-(--cq-shadow-overlay)"
          data-q-approval={request.actionId}
        >
          <p className="m-0 cq-caption text-(--cq-text-secondary)">
            {t("Q prepared this for your approval")}
          </p>
          <p className="m-0 cq-body-sm text-(--cq-text-primary)">
            {request.summary}
          </p>
          {/* The exact payload that will run, in full: what is approved. */}
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 cq-caption">
            {Object.entries(request.payload).map(([key, value]) => (
              <div key={key} className="contents">
                <dt className="text-(--cq-text-secondary)">{key}</dt>
                <dd className="m-0 break-words text-(--cq-text-primary)">
                  {String(value)}
                </dd>
              </div>
            ))}
          </dl>
          <div className="flex justify-end gap-2">
            <Button
              variant="quiet"
              className="min-h-11"
              onClick={() => declineRequest(request.id)}
            >
              {t("Not now")}
            </Button>
            <Button
              className="min-h-11"
              onClick={() => {
                void approveRequest(request.id).then((outcome) => {
                  if (outcome.status === "DONE") return;
                  setFailed(
                    outcome.status === "REFUSED" &&
                      outcome.reason === "PAYLOAD_CHANGED"
                      ? "It changed after Q prepared it. Ask Q again to approve the new version."
                      : "That didn't go through. Nothing was sent.",
                  );
                });
              }}
              data-q-approve
            >
              {t("Approve")}
            </Button>
          </div>
        </section>
      ))}
      {failed === null ? null : (
        <p
          role="status"
          className="m-0 rounded-md border border-(--cq-border-subtle) bg-(--cq-surface-raised) px-4 py-2 cq-caption text-(--cq-text-secondary)"
        >
          {t(failed)}{" "}
          <button
            type="button"
            className="cq-stage-quiet min-h-11"
            onClick={() => setFailed(null)}
          >
            {t("Dismiss")}
          </button>
        </p>
      )}
    </div>
  );
  return slot === null ? prompts : createPortal(prompts, slot);
}
