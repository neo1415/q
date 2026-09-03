"use client";

import { useState } from "react";

import { Button } from "@capital-q/ui/button";
import { Input } from "@capital-q/ui/input";

/**
 * Password input with a show/hide toggle. Paste is allowed, autocomplete is
 * set for password managers, and the toggle is a real button with a name
 * and a pressed state rather than an icon-only control.
 */
export function PasswordField({
  id,
  label,
  autoComplete,
  description,
  minLength,
}: {
  readonly id: string;
  readonly label: string;
  readonly autoComplete: "current-password" | "new-password";
  readonly description?: string | undefined;
  readonly minLength?: number | undefined;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="flex flex-col gap-1">
      <Input
        id={id}
        name="password"
        type={visible ? "text" : "password"}
        label={label}
        autoComplete={autoComplete}
        autoCapitalize="none"
        spellCheck={false}
        required
        minLength={minLength}
        description={description}
      />
      <div className="flex justify-end">
        <Button
          variant="quiet"
          size="regular"
          aria-pressed={visible}
          aria-controls={id}
          onClick={() => {
            setVisible((current) => !current);
          }}
        >
          {visible ? "Hide password" : "Show password"}
        </Button>
      </div>
    </div>
  );
}
