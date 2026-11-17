"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import { crmButton } from "@/features/relationships/crm-kit";
import { useT } from "@/features/i18n/language";

import { withdrawClaimAction } from "./readiness-actions";

/**
 * Withdraw one of their company's claims from the readiness evidence
 * (hygiene audit 2026-11-16 §4.2): a figure no longer right, or whose only
 * evidence was a document they archived. Asks for a reason and a second
 * press; the API writes a new revision marked withdrawn (nothing is
 * deleted) and investors stop seeing it. Q can prepare the same action
 * (propose_withdraw_company_claim) for their approval.
 */
export function ClaimWithdraw({ claimId }: { readonly claimId: string }) {
  const t = useT();
  const router = useRouter();
  const reasonId = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  // One key per confirm: the same if the press is retried, so it runs once.
  const [key, setKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <span className="flex flex-col items-end gap-1">
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setKey(`withdraw-${crypto.randomUUID()}`);
            setMessage(null);
          }}
          className={crmButton("quiet")}
          data-claim-withdraw={claimId}
        >
          {t("Withdraw")}
        </button>
        {message === null ? null : (
          <span role="status" className="cq-caption text-(--cq-text-secondary)">
            {t(message)}
          </span>
        )}
      </span>
    );
  }

  const submit = () => {
    if (key === null || reason.trim().length === 0) return;
    startTransition(async () => {
      const out = await withdrawClaimAction(claimId, reason.trim(), key);
      if (!out.ok) {
        setMessage(out.message);
        return;
      }
      setOpen(false);
      setReason("");
      setMessage(
        "Withdrawn. It stays in your history; investors no longer see it.",
      );
      router.refresh();
    });
  };

  return (
    <form
      data-q-editing
      className="flex w-full flex-col gap-2 rounded-(--cq-radius-md) border border-(--cq-border-subtle) bg-(--cq-surface-subtle) p-3"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <label
        htmlFor={reasonId}
        className="text-[13px] font-medium text-(--cq-text-primary)"
      >
        {t("Why are you withdrawing it?")}
      </label>
      <textarea
        id={reasonId}
        value={reason}
        maxLength={400}
        rows={2}
        required
        onChange={(event) => setReason(event.target.value)}
        className="cq-body-sm rounded-(--cq-radius-md) border border-(--cq-border) bg-(--cq-canvas) px-3 py-2 text-(--cq-text-primary) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)"
      />
      <p className="cq-caption text-(--cq-text-tertiary)">
        {t(
          "It stays in your company's history as withdrawn, with your reason. Investors stop seeing it. Nothing is deleted.",
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={pending || reason.trim().length === 0}
          className={crmButton("primary")}
        >
          {t("Withdraw claim")}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setOpen(false);
            setReason("");
          }}
          className={crmButton("quiet")}
        >
          {t("Cancel")}
        </button>
      </div>
      {message === null ? null : (
        <p role="status" className="cq-caption text-(--cq-text-secondary)">
          {t(message)}
        </p>
      )}
    </form>
  );
}
