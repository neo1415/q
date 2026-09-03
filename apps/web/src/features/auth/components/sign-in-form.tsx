"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { Button } from "@capital-q/ui/button";
import { linkClassName } from "@capital-q/ui/link";
import type { NoticeTone } from "@capital-q/ui/states";

import { sendSignInLinkAction, signInWithPasswordAction } from "@/auth/actions";
import { INITIAL_AUTH_FORM_STATE } from "@/auth/form-state";

import { AuthHeading } from "./auth-heading";
import { EmailField } from "./email-field";
import { FormNotice } from "./form-notice";
import { PasswordField } from "./password-field";
import { SubmitButton } from "./submit-button";

export type SignInNotice = {
  readonly tone: NoticeTone;
  readonly message: string;
};

/**
 * Sign in: email, password, Continue. The emailed sign-in link is the
 * secondary path, one tap away, on the same screen.
 */
export function SignInForm({
  next,
  notice,
}: {
  readonly next: string;
  readonly notice?: SignInNotice | undefined;
}) {
  const [mode, setMode] = useState<"password" | "link">("password");
  const [passwordState, passwordAction] = useActionState(
    signInWithPasswordAction,
    INITIAL_AUTH_FORM_STATE,
  );
  const [linkState, linkAction] = useActionState(
    sendSignInLinkAction,
    INITIAL_AUTH_FORM_STATE,
  );

  const signUpHref =
    next === "/home"
      ? "/auth/sign-up"
      : `/auth/sign-up?next=${encodeURIComponent(next)}`;

  return (
    <div className="flex flex-col gap-8">
      <AuthHeading title="Sign in" />

      {notice !== undefined ? (
        <FormNotice tone={notice.tone}>{notice.message}</FormNotice>
      ) : null}

      {mode === "password" ? (
        <form action={passwordAction} className="flex flex-col gap-5">
          <input type="hidden" name="next" value={next} />
          <EmailField />
          <PasswordField
            id="password"
            label="Password"
            autoComplete="current-password"
          />
          {passwordState.status === "error" ? (
            <FormNotice tone="danger">{passwordState.message}</FormNotice>
          ) : null}
          <SubmitButton pendingLabel="Signing in…">Continue</SubmitButton>
        </form>
      ) : (
        <form action={linkAction} className="flex flex-col gap-5">
          <input type="hidden" name="next" value={next} />
          <EmailField />
          {linkState.status === "error" ? (
            <FormNotice tone="danger">{linkState.message}</FormNotice>
          ) : null}
          <SubmitButton pendingLabel="Sending…">
            Email me a sign-in link
          </SubmitButton>
        </form>
      )}

      <div className="flex flex-col items-start gap-1 cq-body-sm">
        {mode === "password" ? (
          <Link href="/auth/forgot-password" className={linkClassName()}>
            Forgot password?
          </Link>
        ) : null}
        <Button
          variant="quiet"
          size="regular"
          className="-ml-4"
          onClick={() => {
            setMode((current) =>
              current === "password" ? "link" : "password",
            );
          }}
        >
          {mode === "password"
            ? "Email me a sign-in link instead"
            : "Use a password instead"}
        </Button>
        <p className="text-(--cq-text-secondary)">
          New to Capital Q?{" "}
          <Link href={signUpHref} className={linkClassName()}>
            Create account
          </Link>
        </p>
      </div>
    </div>
  );
}
