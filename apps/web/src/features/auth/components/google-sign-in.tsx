"use client";

import { useActionState } from "react";

import { signInWithGoogleAction } from "@/auth/actions";
import { INITIAL_AUTH_FORM_STATE } from "@/auth/form-state";

import { FormNotice } from "./form-notice";
import { SubmitButton } from "./submit-button";

/**
 * Continue with Google (CQ-C5-R2A §35, §37).
 *
 * A form, not a link, so the redirect to Google is built on the server where
 * the PKCE verifier cookie is written — and so the existing SubmitButton's
 * pending state prevents a second flow being launched over the first.
 *
 * It renders only when the Auth server actually offers the provider, so this
 * is never a control that cannot work. "Continue with Google" is the wording
 * Google's own guidance uses; "Google SSO" would describe something else.
 */
export function GoogleSignIn({ next }: { readonly next: string }) {
  const [state, action] = useActionState(
    signInWithGoogleAction,
    INITIAL_AUTH_FORM_STATE,
  );

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="next" value={next} />
      <SubmitButton variant="secondary" pendingLabel="Opening Google…">
        <GoogleMark />
        Continue with Google
      </SubmitButton>
      {state.status === "error" ? (
        <FormNotice tone="danger">{state.message}</FormNotice>
      ) : null}
    </form>
  );
}

/**
 * Google's own mark, at its own colours, which is what their branding
 * guidance requires — so it is the one place in Capital Q where a fixed
 * colour is correct rather than a design-token violation.
 */
function GoogleMark() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="18"
      height="18"
      viewBox="0 0 18 18"
    >
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}

/** "or", with a rule either side. Separates the two ways in, ranks neither. */
export function AuthDivider() {
  return (
    <div className="flex items-center gap-3" aria-hidden="true">
      <span className="h-px flex-1 bg-(--cq-border-subtle)" />
      <span className="cq-caption text-(--cq-text-tertiary)">or</span>
      <span className="h-px flex-1 bg-(--cq-border-subtle)" />
    </div>
  );
}
