"use client";

import { useActionState } from "react";

import { updatePasswordAction } from "@/auth/actions";
import { INITIAL_AUTH_FORM_STATE } from "@/auth/form-state";

import { AuthHeading } from "./auth-heading";
import { FormNotice } from "./form-notice";
import { PasswordField } from "./password-field";
import { SubmitButton } from "./submit-button";

export function UpdatePasswordForm() {
  const [state, action] = useActionState(
    updatePasswordAction,
    INITIAL_AUTH_FORM_STATE,
  );

  return (
    <div className="flex flex-col gap-8">
      <AuthHeading title="Choose a new password" />

      <form action={action} className="flex flex-col gap-5">
        <PasswordField
          id="password"
          label="New password"
          autoComplete="new-password"
          minLength={8}
          description="At least 8 characters."
        />
        {state.status === "error" ? (
          <FormNotice tone="danger">{state.message}</FormNotice>
        ) : null}
        <SubmitButton pendingLabel="Updating password…">
          Update password
        </SubmitButton>
      </form>
    </div>
  );
}
