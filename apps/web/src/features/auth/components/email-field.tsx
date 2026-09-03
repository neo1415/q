import { Input } from "@capital-q/ui/input";

/** Email input tuned for phones and password managers. */
export function EmailField({
  autoFocus = false,
}: {
  readonly autoFocus?: boolean | undefined;
}) {
  return (
    <Input
      id="email"
      name="email"
      type="email"
      label="Email"
      autoComplete="email"
      inputMode="email"
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      required
      autoFocus={autoFocus}
    />
  );
}
