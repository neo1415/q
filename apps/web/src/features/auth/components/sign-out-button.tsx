"use client";

import { signOutAction } from "@/auth/actions";
import { clearMediaCache } from "@/features/discover/player/media-cache";
import { forgetActiveConversations } from "@/features/q/active-conversation";

import { cx } from "@capital-q/ui";
import { ICON_SIZE, ICON_STROKE, LogOut } from "@capital-q/ui/icons";
import { Tooltip } from "@capital-q/ui/tooltip";

import { SubmitButton } from "./submit-button";

/**
 * What this browser keeps for the person signing out: which chat each Q
 * surface was in, and the pitches cached on the device (ADR 0063). The
 * next person to sign in here starts with neither.
 */
function forgetThisPerson(): void {
  forgetActiveConversations();
  void clearMediaCache();
}

/** Sign out is a server action: the provider session ends, not a React state. */
export function SignOutButton() {
  return (
    <form
      action={signOutAction}
      // Which chat each Q surface was in belongs to this person; the next
      // one to sign in on this tab starts at Q's welcome.
      onSubmit={forgetThisPerson}
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

/**
 * Sign out where people look for it (founder, 2026-10-05: "i can't find the
 * logout button"): an icon in the desktop sidebar's footer, a row at the
 * foot of the phone's More sheet. The same server action as above.
 */
export function SignOutControl({
  appearance,
}: {
  readonly appearance: "icon" | "row";
}) {
  const button = (
    <button
      type="submit"
      aria-label={appearance === "icon" ? "Sign out" : undefined}
      className={cx(
        "flex items-center rounded-md text-(--cq-text-secondary) transition-colors duration-(--cq-motion-fast) hover:bg-(--cq-surface-subtle) hover:text-(--cq-text-primary)",
        appearance === "icon"
          ? "size-11 justify-center pointer-fine:size-9"
          : "min-h-12 w-full gap-3 px-3 cq-body",
      )}
    >
      <LogOut
        aria-hidden="true"
        size={ICON_SIZE.regular}
        strokeWidth={ICON_STROKE}
      />
      {appearance === "row" ? <span>Sign out</span> : null}
    </button>
  );
  return (
    <form action={signOutAction} onSubmit={forgetThisPerson}>
      {appearance === "icon" ? (
        <Tooltip content="Sign out">{button}</Tooltip>
      ) : (
        button
      )}
    </form>
  );
}
