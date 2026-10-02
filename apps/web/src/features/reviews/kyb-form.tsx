"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition } from "react";

import type { KybDto } from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";
import { Input } from "@capital-q/ui/input";

import {
  materialUploadCompleteAction,
  materialUploadTargetAction,
} from "@/features/onboarding-kit/material-actions";

import { submitKybAction, type FormResult } from "./review-actions";

const STATUS_WORDS = {
  SUBMITTED: "With Capital Q for review",
  APPROVED: "Verified",
  REJECTED: "Not verified",
  SUPERSEDED: "Replaced by your details",
} as const;

/**
 * Manual KYB (V1): the organisation's business details and, if they have
 * one, a registration document uploaded to their own private evidence
 * storage. A person at Capital Q checks them; verification is not an
 * endorsement.
 */
export function KybSection({ kyb }: { readonly kyb: KybDto }) {
  const router = useRouter();
  const submission = kyb.submission;
  // ADMIN-4 block: a request Capital Q made on the organisation's behalf
  // stays open to its own details and document, prefilled from what was
  // already known.
  const auto =
    submission?.status === "SUBMITTED" && submission.source === "AUTO";
  const open = submission?.status === "SUBMITTED" && !auto;
  const verified = kyb.standing === "VERIFIED";
  const [fields, setFields] = useState({
    legalName: auto ? (submission.legalName ?? "") : "",
    registrationNumber: "",
    jurisdictionCode: auto ? (submission.jurisdictionCode ?? "") : "",
    registeredAddress: "",
    websiteUrl: auto ? (submission.websiteUrl ?? "") : "",
  });
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<FormResult | null>(null);
  const [pending, startTransition] = useTransition();
  const attempt = useRef<string | null>(null);
  const ids = {
    legalName: useId(),
    registrationNumber: useId(),
    jurisdictionCode: useId(),
    registeredAddress: useId(),
    websiteUrl: useId(),
    file: useId(),
  };
  const set = (name: keyof typeof fields) => (value: string) =>
    setFields((current) => ({ ...current, [name]: value }));

  const upload = async (
    chosen: File,
  ): Promise<{ readonly documentId: string } | null> => {
    const target = await materialUploadTargetAction({
      documentType: "CORPORATE",
      filename: chosen.name,
      mimeType: chosen.type || "application/pdf",
      sizeBytes: chosen.size,
    });
    if (!target.ok) return null;
    const put = await fetch(target.value.url, {
      method: target.value.method,
      headers: target.value.headers,
      body: chosen,
    });
    if (!put.ok) return null;
    const done = await materialUploadCompleteAction(
      target.value.uploadSessionId,
    );
    return done.ok ? { documentId: done.value.documentId } : null;
  };

  return (
    <div className="flex flex-col gap-4">
      {submission === null ? null : (
        <div className="flex flex-col gap-1">
          <span className="cq-body-sm font-medium text-(--cq-text-primary)">
            {auto
              ? "Requested — with Capital Q"
              : `${submission.legalName ?? "Your organisation"} · ${STATUS_WORDS[submission.status]}`}
          </span>
          <span className="cq-caption text-(--cq-text-secondary)">
            {auto
              ? "We asked on your behalf from what you'd already told us. Add a registration document to speed it up."
              : [
                  submission.registrationNumber,
                  submission.jurisdictionCode,
                  submission.hasDocument ? "document attached" : null,
                  `sent ${new Date(submission.submittedAt).toLocaleDateString("en-GB")}`,
                ]
                  .filter((part) => part !== null)
                  .join(" · ")}
          </span>
          {submission.status === "REJECTED" &&
          submission.decisionReason !== null ? (
            <span className="cq-body-sm text-(--cq-text-primary)">
              {submission.decisionReason}
            </span>
          ) : null}
        </div>
      )}
      {open || verified ? null : (
        <form
          className="flex max-w-(--cq-layout-narrow) flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            attempt.current ??= crypto.randomUUID();
            const key = attempt.current;
            startTransition(async () => {
              let documentId: string | null = null;
              if (file !== null) {
                const uploaded = await upload(file);
                if (uploaded === null) {
                  setResult({
                    ok: false,
                    message:
                      "The document didn't upload. Try again, or send without it.",
                  });
                  return;
                }
                documentId = uploaded.documentId;
              }
              const outcome = await submitKybAction({
                ...fields,
                documentId,
                attemptKey: key,
              });
              setResult(outcome);
              if (outcome.ok) {
                attempt.current = null;
                router.refresh();
              }
            });
          }}
        >
          <Input
            id={ids.legalName}
            label="Registered legal name"
            value={fields.legalName}
            onChange={(e) => set("legalName")(e.target.value)}
          />
          <Input
            id={ids.registrationNumber}
            label="Registration number"
            value={fields.registrationNumber}
            onChange={(e) => set("registrationNumber")(e.target.value)}
          />
          <Input
            id={ids.jurisdictionCode}
            label="Country of registration"
            description="2-letter code, e.g. NG, GB, US."
            maxLength={2}
            value={fields.jurisdictionCode}
            onChange={(e) =>
              set("jurisdictionCode")(e.target.value.toUpperCase())
            }
          />
          <Input
            id={ids.registeredAddress}
            label="Registered address (optional)"
            value={fields.registeredAddress}
            onChange={(e) => set("registeredAddress")(e.target.value)}
          />
          <Input
            id={ids.websiteUrl}
            label="Website (optional)"
            type="url"
            value={fields.websiteUrl}
            onChange={(e) => set("websiteUrl")(e.target.value)}
          />
          <label htmlFor={ids.file} className="flex flex-col gap-1">
            <span className="cq-body-sm text-(--cq-text-primary)">
              Registration certificate (optional)
            </span>
            <span className="cq-caption text-(--cq-text-secondary)">
              A PDF of your certificate of incorporation or registry extract.
              Kept in your private documents.
            </span>
            <input
              id={ids.file}
              type="file"
              accept="application/pdf,image/png,image/jpeg"
              className="cq-body-sm min-h-11"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <div>
            <Button
              type="submit"
              variant="primary"
              disabled={
                pending ||
                fields.legalName.trim() === "" ||
                fields.registrationNumber.trim() === "" ||
                !/^[A-Z]{2}$/.test(fields.jurisdictionCode)
              }
            >
              {pending ? "Sending…" : "Send for verification"}
            </Button>
          </div>
        </form>
      )}
      {result === null ? null : (
        <p
          role={result.ok ? "status" : "alert"}
          className="cq-body-sm text-(--cq-text-secondary)"
        >
          {result.message}
        </p>
      )}
    </div>
  );
}
