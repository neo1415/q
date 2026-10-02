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
import { verifyParts } from "@/features/verification/verify-state";

import { submitKybAction, type FormResult } from "./review-actions";

type Standing = KybDto["standing"];

/** One line per part, in words; never a raw status. */
function standingWords(
  standing: Standing,
  sent: boolean,
  reason: string | null,
): string {
  switch (standing) {
    case "VERIFIED":
      return "Verified";
    case "REVOKED":
      return reason === null ? "Declined" : `Declined: ${reason}`;
    case "EXPIRED":
      return "Expired — send your details again";
    case "PENDING":
      return sent
        ? "With Capital Q for review"
        : "Requested — add your details to speed it up";
    case "NOT_REQUESTED":
      return "Not started";
  }
}

async function upload(
  chosen: File,
): Promise<{ readonly documentId: string } | null> {
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
  const done = await materialUploadCompleteAction(target.value.uploadSessionId);
  return done.ok ? { documentId: done.value.documentId } : null;
}

/**
 * "Verify you and <organisation>" (founder direction 2026-10-02): ONE form
 * for the person's identity and the organisation's registered details,
 * sent together so both claims are requested at once. A part already
 * verified or already with Capital Q is not asked again. Documents go to
 * the organisation's private evidence storage. A person at Capital Q
 * checks each; verification is not an endorsement.
 */
export function KybSection({ kyb }: { readonly kyb: KybDto }) {
  const router = useRouter();
  const parts = verifyParts(kyb);
  const submission = kyb.submission;
  const auto =
    submission?.status === "SUBMITTED" && submission.source === "AUTO";
  const name = kyb.organisationName ?? "your organisation";
  const [organisation, setOrganisation] = useState({
    legalName: auto ? (submission.legalName ?? "") : "",
    registrationNumber: "",
    jurisdictionCode: auto ? (submission.jurisdictionCode ?? "") : "",
    registeredAddress: "",
    websiteUrl: auto ? (submission.websiteUrl ?? "") : "",
  });
  const [person, setPerson] = useState({ nameOnId: "", role: "" });
  const [organisationFile, setOrganisationFile] = useState<File | null>(null);
  const [personFile, setPersonFile] = useState<File | null>(null);
  const [result, setResult] = useState<FormResult | null>(null);
  const [pending, startTransition] = useTransition();
  const attempt = useRef<string | null>(null);
  const ids = {
    legalName: useId(),
    registrationNumber: useId(),
    jurisdictionCode: useId(),
    registeredAddress: useId(),
    websiteUrl: useId(),
    organisationFile: useId(),
    nameOnId: useId(),
    role: useId(),
    personFile: useId(),
  };
  const setOrg = (field: keyof typeof organisation) => (value: string) =>
    setOrganisation((current) => ({ ...current, [field]: value }));

  const organisationReady =
    organisation.legalName.trim() !== "" &&
    organisation.registrationNumber.trim() !== "" &&
    /^[A-Z]{2}$/.test(organisation.jurisdictionCode);
  const personReady =
    person.nameOnId.trim() !== "" && person.role.trim() !== "";
  const ready =
    (parts.organisation || parts.person) &&
    (!parts.organisation || organisationReady) &&
    (!parts.person || personReady);

  return (
    <div className="flex flex-col gap-4">
      <ul
        className="flex flex-col gap-1"
        aria-label="Where verification stands"
      >
        <li className="cq-body-sm text-(--cq-text-primary)">
          <span className="font-medium">You</span> ·{" "}
          {standingWords(
            kyb.person.standing,
            kyb.person.submission?.status === "SUBMITTED",
            kyb.person.declineReason,
          )}
        </li>
        <li className="cq-body-sm text-(--cq-text-primary)">
          <span className="font-medium">{name}</span> ·{" "}
          {standingWords(
            kyb.standing,
            submission?.status === "SUBMITTED" &&
              submission.source === "PERSON",
            submission?.status === "REJECTED"
              ? submission.decisionReason
              : null,
          )}
        </li>
      </ul>
      {!parts.organisation && !parts.person ? null : (
        <form
          className="flex max-w-(--cq-layout-narrow) flex-col gap-6"
          onSubmit={(event) => {
            event.preventDefault();
            attempt.current ??= crypto.randomUUID();
            const key = attempt.current;
            startTransition(async () => {
              const sent = async (file: File | null) =>
                file === null ? { documentId: null } : await upload(file);
              const organisationDocument = parts.organisation
                ? await sent(organisationFile)
                : { documentId: null };
              const personDocument = parts.person
                ? await sent(personFile)
                : { documentId: null };
              if (organisationDocument === null || personDocument === null) {
                setResult({
                  ok: false,
                  message:
                    "A document didn't upload. Try again, or send without it.",
                });
                return;
              }
              const outcome = await submitKybAction({
                organisation: parts.organisation
                  ? {
                      ...organisation,
                      documentId: organisationDocument.documentId,
                    }
                  : null,
                person: parts.person
                  ? { ...person, documentId: personDocument.documentId }
                  : null,
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
          {parts.person ? (
            <fieldset className="flex flex-col gap-3">
              <legend className="cq-label mb-2 text-(--cq-text-primary)">
                You
              </legend>
              <Input
                id={ids.nameOnId}
                label="Your name as on your ID"
                autoComplete="name"
                value={person.nameOnId}
                onChange={(e) =>
                  setPerson((current) => ({
                    ...current,
                    nameOnId: e.target.value,
                  }))
                }
              />
              <Input
                id={ids.role}
                label={`Your role at ${name}`}
                autoComplete="organization-title"
                value={person.role}
                onChange={(e) =>
                  setPerson((current) => ({ ...current, role: e.target.value }))
                }
              />
              <label htmlFor={ids.personFile} className="flex flex-col gap-1">
                <span className="cq-body-sm text-(--cq-text-primary)">
                  ID document (optional)
                </span>
                <span className="cq-caption text-(--cq-text-secondary)">
                  A passport or national ID. Kept in your private documents and
                  seen only by the person at Capital Q who checks it.
                </span>
                <input
                  id={ids.personFile}
                  type="file"
                  accept="application/pdf,image/png,image/jpeg"
                  className="cq-body-sm min-h-11"
                  onChange={(e) => setPersonFile(e.target.files?.[0] ?? null)}
                />
              </label>
            </fieldset>
          ) : null}
          {parts.organisation ? (
            <fieldset className="flex flex-col gap-3">
              <legend className="cq-label mb-2 text-(--cq-text-primary)">
                {name}
              </legend>
              {auto ? (
                <p className="cq-caption text-(--cq-text-secondary)">
                  Capital Q has already asked from what you&apos;d told us. Add
                  the registered details and a document to speed it up.
                </p>
              ) : null}
              <Input
                id={ids.legalName}
                label="Registered legal name"
                value={organisation.legalName}
                onChange={(e) => setOrg("legalName")(e.target.value)}
              />
              <Input
                id={ids.registrationNumber}
                label="Registration number"
                value={organisation.registrationNumber}
                onChange={(e) => setOrg("registrationNumber")(e.target.value)}
              />
              <Input
                id={ids.jurisdictionCode}
                label="Country of registration"
                description="2-letter code, e.g. NG, GB, US."
                maxLength={2}
                value={organisation.jurisdictionCode}
                onChange={(e) =>
                  setOrg("jurisdictionCode")(e.target.value.toUpperCase())
                }
              />
              <Input
                id={ids.registeredAddress}
                label="Registered address (optional)"
                value={organisation.registeredAddress}
                onChange={(e) => setOrg("registeredAddress")(e.target.value)}
              />
              <Input
                id={ids.websiteUrl}
                label="Website (optional)"
                type="url"
                value={organisation.websiteUrl}
                onChange={(e) => setOrg("websiteUrl")(e.target.value)}
              />
              <label
                htmlFor={ids.organisationFile}
                className="flex flex-col gap-1"
              >
                <span className="cq-body-sm text-(--cq-text-primary)">
                  Registration certificate (optional)
                </span>
                <span className="cq-caption text-(--cq-text-secondary)">
                  Your certificate of incorporation or a registry extract. Kept
                  in your private documents.
                </span>
                <input
                  id={ids.organisationFile}
                  type="file"
                  accept="application/pdf,image/png,image/jpeg"
                  className="cq-body-sm min-h-11"
                  onChange={(e) =>
                    setOrganisationFile(e.target.files?.[0] ?? null)
                  }
                />
              </label>
            </fieldset>
          ) : null}
          <div>
            <Button
              type="submit"
              variant="primary"
              disabled={pending || !ready}
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
