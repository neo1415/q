"use client";

import Link from "next/link";
import { useActionState, useState, type FormEvent } from "react";

import { ChoiceList } from "@capital-q/ui/choice-list";
import { Input } from "@capital-q/ui/input";
import { linkClassName } from "@capital-q/ui/link";

import { signUpWithPasswordAction } from "@/auth/actions";
import { INITIAL_AUTH_FORM_STATE } from "@/auth/form-state";
import {
  isInvitationReturn,
  organisationFieldFor,
  RegistrationJourneySchema,
  type RegistrationJourney,
} from "@/auth/registration";

import { AuthHeading } from "./auth-heading";
import { EmailField } from "./email-field";
import { FormNotice } from "./form-notice";
import { AuthDivider, GoogleSignIn } from "./google-sign-in";
import { PasswordField } from "./password-field";
import { SubmitButton } from "./submit-button";

/**
 * Create account: what they are here to do, a name, an email, a password,
 * and optionally what the organisation is called.
 *
 * Raising or investing comes first (owner directive 2026-10-16): it decides
 * which journey starts, which workspace onboarding creates, and how the
 * organisation field reads. It is a choice of journey, never a label on the
 * person; either journey can be started later. Name and organisation are
 * the least Q needs to be any use from the first sentence, and both are
 * carried into onboarding so neither is asked again.
 *
 * Somebody following an invitation chooses no journey and names no
 * organisation: the invitation already says where they are joining.
 */
export function SignUpForm({
  next,
  googleEnabled = false,
}: {
  readonly next: string;
  /** Whether the Auth server actually offers Google. Resolved on the server. */
  readonly googleEnabled?: boolean | undefined;
}) {
  const [state, action] = useActionState(
    signUpWithPasswordAction,
    INITIAL_AUTH_FORM_STATE,
  );

  const invited = isInvitationReturn(next);
  const [journey, setJourney] = useState<RegistrationJourney | null>(null);
  const [journeyError, setJourneyError] = useState<string | undefined>();
  const organisation = organisationFieldFor(journey);

  const signInHref =
    next === "/home" || next === "/welcome"
      ? "/auth/sign-in"
      : `/auth/sign-in?next=${encodeURIComponent(next)}`;

  // Inline, before the round trip: the server refuses the same thing.
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    if (!invited && journey === null) {
      event.preventDefault();
      setJourneyError("Choose one to continue.");
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <AuthHeading
        title={invited ? "Create your account to join" : "Create your account"}
        description={
          invited
            ? "You were invited to a team on Capital Q. Create your account, then accept the invitation."
            : "Q works with what you already have. Set up your company or mandate after this."
        }
      />

      {googleEnabled ? (
        <div className="flex flex-col gap-5">
          <GoogleSignIn next={next} />
          <AuthDivider />
        </div>
      ) : null}

      <form
        action={action}
        onSubmit={onSubmit}
        className="flex flex-col gap-5"
        data-sign-up-form
      >
        <input type="hidden" name="next" value={next} />
        {invited ? null : (
          <div data-sign-up-journey>
            <ChoiceList
              id="journey"
              name="journey"
              legend="What are you here to do?"
              options={[
                {
                  value: "founder",
                  label: "Raise capital",
                  description: "Set up your company as a founder.",
                },
                {
                  value: "investor",
                  label: "Invest",
                  description: "Set up your mandate as an investor.",
                },
              ]}
              value={journey ?? undefined}
              error={journeyError}
              onChange={(value) => {
                const parsed = RegistrationJourneySchema.safeParse(value);
                if (parsed.success) {
                  setJourney(parsed.data);
                  setJourneyError(undefined);
                }
              }}
            />
            <p className="cq-caption mt-2 text-(--cq-text-secondary)">
              Joining a team that is already on Capital Q? Open the link in your
              invitation email instead.
            </p>
          </div>
        )}
        <Input
          id="fullName"
          name="fullName"
          label="Your name"
          autoComplete="name"
          required
          maxLength={80}
          description="What Q should call you."
        />
        {invited ? null : (
          <Input
            id="organisationName"
            name="organisationName"
            label={organisation.label}
            autoComplete="organization"
            maxLength={120}
            description={organisation.description}
          />
        )}
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
