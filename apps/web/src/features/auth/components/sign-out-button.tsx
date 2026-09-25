"use client";

import { signOutAction } from "@/auth/actions";
import { forgetActiveConversations } from "@/features/q/active-conversation";

import { SubmitButton } from "./submit-button";

/** Sign out is a server action: the provider session ends, not a React state. */
export function SignOutButton() {
  return (
    <form
      action={signOutAction}
      // Which chat each Q surface was in belongs to this person; the next
      // one to sign in on this tab starts at Q's welcome.
      onSubmit={forgetActiveConversations}
    >
      <SubmitButton
        variant="secondary"
        size="regular"
        fullWidth={false}
        pendingLabel="Signing out…"
      >
        Sign out
      </SubmitButton>
    </form>
  );
}
