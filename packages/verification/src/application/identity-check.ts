import {
  IdentityCheckInputSchema,
  type IdentityCheck,
  type ProviderResult,
  type VerificationProvider,
} from "../providers/contract.js";

/**
 * V1: an ID and selfie check starts only with the person's explicit
 * biometric consent on the request (Nigeria Data Protection Act 2023:
 * biometric data is sensitive and needs explicit consent). The input is
 * validated before anything reaches a provider; without consent nothing
 * is sent and the answer says why.
 */
export type IdentityCheckStart =
  | ProviderResult<IdentityCheck>
  | { readonly kind: "CONSENT_REQUIRED" }
  | { readonly kind: "INVALID" };

export async function startIdentityCheck(
  provider: VerificationProvider,
  raw: unknown,
): Promise<IdentityCheckStart> {
  const consent =
    typeof raw === "object" && raw !== null && "consent" in raw
      ? raw.consent
      : undefined;
  if (consent === undefined || consent === null) {
    return { kind: "CONSENT_REQUIRED" };
  }
  const parsed = IdentityCheckInputSchema.safeParse(raw);
  if (!parsed.success) {
    return parsed.error.issues.some((issue) => issue.path[0] === "consent")
      ? { kind: "CONSENT_REQUIRED" }
      : { kind: "INVALID" };
  }
  if (!provider.connected)
    return { kind: "NOT_CONNECTED", provider: provider.code };
  return provider.verifyIdentity(parsed.data);
}
