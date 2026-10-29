import { Input } from "@capital-q/ui/input";

/**
 * The 6-digit code from an authenticator app: numeric keypad on a phone,
 * offered by the platform's one-time-code autofill where it has one.
 */
export function CodeField({
  label,
  description,
  autoFocus = false,
}: {
  readonly label: string;
  readonly description?: string | undefined;
  readonly autoFocus?: boolean | undefined;
}) {
  return (
    <Input
      id="code"
      name="code"
      type="text"
      label={label}
      description={description}
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="[0-9 ]*"
      maxLength={7}
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      required
      autoFocus={autoFocus}
    />
  );
}
