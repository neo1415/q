"use client";

import { useActionState } from "react";

import { signOutAction, verifySecondStepAction } from "@/auth/actions";
import { INITIAL_AUTH_FORM_STATE } from "@/auth/form-state";
import { useT } from "@/features/i18n/language";

import { AuthHeading } from "./auth-heading";
import { CodeField } from "./code-field";
import { FormNotice } from "./form-notice";
import { SubmitButton } from "./submit-button";

/**
 * The second step of signing in: the code from the person's authenticator
 * app. A lost phone is not solved here; the line at the foot says who can
 * help, and signing out lets somebody else use this browser.
 */
export function TwoStepForm({ next }: { readonly next: string }) {
  const t = useT();
  const [state, action] = useActionState(
    verifySecondStepAction,
    INITIAL_AUTH_FORM_STATE,
  );

  return (
    <div className="flex flex-col gap-8">
      <AuthHeading
        title={t("Two-step verification")}
        description={t(
          "Enter the 6-digit code from your authenticator app to finish signing in.",
        )}
      />

      <form action={action} className="flex flex-col gap-5">
        <input type="hidden" name="next" value={next} />
        <CodeField label={t("6-digit code")} autoFocus />
        {state.status === "error" ? (
          <FormNotice tone="danger">{t(state.message)}</FormNotice>
        ) : null}
        <SubmitButton pendingLabel={t("Checking…")}>
          {t("Continue")}
        </SubmitButton>
      </form>

      <div className="flex flex-col items-start gap-3 cq-body-sm text-(--cq-text-secondary)">
        <p className="m-0">
          {t(
            "Lost access to your authenticator app? Contact Capital Q support from the email on your account and we will help you back in.",
          )}
        </p>
        <form action={signOutAction}>
          <SubmitButton
            variant="quiet"
            size="regular"
            fullWidth={false}
            pendingLabel={t("Signing out…")}
          >
            {t("Sign in as someone else")}
          </SubmitButton>
        </form>
      </div>
    </div>
  );
}
