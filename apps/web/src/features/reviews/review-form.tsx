"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition } from "react";

import { Button } from "@capital-q/ui/button";
import { Textarea } from "@capital-q/ui/input";
import { Select } from "@capital-q/ui/select";

import { requestReviewAction, type FormResult } from "./review-actions";

export const SUBJECT_OPTIONS = [
  { value: "VERIFICATION_DECISION", label: "A verification decision" },
  { value: "READINESS_ASSESSMENT", label: "My readiness reading" },
  { value: "ACCOUNT_ACTION", label: "An action on my account" },
  { value: "Q_ASSESSMENT", label: "An assessment Q made" },
  { value: "OTHER", label: "Something else" },
] as const;

/**
 * Asking a person at Capital Q to look again (appeals Stage 4). The reason
 * is the person's own words; the reference is whatever screen sent them
 * here, never content.
 */
export function ReviewForm({
  subject,
  subjectRef,
}: {
  readonly subject: string;
  readonly subjectRef: string | null;
}) {
  const router = useRouter();
  const [subjectType, setSubjectType] = useState(
    SUBJECT_OPTIONS.some((o) => o.value === subject) ? subject : "OTHER",
  );
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<FormResult | null>(null);
  const [pending, startTransition] = useTransition();
  const attempt = useRef<string | null>(null);
  const subjectId = useId();
  const reasonId = useId();
  return (
    <form
      className="flex max-w-(--cq-layout-narrow) flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        attempt.current ??= crypto.randomUUID();
        const key = attempt.current;
        startTransition(async () => {
          const outcome = await requestReviewAction({
            subjectType,
            subjectRef,
            reason,
            attemptKey: key,
          });
          setResult(outcome);
          if (outcome.ok) {
            attempt.current = null;
            setReason("");
            router.refresh();
          }
        });
      }}
    >
      <Select
        id={subjectId}
        label="What should a person look at?"
        value={subjectType}
        options={SUBJECT_OPTIONS}
        onChange={(event) => setSubjectType(event.target.value)}
      />
      <Textarea
        id={reasonId}
        label="Why"
        description="In your own words. If you have new evidence, add it to your profile or documents first; the reviewer reads it there."
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />
      <div>
        <Button
          type="submit"
          variant="primary"
          disabled={pending || reason.trim().length < 10}
        >
          {pending ? "Sending…" : "Ask for a review"}
        </Button>
      </div>
      {result === null ? null : (
        <p
          role={result.ok ? "status" : "alert"}
          className="cq-body-sm text-(--cq-text-secondary)"
        >
          {result.message}
        </p>
      )}
    </form>
  );
}
