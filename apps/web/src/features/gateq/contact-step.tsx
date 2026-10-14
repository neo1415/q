"use client";

import { useState, useTransition } from "react";
import { Button } from "@capital-q/ui/button";

import { recoverableAction } from "./recoverable-action";
import {
  contactApplicationAction,
  confirmContactAction,
} from "./interview-actions";

type Contact = {
  name: string;
  email: string;
  companyName: string;
  role: string;
};

export function ContactStep({
  initial,
  account,
  ensureToken,
  onConfirmed,
}: {
  readonly initial: Contact;
  readonly account: boolean;
  readonly ensureToken: () => Promise<string | null>;
  readonly onConfirmed: (contact: Contact) => void;
}) {
  const [contact, setContact] = useState(initial);
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, transition] = useTransition();
  const save = () =>
    transition(async () => {
      setProblem(null);
      const token = await ensureToken();
      if (token === null) return;
      const result = await recoverableAction(() =>
        contactApplicationAction(token, contact, account),
      );
      if (!result.ok) return setProblem(result.message);
      if (result.value.contact.emailConfirmed) return onConfirmed(contact);
      setSent(result.value.codeSent);
      if (!result.value.codeSent)
        setProblem(
          "We couldn't send the confirmation email. Please try again.",
        );
    });
  const confirm = () =>
    transition(async () => {
      setProblem(null);
      const token = await ensureToken();
      if (token === null) return;
      const result = await recoverableAction(() =>
        confirmContactAction(token, code),
      );
      if (!result.ok) return setProblem(result.message);
      if (result.value.status === "CONFIRMED") return onConfirmed(contact);
      setProblem(
        result.value.status === "WRONG_CODE"
          ? "That code doesn't match. Please check the email."
          : "That code is no longer usable. Request a new code.",
      );
    });
  return (
    <section className="gq-card flex flex-col gap-4 p-5" aria-busy={pending}>
      <h1 className="cq-title-md">Confirm your contact details</h1>
      <p className="cq-body-sm gq-t2">
        Your application stays private until you review it and explicitly
        submit. Confirming your email does not create an organisation
        membership.
      </p>
      {problem === null ? null : (
        <p role="alert" className="gq-banner gq-banner-err">
          {problem}
        </p>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
        className="flex flex-col gap-3"
      >
        {(
          [
            ["name", "Full name"],
            ["companyName", "Company"],
            ["role", "Your role"],
            ["email", "Email"],
          ] as const
        ).map(([field, label]) => (
          <label key={field} className="gq-field">
            <span className="gq-label">{label}</span>
            <input
              className="gq-input"
              type={field === "email" ? "email" : "text"}
              required
              maxLength={field === "email" ? 254 : field === "role" ? 120 : 200}
              value={contact[field]}
              disabled={pending || sent}
              onChange={(event) =>
                setContact({ ...contact, [field]: event.target.value })
              }
            />
          </label>
        ))}
        {!sent ? (
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? "Confirming…" : "Confirm contact"}
          </Button>
        ) : null}
      </form>
      {sent ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            confirm();
          }}
        >
          <label className="gq-field">
            <span className="gq-label">Six-digit email code</span>
            <input
              className="gq-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </label>
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? "Checking…" : "Verify email and continue"}
          </Button>
          <Button
            type="button"
            variant="quiet"
            disabled={pending}
            onClick={save}
          >
            Resend code
          </Button>
          <Button
            type="button"
            variant="quiet"
            disabled={pending}
            onClick={() => {
              setSent(false);
              setCode("");
            }}
          >
            Change contact details
          </Button>
        </form>
      ) : null}
    </section>
  );
}
