"use client";

import { signOutAction } from "@/auth/actions";

import { SubmitButton } from "./submit-button";

/** Sign out is a server action: the provider session ends, not a React state. */
export function SignOutButton() {
  return (
    <form action={signOutAction}>
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
