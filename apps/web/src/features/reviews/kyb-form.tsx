"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, type ReactNode } from "react";

import type { KybDto } from "@capital-q/contracts";
import { cx } from "@capital-q/ui";
import { Check, ICON_STROKE, Upload } from "@capital-q/ui/icons";

import { VerifiedBadge } from "@/components/verified-badge";

import {
  materialUploadCompleteAction,
  materialUploadTargetAction,
} from "@/features/onboarding-kit/material-actions";
import {
  accountButton,
  Field,
  fieldClassName,
  Pending,
  useAccountToast,
} from "@/features/settings/account-kit";
import {
  personVerificationOptional,
  verifyParts,
} from "@/features/verification/verify-state";

import { submitKybAction } from "./review-actions";
import { useT } from "@/features/i18n/language";

type Standing = KybDto["standing"];

/** Design review only: the step shown and what is typed in. */
export type KybReview = {
  readonly step: number;
  readonly person?: { readonly nameOnId: string; readonly role: string };
  readonly organisation?: {
    readonly legalName: string;
    readonly registrationNumber: string;
    readonly jurisdictionCode: string;
    readonly registeredAddress: string;
    readonly websiteUrl: string;
  };
};

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

/**
 * One standing, as a row: who, then the state in words with a mark beside
 * it -- a shield once verified. The words always carry the meaning; the
 * mark never stands alone (doc 18).
 */
function StandingRow({
  who,
  standing,
  words,
}: {
  readonly who: string;
  readonly standing: Standing;
  readonly words: string;
}) {
  const verified = standing === "VERIFIED";
  return (
    <li className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-(--cq-border-subtle) py-2.5 first:border-t-0">
      <span className="text-xs text-(--cq-text-tertiary)">{who}</span>
      <span className="flex items-center gap-1.5 text-sm text-(--cq-text-primary)">
        {verified ? (
          <VerifiedBadge status={standing}>{words}</VerifiedBadge>
        ) : (
          words
        )}
      </span>
    </li>
  );
}

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = ["application/pdf", "image/png", "image/jpeg"];

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

type StepKey = "WHO" | "COMPANY" | "SEND";

/**
 * "Verify you and <organisation>" (founder direction 2026-10-02; chosen
 * design "Guided in three steps", 2026-10-21): who is asking, the
 * organisation as registered, then one summary to check and send. A part
 * already verified or already with Capital Q is not asked again, so its
 * step is left out. Documents go browser -> storage directly to the
 * organisation's private evidence storage; a person at Capital Q checks
 * each. Verification is not an endorsement, and nothing here is shown to
 * investors except the result.
 */
export function KybSection({
  kyb,
  review,
}: {
  readonly kyb: KybDto;
  /**
   * Design review only (/dev/account-review): opens on this step with
   * these details typed in.
   */
  readonly review?: KybReview | undefined;
}) {
  const t = useT();
  const parts = verifyParts(kyb);
  const optional = personVerificationOptional(kyb);
  const name = kyb.organisationName ?? "your organisation";
  const standings = (
    <ul
      className="m-0 flex list-none flex-col rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) px-5 py-2"
      aria-label={t("Where verification stands")}
    >
      <StandingRow
        who="You"
        standing={kyb.person.standing}
        words={
          optional && kyb.person.standing === "NOT_REQUESTED"
            ? "Not verified — optional"
            : standingWords(
                kyb.person.standing,
                kyb.person.submission?.status === "SUBMITTED",
                kyb.person.declineReason,
              )
        }
      />
      {kyb.person.affiliation !== "CONFIRMED_BY_ORGANISATION" ? null : (
        // Their place in the organisation, as the organisation confirmed
        // it -- said in words, with no shield: it is not a verification.
        <li
          className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-(--cq-border-subtle) py-2.5"
          data-affiliation="CONFIRMED_BY_ORGANISATION"
        >
          <span className="text-xs text-(--cq-text-tertiary)">
            Your place at {name}
          </span>
          <span className="text-sm text-(--cq-text-primary)">
            Confirmed by {name}
          </span>
        </li>
      )}
      <StandingRow
        who={name}
        standing={kyb.standing}
        words={standingWords(
          kyb.standing,
          kyb.submission?.status === "SUBMITTED" &&
            kyb.submission.source === "PERSON",
          kyb.submission?.status === "REJECTED"
            ? kyb.submission.decisionReason
            : null,
        )}
      />
    </ul>
  );
  if (!parts.organisation && !parts.person) {
    return <div className="flex flex-col gap-4">{standings}</div>;
  }
  if (optional) {
    return (
      <div className="flex flex-col gap-4">
        {standings}
        <details className="flex flex-col gap-3" data-identity-optional>
          <summary className="flex min-h-11 cursor-pointer items-center text-sm text-(--cq-text-primary)">
            Verify your own identity (optional)
          </summary>
          <p className="mb-4 text-sm text-(--cq-text-secondary)">
            {name} is verified and confirmed you as part of it, so nothing on
            Capital Q needs this today. Verifying yourself adds your own check
            beside it.
          </p>
          <VerifySteps kyb={kyb} parts={parts} review={review} />
        </details>
      </div>
    );
  }
  return <VerifySteps kyb={kyb} parts={parts} review={review} />;
}

function VerifySteps({
  kyb,
  parts,
  review,
}: {
  readonly kyb: KybDto;
  readonly parts: ReturnType<typeof verifyParts>;
  readonly review: KybReview | undefined;
}) {
  const t = useT();
  const toast = useAccountToast();
  const router = useRouter();
  const submission = kyb.submission;
  const auto =
    submission?.status === "SUBMITTED" && submission.source === "AUTO";
  const investor = kyb.organisationKind === "INVESTOR";
  const steps: readonly StepKey[] = [
    ...(parts.person ? (["WHO"] as const) : []),
    ...(parts.organisation ? (["COMPANY"] as const) : []),
    "SEND",
  ];
  const [at, setAt] = useState(() =>
    Math.max(0, Math.min(steps.length - 1, review?.step ?? 0)),
  );
  const step = steps[at] ?? "SEND";
  const [organisation, setOrganisation] = useState({
    legalName: auto ? (submission.legalName ?? "") : "",
    registrationNumber: "",
    jurisdictionCode: auto ? (submission.jurisdictionCode ?? "") : "",
    registeredAddress: "",
    websiteUrl: auto ? (submission.websiteUrl ?? "") : "",
    ...review?.organisation,
  });
  const [person, setPerson] = useState({
    nameOnId: "",
    role: "",
    ...review?.person,
  });
  const [organisationFile, setOrganisationFile] = useState<File | null>(null);
  const [personFile, setPersonFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<"idle" | "pending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const attempt = useRef<string | null>(null);
  const ids = {
    legalName: useId(),
    registrationNumber: useId(),
    jurisdictionCode: useId(),
    registeredAddress: useId(),
    websiteUrl: useId(),
    nameOnId: useId(),
    role: useId(),
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
    (!parts.organisation || organisationReady) &&
    (!parts.person || personReady);
  const next = () => {
    setError(null);
    setAt((current) => Math.min(steps.length - 1, current + 1));
  };
  const declined =
    kyb.standing === "REVOKED" || kyb.person.standing === "REVOKED"
      ? ((kyb.submission?.status === "REJECTED"
          ? kyb.submission.decisionReason
          : null) ?? kyb.person.declineReason)
      : null;

  const send = () => {
    if (!ready || phase !== "idle") return;
    attempt.current ??= crypto.randomUUID();
    const key = attempt.current;
    setPhase("pending");
    setError(null);
    void (async () => {
      const sent = async (file: File | null) =>
        file === null ? { documentId: null } : await upload(file);
      const organisationDocument = parts.organisation
        ? await sent(organisationFile)
        : { documentId: null };
      const personDocument = parts.person
        ? await sent(personFile)
        : { documentId: null };
      if (organisationDocument === null || personDocument === null) {
        setPhase("idle");
        setError("A document didn't upload. Try again, or send without it.");
        return;
      }
      const outcome = await submitKybAction({
        organisation: parts.organisation
          ? { ...organisation, documentId: organisationDocument.documentId }
          : null,
        person: parts.person
          ? { ...person, documentId: personDocument.documentId }
          : null,
        attemptKey: key,
      });
      if (!outcome.ok) {
        setPhase("idle");
        setError(outcome.message);
        return;
      }
      attempt.current = null;
      setPhase("done");
      toast(t("Sent to Capital Q. You’ll get a notice when it’s decided."));
      setTimeout(() => router.refresh(), 1800);
    })();
  };

  return (
    <div className="flex flex-col" data-verify-step={step}>
      <ol
        className="m-0 mb-[18px] flex list-none gap-2 p-0"
        aria-label={t("Steps")}
      >
        {steps.map((key, index) => (
          <li
            key={key}
            aria-current={index === at ? "step" : undefined}
            className={cx(
              "flex flex-1 flex-col gap-1.5 text-xs",
              index === at
                ? "font-semibold text-(--cq-text-primary)"
                : "text-(--cq-text-tertiary)",
            )}
          >
            <i
              aria-hidden="true"
              className={cx(
                "block h-1 rounded-full transition-colors duration-(--cq-motion-base)",
                index < at
                  ? "bg-(--cq-positive)"
                  : index === at
                    ? "bg-(--cq-text-primary)"
                    : "bg-(--cq-surface-strong)",
              )}
            />
            {key === "WHO"
              ? t("Who")
              : key === "COMPANY"
                ? investor
                  ? t("Firm")
                  : t("Company")
                : t("Send")}
          </li>
        ))}
      </ol>

      {declined === null ? null : (
        <p className="m-0 mb-4 rounded-(--cq-radius-lg) bg-(--cq-surface-subtle) px-3.5 py-3 text-sm text-(--cq-text-secondary)">
          {t(`Capital Q declined the last request: ${declined}`)}{" "}
          {t("Send your details again and a person looks again.")}
        </p>
      )}

      <div key={step} className="cq-crm-stagger flex flex-col gap-3.5">
        {step === "WHO" ? (
          <>
            <h2 className="m-0 text-lg font-semibold tracking-[-0.01em] text-(--cq-text-primary)">
              {t("Who is asking")}
            </h2>
            <Field label={t("Your name as on your ID")} htmlFor={ids.nameOnId}>
              <input
                id={ids.nameOnId}
                autoComplete="name"
                value={person.nameOnId}
                onChange={(e) =>
                  setPerson((current) => ({
                    ...current,
                    nameOnId: e.target.value,
                  }))
                }
                className={fieldClassName}
              />
            </Field>
            <Field
              label={t("Your role")}
              htmlFor={ids.role}
              hint={
                investor
                  ? t("For example: Partner, Principal, Angel.")
                  : t("For example: Founder & CEO.")
              }
            >
              <input
                id={ids.role}
                autoComplete="organization-title"
                value={person.role}
                onChange={(e) =>
                  setPerson((current) => ({ ...current, role: e.target.value }))
                }
                className={fieldClassName}
              />
            </Field>
            <DropZone
              title={t("ID document (optional)")}
              note={t(
                "A passport or national ID. PDF, PNG or JPEG, up to 10 MB. Seen only by the person at Capital Q who checks it.",
              )}
              file={personFile}
              onFile={setPersonFile}
              data-verify-file="person"
            />
            <button
              type="button"
              className={accountButton("primary", "regular", "mt-1 self-start")}
              disabled={!personReady}
              onClick={next}
              data-verify-next
            >
              {t("Continue")}
            </button>
          </>
        ) : step === "COMPANY" ? (
          <>
            <h2 className="m-0 text-lg font-semibold tracking-[-0.01em] text-(--cq-text-primary)">
              {investor
                ? t("Your firm, as registered")
                : t("Your company, as registered")}
            </h2>
            {auto ? (
              <p className="m-0 text-[13px] text-(--cq-text-secondary)">
                {t(
                  "Capital Q has already asked from what you'd told us. Add the registered details and a document to speed it up.",
                )}
              </p>
            ) : null}
            <Field
              label={t("Registered legal name")}
              htmlFor={ids.legalName}
              hint={t("As registered, if it differs from the company name.")}
            >
              <input
                id={ids.legalName}
                value={organisation.legalName}
                onChange={(e) => setOrg("legalName")(e.target.value)}
                className={fieldClassName}
              />
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field
                label={t("Registration number")}
                htmlFor={ids.registrationNumber}
              >
                <input
                  id={ids.registrationNumber}
                  placeholder={t("From your certificate")}
                  value={organisation.registrationNumber}
                  onChange={(e) => setOrg("registrationNumber")(e.target.value)}
                  className={fieldClassName}
                />
              </Field>
              <Field
                label={t("Country of registration")}
                htmlFor={ids.jurisdictionCode}
                hint={t("2-letter code, e.g. NG, GB, US.")}
              >
                <input
                  id={ids.jurisdictionCode}
                  maxLength={2}
                  value={organisation.jurisdictionCode}
                  onChange={(e) =>
                    setOrg("jurisdictionCode")(e.target.value.toUpperCase())
                  }
                  className={fieldClassName}
                />
              </Field>
            </div>
            <Field label={t("Website (optional)")} htmlFor={ids.websiteUrl}>
              <input
                id={ids.websiteUrl}
                type="url"
                value={organisation.websiteUrl}
                onChange={(e) => setOrg("websiteUrl")(e.target.value)}
                className={fieldClassName}
              />
            </Field>
            <Field
              label={t("Registered address (optional)")}
              htmlFor={ids.registeredAddress}
            >
              <input
                id={ids.registeredAddress}
                value={organisation.registeredAddress}
                onChange={(e) => setOrg("registeredAddress")(e.target.value)}
                className={fieldClassName}
              />
            </Field>
            <DropZone
              title={t("Certificate of incorporation or registry extract")}
              note={t(
                "PDF, PNG or JPEG, up to 10 MB. Kept in your private documents.",
              )}
              file={organisationFile}
              onFile={setOrganisationFile}
              data-verify-file="organisation"
            />
            <button
              type="button"
              className={accountButton("primary", "regular", "w-full")}
              disabled={!organisationReady}
              onClick={next}
              data-verify-next
            >
              {t("Continue")}
            </button>
            <span className="text-xs text-(--cq-text-tertiary)">
              {t(
                "A person at Capital Q checks it. Nothing here is shown to investors except the result.",
              )}
            </span>
          </>
        ) : (
          <>
            <h2 className="m-0 text-lg font-semibold tracking-[-0.01em] text-(--cq-text-primary)">
              {t("Check and send")}
            </h2>
            <dl className="m-0 flex flex-col rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) px-5 py-2">
              {parts.person ? (
                <Summary term={t("You")}>
                  {[person.nameOnId.trim(), person.role.trim()].join(", ")}
                </Summary>
              ) : null}
              {parts.organisation ? (
                <Summary term={investor ? t("Firm") : t("Company")}>
                  {[
                    organisation.legalName.trim(),
                    organisation.jurisdictionCode,
                  ].join(", ")}
                </Summary>
              ) : null}
              <Summary term={t("Document")}>
                {[organisationFile?.name, personFile?.name]
                  .filter((part) => part !== undefined)
                  .join(", ") || t("None, sent without one")}
              </Summary>
            </dl>
            {error === null ? null : (
              <p role="alert" className="m-0 text-sm text-(--cq-text-primary)">
                {error}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={accountButton(phase === "done" ? "done" : "primary")}
                disabled={phase !== "idle" || !ready}
                aria-busy={phase === "pending"}
                onClick={send}
                data-verify-send
              >
                {phase === "pending" ? (
                  <Pending>{t("Sending…")}</Pending>
                ) : phase === "done" ? (
                  <>
                    <Check size={14} aria-hidden="true" />
                    {t("Sent")}
                  </>
                ) : (
                  t("Send for verification")
                )}
              </button>
              {phase === "idle" && steps.length > 1 ? (
                <button
                  type="button"
                  className={accountButton("quiet")}
                  onClick={() => setAt(0)}
                >
                  {t("Change something")}
                </button>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Summary({
  term,
  children,
}: {
  readonly term: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex justify-between gap-2.5 border-t border-(--cq-border-subtle) py-2.5 text-sm first:border-t-0">
      <dt className="text-xs text-(--cq-text-tertiary)">{term}</dt>
      <dd className="m-0 text-end break-all text-(--cq-text-primary)">
        {children}
      </dd>
    </div>
  );
}

/**
 * A dashed drop area that takes one PDF, PNG or JPEG up to 10 MB, checked
 * here before anything is sent; once chosen it shows the file's name, and
 * it can be changed.
 */
function DropZone({
  title,
  note,
  file,
  onFile,
  ...rest
}: {
  readonly title: string;
  readonly note: string;
  readonly file: File | null;
  readonly onFile: (file: File | null) => void;
} & { readonly [data: `data-${string}`]: string | undefined }) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const take = (chosen: File | undefined) => {
    if (chosen === undefined) return;
    if (!ACCEPT.includes(chosen.type)) {
      setProblem(t("Choose a PDF, PNG or JPEG."));
      return;
    }
    if (chosen.size > MAX_BYTES) {
      setProblem(t("That file is over 10 MB. Choose a smaller one."));
      return;
    }
    setProblem(null);
    onFile(chosen);
  };
  return (
    <div
      className="flex flex-col items-center gap-1.5 rounded-(--cq-radius-lg) border-[1.5px] border-dashed border-(--cq-border) bg-(--cq-surface) p-5 text-center"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        take(event.dataTransfer.files[0]);
      }}
      {...rest}
    >
      {file === null ? (
        <>
          <Upload
            size={24}
            strokeWidth={ICON_STROKE}
            aria-hidden="true"
            className="text-(--cq-text-secondary)"
          />
          <b className="text-[15px] text-(--cq-text-primary)">{title}</b>
          <span className="text-xs text-(--cq-text-tertiary)">{note}</span>
          <button
            type="button"
            className={accountButton("secondary", "sm", "mt-1")}
            onClick={() => input.current?.click()}
          >
            {t("Choose file")}
          </button>
        </>
      ) : (
        <>
          <span className="cq-crm-tick-in grid size-5 place-items-center rounded-full bg-(--cq-positive) text-(--cq-text-inverse)">
            <Check size={12} strokeWidth={2.4} aria-hidden="true" />
          </span>
          <b className="text-[15px] break-all text-(--cq-text-primary)">
            {file.name}
          </b>
          <span className="text-xs text-(--cq-text-tertiary)">
            {t("Kept in your private documents.")}
          </span>
          <button
            type="button"
            className={accountButton("quiet", "sm")}
            onClick={() => input.current?.click()}
          >
            {t("Choose another")}
          </button>
        </>
      )}
      {problem === null ? null : (
        <p role="alert" className="m-0 text-[13px] text-(--cq-text-primary)">
          {problem}
        </p>
      )}
      <input
        ref={input}
        type="file"
        accept={ACCEPT.join(",")}
        className="sr-only"
        tabIndex={-1}
        aria-label={title}
        onChange={(event) => {
          take(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
    </div>
  );
}
