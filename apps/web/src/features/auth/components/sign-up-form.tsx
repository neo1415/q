"use client";

import Link from "next/link";
import { useActionState } from "react";

import { linkClassName } from "@capital-q/ui/link";

import { signUpWithPasswordAction } from "@/auth/actions";
import { INITIAL_AUTH_FORM_STATE } from "@/auth/form-state";

import { AuthHeading } from "./auth-heading";
import { EmailField } from "./email-field";
import { FormNotice } from "./form-notice";
import { PasswordField } from "./password-field";
import { SubmitButton } from "./submit-button";

/**
 * Create account: email and password, nothing else. Company, role, sector
 * and intent belong to onboarding, after the person exists.
 */
export function SignUpForm({ next }: { readonly next: string }) {
  const [state, action] = useActionState(
    signUpWithPasswordAction,
    INITIAL_AUTH_FORM_STATE,
  );

  const signInHref =
    next === "/home"
      ? "/auth/sign-in"
      : `/auth/sign-in?next=${encodeURIComponent(next)}`;

  return (
    <div className="flex flex-col gap-8">
      <AuthHeading
        title="Create your account"
        description="Q works with what you already have. Set up your company or mandate after this."
      />

      <form action={action} className="flex flex-col gap-5">
        <input type="hidden" name="next" value={next} />
        <EmailField />
        <PasswordField
          id="password"
          label="Password"
          autoComplete="new-password"
          minLength={8}
          description="At least 8 characters."
        />
        {state.status === "error" ? (
          <FormNotice tone="danger">{state.message}</FormNotice>
        ) : null}
        <SubmitButton pendingLabel="Creating account…">
          Create account
        </SubmitButton>
      </form>

      <p className="cq-body-sm text-(--cq-text-secondary)">
        Already have an account?{" "}
        <Link href={signInHref} className={linkClassName()}>
          Sign in
        </Link>
      </p>
    </div>
  );
}
