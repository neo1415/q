"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

import {
  Button,
  type ButtonSize,
  type ButtonVariant,
} from "@capital-q/ui/button";

/**
 * The form's one primary action. While the action runs the control is
 * disabled (no duplicate submissions), its label changes to the pending
 * wording, and the change is announced. It always comes back: the state is
 * derived from the form, so a failed action re-enables it.
 */
export function SubmitButton({
  children,
  pendingLabel,
  variant = "primary",
  size = "large",
  fullWidth = true,
}: {
  readonly children: ReactNode;
  readonly pendingLabel: string;
  readonly variant?: ButtonVariant | undefined;
  readonly size?: ButtonSize | undefined;
  readonly fullWidth?: boolean | undefined;
}) {
  const { pending } = useFormStatus();

  return (
    <>
      <Button
        type="submit"
        variant={variant}
        size={size}
        disabled={pending}
        aria-busy={pending}
        className={fullWidth ? "w-full" : undefined}
      >
        {pending ? pendingLabel : children}
      </Button>
      <span role="status" aria-live="polite" className="sr-only">
        {pending ? pendingLabel : ""}
      </span>
    </>
  );
}
