/**
 * The state a server action hands back to an auth form. Deliberately tiny:
 * either nothing happened yet, or there is one message to show. Success is
 * never a state here, because success is a redirect.
 */
export type AuthFormState =
  | { readonly status: "idle" }
  | { readonly status: "error"; readonly message: string }
  /**
   * The password was right but the address is not confirmed yet. Carries
   * the address they typed, back to their own browser, so the resend
   * control needs nothing typed twice.
   */
  | {
      readonly status: "unconfirmed";
      readonly message: string;
      readonly email: string;
    };

export const INITIAL_AUTH_FORM_STATE: AuthFormState = { status: "idle" };
