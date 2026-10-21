"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";

import { cx } from "@capital-q/ui";
import { Check } from "@capital-q/ui/icons";

import {
  accountButton,
  fieldClassName,
  Pending,
  RadioList,
  useAccountToast,
} from "@/features/settings/account-kit";
import { useT } from "@/features/i18n/language";

import { requestReviewAction } from "./review-actions";
import { SUBJECT_OPTIONS } from "./review-subjects";

type Subject = (typeof SUBJECT_OPTIONS)[number]["value"];

/**
 * Asking a person at Capital Q to look again (appeals Stage 4; chosen
 * design "Short form, answer promised", 2026-10-21): what it is about, as
 * four or five plain choices each described, then why in the person's own
 * words. The reference is whatever screen sent them here, never content;
 * one key per attempt so a double press records one case.
 */
export function ReviewForm({
  subject,
  subjectRef,
  review,
}: {
  readonly subject: string;
  readonly subjectRef: string | null;
  /**
   * Design review only (/dev/account-review): the reason typed in and the
   * send's phase or error, given.
   */
  readonly review?:
    | {
        readonly reason: string;
        readonly phase: "idle" | "pending" | "done";
        readonly error?: string | undefined;
      }
    | undefined;
}) {
  const t = useT();
  const toast = useAccountToast();
  const router = useRouter();
  const [subjectType, setSubjectType] = useState<Subject>(
    SUBJECT_OPTIONS.find((option) => option.value === subject)?.value ??
      "Q_ASSESSMENT",
  );
  const [reason, setReason] = useState(review?.reason ?? "");
  const [phase, setPhase] = useState<"idle" | "pending" | "done">(
    review?.phase ?? "idle",
  );
  const [error, setError] = useState<string | null>(review?.error ?? null);
  const attempt = useRef<string | null>(null);
  const reasonId = useId();
  const hintId = useId();
  const ready = reason.trim().length >= 10;
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready || phase !== "idle") return;
        attempt.current ??= crypto.randomUUID();
        const key = attempt.current;
        setPhase("pending");
        setError(null);
        void requestReviewAction({
          subjectType,
          subjectRef,
          reason,
          attemptKey: key,
        }).then((outcome) => {
          if (!outcome.ok) {
            setPhase("idle");
            setError(outcome.message);
            return;
          }
          attempt.current = null;
          setPhase("done");
          toast(t("Sent. A person at Capital Q will answer within 3 days."));
          setTimeout(() => {
            setReason("");
            setPhase("idle");
            router.refresh();
          }, 1600);
        });
      }}
      data-review-form
    >
      <span className="text-[13px] font-medium text-(--cq-text-secondary)">
        {t("What is it about?")}
      </span>
      <RadioList
        name="review-subject"
        label={t("What is it about?")}
        value={subjectType}
        onChange={setSubjectType}
        choices={SUBJECT_OPTIONS.map((option) => ({
          key: option.value,
          title: t(option.label),
          description: t(option.description),
        }))}
      />
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={reasonId}
          className="text-[13px] font-medium text-(--cq-text-secondary)"
        >
          {t("What should a person look at?")}
        </label>
        <textarea
          id={reasonId}
          value={reason}
          maxLength={2000}
          aria-describedby={hintId}
          placeholder={t(
            "In your own words. If you have new evidence, add it to your profile or documents first; the reviewer reads it there.",
          )}
          onChange={(event) => setReason(event.target.value)}
          className={cx(fieldClassName, "min-h-[84px] resize-y")}
        />
        <small id={hintId} className="text-xs text-(--cq-text-tertiary)">
          {t("Say what you want reviewed and why, in at least a sentence.")}
        </small>
      </div>
      {error === null ? null : (
        <p role="alert" className="m-0 text-sm text-(--cq-text-primary)">
          {error}
        </p>
      )}
      <button
        type="submit"
        className={accountButton(
          phase === "done" ? "done" : "primary",
          "regular",
          "self-start",
        )}
        disabled={phase !== "idle" || !ready}
        aria-busy={phase === "pending"}
        data-review-send
      >
        {phase === "pending" ? (
          <Pending>{t("Sending…")}</Pending>
        ) : phase === "done" ? (
          <>
            <Check size={14} aria-hidden="true" />
            {t("Sent")}
          </>
        ) : (
          t("Ask for a review")
        )}
      </button>
    </form>
  );
}
