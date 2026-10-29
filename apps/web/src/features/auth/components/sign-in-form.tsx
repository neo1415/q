"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { Button } from "@capital-q/ui/button";
import { linkClassName } from "@capital-q/ui/link";
import type { NoticeTone } from "@capital-q/ui/states";

import {
  resendConfirmationAction,
  sendSignInLinkAction,
  signInWithPasswordAction,
} from "@/auth/actions";
import { INITIAL_AUTH_FORM_STATE } from "@/auth/form-state";

import { AuthHeading } from "./auth-heading";
import { EmailField } from "./email-field";
import { FormNotice } from "./form-notice";
import { AuthDivider, GoogleSignIn } from "./google-sign-in";
import { PasswordField } from "./password-field";
import { SubmitButton } from "./submit-button";
import { useT } from "@/features/i18n/language";

export type SignInNotice = {
  readonly tone: NoticeTone;
  readonly message: string;
};

/**
 * Sign in: Continue with Google where the Auth server offers it, then email
 * and password. The emailed sign-in link is the secondary path, one tap
 * away, on the same screen.
 *
 * Google is additive and deliberately not the only way in: an account made
 * with a password keeps working, and nobody is locked out of Capital Q
 * because they do not have, or do not want to use, a Google account (§6).
 */
export function SignInForm({
  next,
  notice,
  googleEnabled = false,
}: {
  readonly next: string;
  readonly notice?: SignInNotice | undefined;
  /** Whether the Auth server actually offers Google. Resolved on the server. */
  readonly googleEnabled?: boolean | undefined;
}) {
  const t = useT();
  const [mode, setMode] = useState<"password" | "link">("password");
  const [passwordState, passwordAction] = useActionState(
    signInWithPasswordAction,
    INITIAL_AUTH_FORM_STATE,
  );
  const [linkState, linkAction] = useActionState(
    sendSignInLinkAction,
    INITIAL_AUTH_FORM_STATE,
  );
  const [resendState, resendAction] = useActionState(
    resendConfirmationAction,
    INITIAL_AUTH_FORM_STATE,
  );

  const signUpHref =
    next === "/home"
      ? "/auth/sign-up"
      : `/auth/sign-up?next=${encodeURIComponent(next)}`;

  return (
    <div className="flex flex-col gap-8">
      <AuthHeading title={t("Sign in")} />

      {notice !== undefined ? (
        <FormNotice tone={notice.tone}>{notice.message}</FormNotice>
      ) : null}

      {googleEnabled ? (
        <div className="flex flex-col gap-5">
          <GoogleSignIn next={next} />
          <AuthDivider />
        </div>
      ) : null}

      {mode === "password" ? (
        <form action={passwordAction} className="flex flex-col gap-5">
          <input type="hidden" name="next" value={next} />
          <EmailField />
          <PasswordField
            id="password"
            label={t("Password")}
            autoComplete="current-password"
          />
          {passwordState.status === "error" ? (
            <FormNotice tone="danger">{passwordState.message}</FormNotice>
          ) : null}
          {passwordState.status === "unconfirmed" ? (
            <FormNotice tone="warning">{t(passwordState.message)}</FormNotice>
          ) : null}
          <SubmitButton pendingLabel="Signing in…">{t("Sign in")}</SubmitButton>
        </form>
      ) : null}

      {mode === "password" && passwordState.status === "unconfirmed" ? (
        // A separate form: resending must not resubmit the password.
        <form action={resendAction} className="flex flex-col gap-3">
          <input type="hidden" name="next" value={next} />
          <input type="hidden" name="email" value={passwordState.email} />
          {resendState.status === "error" ? (
            <FormNotice tone="danger">{t(resendState.message)}</FormNotice>
          ) : null}
          <SubmitButton variant="secondary" pendingLabel={t("Sending…")}>
            {t("Send the confirmation link again")}
          </SubmitButton>
        </form>
      ) : null}

      {mode === "password" ? null : (
        <form action={linkAction} className="flex flex-col gap-5">
          <input type="hidden" name="next" value={next} />
          <EmailField />
          {linkState.status === "error" ? (
            <FormNotice tone="danger">{linkState.message}</FormNotice>
          ) : null}
          <SubmitButton pendingLabel="Sending…">
            {t("Email me a sign-in link")}
          </SubmitButton>
        </form>
      )}

      <div className="flex flex-col items-start gap-1 cq-body-sm">
        {mode === "password" ? (
          <Link
            href="/auth/forgot-password"
            className={linkClassName("inline-flex min-h-11 items-center")}
          >
            {t("Forgot password?")}
          </Link>
        ) : null}
        <Button
          variant="quiet"
          size="compact"
          className="-ms-3"
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
            {t("Create account")}
          </Link>
        </p>
      </div>
    </div>
  );
}
