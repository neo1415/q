"use client";

import Link from "next/link";
import { useActionState } from "react";

import { linkClassName } from "@capital-q/ui/link";

import { requestPasswordResetAction } from "@/auth/actions";
import { INITIAL_AUTH_FORM_STATE } from "@/auth/form-state";

import { AuthHeading } from "./auth-heading";
import { EmailField } from "./email-field";
import { FormNotice } from "./form-notice";
import { SubmitButton } from "./submit-button";

export function ForgotPasswordForm() {
  const [state, action] = useActionState(
    requestPasswordResetAction,
    INITIAL_AUTH_FORM_STATE,
  );

  return (
    <div className="flex flex-col gap-8">
      <AuthHeading
        title="Reset your password"
        description="Enter your email and we'll send a link to choose a new one."
      />

      <form action={action} className="flex flex-col gap-5">
        <EmailField autoFocus />
        {state.status === "error" ? (
          <FormNotice tone="danger">{state.message}</FormNotice>
        ) : null}
        <SubmitButton pendingLabel="Sending…">Send reset link</SubmitButton>
      </form>

      <p className="cq-body-sm text-(--cq-text-secondary)">
        <Link href="/auth/sign-in" className={linkClassName()}>
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
