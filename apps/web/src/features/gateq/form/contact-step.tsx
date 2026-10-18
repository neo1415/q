"use client";

import { useId, useState, useTransition, type RefObject } from "react";

import type { ApplicationContactDto } from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";
import {
  Check,
  CircleAlert,
  ICON_SIZE,
  ICON_STROKE,
} from "@capital-q/ui/icons";

import { confirmContactAction, saveContactAction } from "../apply-actions";
import { saveAccountContactAction } from "../materials-actions";
import {
  CODE_STATUS_WORDS,
  contactRequest,
  normaliseCode,
  validateContact,
  type ContactAnswers,
  type ContactErrors,
} from "./form-model";
import { useT } from "@/features/i18n/language";

/**
 * GateQ slice 1: who is applying, before anything else.
 *
 * A signed-in founder confirms through their account: the API confirms the
 * email without a code only when it is the account's own (resolved on the
 * server, never from this form). A guest, or a founder using another
 * address, gets a six-digit code by email. No membership is created.
 */

const icon = {
  size: ICON_SIZE.compact,
  strokeWidth: ICON_STROKE,
  "aria-hidden": true,
} as const;

export function ContactStep({
  headingRef,
  fund,
  signedIn,
  initial,
  saved,
  ensureToken,
  onConfirmed,
  notice,
}: {
  readonly headingRef: RefObject<HTMLHeadingElement | null>;
  readonly fund: string;
  readonly signedIn: boolean;
  readonly initial: ContactAnswers;
  /** What the API holds already (after a confirm, or a 409 sent us back). */
  readonly saved: ApplicationContactDto | null;
  readonly ensureToken: () => Promise<string | null>;
  readonly onConfirmed: (contact: ApplicationContactDto) => void;
  /** Why the founder is back here, if they were sent back. */
  readonly notice?: string | null;
}) {
  const t = useT();

  const [contact, setContact] = useState<ContactAnswers>(initial);
  const [errors, setErrors] = useState<ContactErrors>({});
  // A guest sent back here unconfirmed goes straight to the code (with
  // "Send a new code"); a signed-in founder re-confirms through the account.
  const [awaitingCode, setAwaitingCode] = useState(
    saved !== null && !saved.emailConfirmed && !signedIn,
  );
  const [code, setCode] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(saved?.emailConfirmed !== true);
  const channelId = useId();

  const set = <K extends keyof ContactAnswers>(
    field: K,
    value: ContactAnswers[K],
  ) => {
    setContact((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const send = () => {
    const found = validateContact(contact);
    if (Object.values(found).some((value) => value !== undefined)) {
      setErrors(found);
      return;
    }
    setProblem(null);
    setInfo(null);
    startTransition(async () => {
      const token = await ensureToken();
      if (token === null) return;
      const request = contactRequest(contact);
      const result = signedIn
        ? await saveAccountContactAction(token, request)
        : await saveContactAction(token, request);
      if (!result.ok) {
        setProblem(result.message);
        return;
      }
      if (result.contact.emailConfirmed) {
        onConfirmed(result.contact);
        return;
      }
      setAwaitingCode(true);
      setCode("");
      setInfo(
        result.codeSent
          ? `We sent a 6-digit code to ${result.contact.email}${
              result.codeExpiresInMinutes === null
                ? "."
                : `. It works for ${result.codeExpiresInMinutes} minutes.`
            }`
          : "We couldn't send a code just now. Try sending it again.",
      );
    });
  };

  const confirm = () => {
    const digits = normaliseCode(code);
    if (digits.length !== 6) {
      setProblem("The code is six digits.");
      return;
    }
    setProblem(null);
    startTransition(async () => {
      const token = await ensureToken();
      if (token === null) return;
      const result = await confirmContactAction(token, digits);
      if (!result.ok) {
        setProblem(result.message);
        return;
      }
      if (result.status === "CONFIRMED" && result.contact !== null) {
        onConfirmed(result.contact);
        return;
      }
      setProblem(
        result.status === "CONFIRMED"
          ? CODE_STATUS_WORDS.NOT_FOUND
          : CODE_STATUS_WORDS[result.status],
      );
    });
  };

  const explain = (
    <div className="gq-card flex flex-col gap-1.5 p-4">
      <p className="cq-label">{t("Who receives this")}</p>
      <p className="cq-body-sm gq-t2">
        {t(
          `Your application goes to ${fund}'s team only, and only when you press Submit at the end. They'll see these contact details, your answers, your interview with Q and any documents you choose. They may contact you at the email you confirm here.`,
        )}
      </p>
    </div>
  );

  if (!editing && saved !== null && saved.emailConfirmed) {
    return (
      <>
        <h1 ref={headingRef} tabIndex={-1} className="cq-title-lg">
          {t("Your details")}
        </h1>
        {explain}
        <div className="gq-card gq-cocard">
          <span className="min-w-0 flex-1">
            <b className="cq-title-sm block">{saved.name}</b>
            <span className="cq-body-sm gq-t2 block">
              {t([saved.role, saved.companyName].join(", "))}
            </span>
            <span className="cq-body-sm gq-t2 block">
              {saved.email}
              <span className="gq-prefill">
                <Check {...icon} size={13} />
                {t("Confirmed")}
              </span>
            </span>
            {saved.phone === null ? null : (
              <span className="cq-body-sm gq-t2 block">{t(saved.phone)}</span>
            )}
          </span>
          <Button
            variant="quiet"
            size="compact"
            onClick={() => setEditing(true)}
          >
            {t("Change")}
          </Button>
        </div>
        <div className="gq-formbar">
          <span />
          <Button
            variant="primary"
            style={{ minWidth: 160 }}
            onClick={() => onConfirmed(saved)}
          >
            {t("Continue")}
          </Button>
        </div>
      </>
    );
  }

  if (awaitingCode) {
    return (
      <>
        <h1 ref={headingRef} tabIndex={-1} className="cq-title-lg">
          {t("Check your email")}
        </h1>
        {info === null ? (
          <p className="cq-body gq-t2">
            {t("Enter the 6-digit code we sent to")}{" "}
            {contact.email || saved?.email}.
          </p>
        ) : (
          <p className="cq-body gq-t2" role="status">
            {t(info)}
          </p>
        )}
        {notice ? (
          <div className="gq-banner" role="status">
            <CircleAlert {...icon} />
            <span>{t(notice)}</span>
          </div>
        ) : null}
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            confirm();
          }}
        >
          <div className="gq-field">
            <label className="gq-label" htmlFor="gq-code">
              {t("6-digit code")}
            </label>
            <input
              id="gq-code"
              className="gq-input"
              style={{ maxWidth: 200, letterSpacing: "0.2em" }}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9 ]*"
              maxLength={7}
              value={code}
              aria-invalid={problem !== null}
              aria-describedby={problem === null ? undefined : "gq-code-err"}
              onChange={(e) => setCode(e.target.value)}
            />
            {problem === null ? null : (
              <p id="gq-code-err" className="gq-err" role="alert">
                {t(problem)}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? t("Checking…") : t("Confirm")}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={send}
              disabled={pending}
            >
              {t("Send a new code")}
            </Button>
            <Button
              type="button"
              variant="quiet"
              onClick={() => {
                setAwaitingCode(false);
                setProblem(null);
                setInfo(null);
              }}
              disabled={pending}
            >
              {t("Change details")}
            </Button>
          </div>
        </form>
      </>
    );
  }

  return (
    <>
      <h1 ref={headingRef} tabIndex={-1} className="cq-title-lg">
        {t("Your details")}
      </h1>
      <p className="cq-body gq-t2">
        {signedIn
          ? t(
              "From your account. Check they're right; there's no code to type when it's your account's email.",
            )
          : t(
              "So they know who's applying and how to reach you. We'll email you a code to confirm the address.",
            )}
      </p>
      {explain}
      {notice ? (
        <div className="gq-banner" role="status">
          <CircleAlert {...icon} />
          <span>{t(notice)}</span>
        </div>
      ) : null}
      {problem === null ? null : (
        <div className="gq-banner gq-banner-err" role="alert">
          <CircleAlert {...icon} />
          <span>{t(problem)}</span>
        </div>
      )}
      <form
        className="flex flex-col gap-3"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <Field
          id="gq-c-name"
          label={t("Full name")}
          value={contact.name}
          autoComplete="name"
          maxLength={200}
          error={errors.name}
          onChange={(value) => set("name", value)}
        />
        <Field
          id="gq-c-email"
          label={t("Email")}
          type="email"
          value={contact.email}
          autoComplete="email"
          maxLength={254}
          error={errors.email}
          onChange={(value) => set("email", value)}
          badge={
            signedIn &&
            saved?.confirmedVia === "ACCOUNT" &&
            saved.email === contact.email.trim().toLowerCase()
          }
        />
        <Field
          id="gq-c-role"
          label={t("Your role")}
          value={contact.role}
          autoComplete="organization-title"
          maxLength={120}
          placeholder={t("Like Founder & CEO")}
          error={errors.role}
          onChange={(value) => set("role", value)}
        />
        <Field
          id="gq-c-company"
          label={t("Company")}
          value={contact.companyName}
          autoComplete="organization"
          maxLength={200}
          error={errors.companyName}
          onChange={(value) => set("companyName", value)}
        />
        <Field
          id="gq-c-phone"
          label={t("Phone")}
          optional
          type="tel"
          value={contact.phone}
          autoComplete="tel"
          maxLength={32}
          error={errors.phone}
          onChange={(value) => set("phone", value)}
        />
        <div className="gq-q">
          <p className="gq-label" id={channelId}>
            {t("Best way to reach you")}{" "}
            <span className="gq-t3">{t("(optional)")}</span>
          </p>
          <div
            className="gq-opts"
            role="radiogroup"
            aria-labelledby={channelId}
          >
            {(
              [
                ["EMAIL", "Email"],
                ["PHONE", "Phone"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={contact.preferredChannel === value}
                className="gq-opt"
                onClick={() =>
                  set(
                    "preferredChannel",
                    contact.preferredChannel === value ? "" : value,
                  )
                }
              >
                {t(label)}
              </button>
            ))}
          </div>
        </div>
        <div className="gq-formbar">
          <span />
          <Button
            type="submit"
            variant="primary"
            style={{ minWidth: 160 }}
            disabled={pending}
          >
            {pending
              ? t("Saving…")
              : signedIn
                ? t("Confirm and continue")
                : t("Email me a code")}
          </Button>
        </div>
      </form>
    </>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  error,
  optional = false,
  badge = false,
  type = "text",
  autoComplete,
  maxLength,
  placeholder,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly error?: string | undefined;
  readonly optional?: boolean;
  readonly badge?: boolean;
  readonly type?: "text" | "email" | "tel";
  readonly autoComplete: string;
  readonly maxLength: number;
  readonly placeholder?: string;
}) {
  const t = useT();

  return (
    <div className="gq-field">
      <label className="gq-label" htmlFor={id}>
        {t(label)}
        {optional ? <span className="gq-t3"> {t("(optional)")}</span> : null}
        {badge ? (
          <span className="gq-prefill">
            <Check {...icon} size={13} />
            {t("Confirmed")}
          </span>
        ) : null}
      </label>
      <input
        id={id}
        className="gq-input"
        type={type}
        value={value}
        autoComplete={autoComplete}
        maxLength={maxLength}
        placeholder={placeholder}
        aria-invalid={error !== undefined}
        aria-describedby={error === undefined ? undefined : `${id}-err`}
        onChange={(e) => onChange(e.target.value)}
      />
      {error === undefined ? null : (
        <p id={`${id}-err`} className="gq-err">
          {t(error)}
        </p>
      )}
    </div>
  );
}
