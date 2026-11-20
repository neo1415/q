import { z } from "zod";

/**
 * V1 (decision 113; docs/research/2026-11-20-business-verification.md §6.2):
 * the one adapter interface every verification provider sits behind, like
 * the Model Gateway's ModelProvider. Provider payloads never leave an
 * adapter: what comes back is the normalised record below, validated with
 * Zod, and the provider's own reference for the audit trail. The raw
 * response is the provider's to keep; ID numbers and selfies never reach a
 * claim, a prompt or an investor.
 *
 * Honest by construction: an adapter whose key is unset (or set to a
 * disabled placeholder) reports NOT_CONNECTED for every call and makes no
 * request. Nothing here ever returns a success it did not receive.
 */

export const VERIFICATION_ADAPTER_CODES = [
  "COMPANIES_HOUSE",
  "DOJAH",
  "SUMSUB",
] as const;
export type VerificationAdapterCode =
  (typeof VERIFICATION_ADAPTER_CODES)[number];

const CountryCode = z.string().regex(/^[A-Z]{2}$/u);
const Reference = z.string().min(1).max(256);
const PersonName = z.string().trim().min(1).max(200);

export const RegistryLookupInputSchema = z
  .object({
    jurisdictionCode: CountryCode,
    registrationNumber: z.string().trim().min(1).max(100),
    /** The legal name as the founder gave it; some registries search by it. */
    legalName: z.string().trim().min(1).max(300).optional(),
  })
  .strict();
export type RegistryLookupInput = z.infer<typeof RegistryLookupInputSchema>;

export const REGISTRY_STATUSES = [
  "ACTIVE",
  "INACTIVE",
  "DISSOLVED",
  "UNKNOWN",
] as const;

export const OFFICER_ROLES = [
  "DIRECTOR",
  "SHAREHOLDER",
  "PSC",
  "SECRETARY",
  "OTHER",
] as const;
export type OfficerRole = (typeof OFFICER_ROLES)[number];

export const RegistryOfficerSchema = z
  .object({
    name: PersonName,
    role: z.enum(OFFICER_ROLES),
    /** Resigned or ceased: on the record, but not an officer now. */
    current: z.boolean(),
  })
  .strict();
export type RegistryOfficer = z.infer<typeof RegistryOfficerSchema>;

export const RegistryRecordSchema = z
  .object({
    legalName: z.string().trim().min(1).max(300),
    registrationNumber: z.string().trim().min(1).max(100),
    jurisdictionCode: CountryCode,
    status: z.enum(REGISTRY_STATUSES),
    incorporatedOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/u)
      .nullable(),
    officers: z.array(RegistryOfficerSchema).max(500),
    providerReference: Reference,
  })
  .strict();
export type RegistryRecord = z.infer<typeof RegistryRecordSchema>;

export const ID_DOCUMENT_TYPES = [
  "BVN",
  "NIN",
  "PASSPORT",
  "NATIONAL_ID",
  "DRIVING_LICENCE",
] as const;

/**
 * Biometric consent, captured before any ID or selfie leaves Capital Q
 * (Nigeria Data Protection Act 2023, s.30: sensitive personal data needs
 * explicit consent). The wording is versioned and its version recorded.
 */
export const BiometricConsentSchema = z
  .object({
    givenAt: z.string().datetime({ offset: true }),
    /** The version of the consent text the person agreed to. */
    textVersion: z.string().regex(/^biometric-consent-v\d+$/u),
    /** They ticked it themselves; never pre-ticked, never inferred. */
    explicit: z.literal(true),
  })
  .strict();
export type BiometricConsent = z.infer<typeof BiometricConsentSchema>;

export const IdentityCheckInputSchema = z
  .object({
    countryCode: CountryCode,
    /** Capital Q's own user id, the applicant's external id at the provider. */
    externalUserId: z.string().uuid(),
    idType: z.enum(ID_DOCUMENT_TYPES).optional(),
    idNumber: z.string().trim().min(4).max(40).optional(),
    /** Base64 JPEG of the live selfie, for a provider that takes one inline. */
    selfieImage: z.string().min(100).max(2_000_000).optional(),
    consent: BiometricConsentSchema,
  })
  .strict();
export type IdentityCheckInput = z.infer<typeof IdentityCheckInputSchema>;

export const IdentityCheckSchema = z
  .object({
    /** The document was found and is genuine; null: not decided yet. */
    idVerified: z.boolean().nullable(),
    /** The live selfie matched the document's photo; null: not decided. */
    selfieMatched: z.boolean().nullable(),
    /** The name on the verified document (never its number). */
    nameOnId: PersonName.nullable(),
    providerReference: Reference,
  })
  .strict();
export type IdentityCheck = z.infer<typeof IdentityCheckSchema>;

export type ProviderResult<T> =
  | { readonly kind: "OK"; readonly value: T }
  /** Started at the provider; the person finishes it there (Sumsub). */
  | { readonly kind: "PENDING"; readonly providerReference: string }
  | {
      readonly kind: "NOT_CONNECTED";
      readonly provider: VerificationAdapterCode;
    }
  | { readonly kind: "UNSUPPORTED"; readonly reason: string }
  | { readonly kind: "NOT_FOUND" }
  | { readonly kind: "FAILED"; readonly reason: string };

export const PROVIDER_CAPABILITIES = ["REGISTRY_LOOKUP", "ID_SELFIE"] as const;
export type ProviderCapability = (typeof PROVIDER_CAPABILITIES)[number];

export interface VerificationProvider {
  readonly code: VerificationAdapterCode;
  /** False when its key is unset or a disabled placeholder. */
  readonly connected: boolean;
  /** Whether it covers this capability in this jurisdiction at all. */
  readonly supports: (
    capability: ProviderCapability,
    jurisdictionCode: string,
  ) => boolean;
  readonly lookupCompany: (
    input: RegistryLookupInput,
  ) => Promise<ProviderResult<RegistryRecord>>;
  readonly verifyIdentity: (
    input: IdentityCheckInput,
  ) => Promise<ProviderResult<IdentityCheck>>;
}

/** A fetch the adapters call through: injected, so tests replay fixtures. */
export type ProviderFetch = (
  url: string,
  init: {
    readonly method: "GET" | "POST";
    readonly headers: Readonly<Record<string, string>>;
    readonly body?: string | undefined;
  },
) => Promise<{
  readonly status: number;
  readonly json: () => Promise<unknown>;
}>;

/** How long a provider call may take before it is a failure. */
export const PROVIDER_TIMEOUT_MS = 15_000;

/**
 * A key that is usable: set, and not the local disabled placeholder
 * (`disabled-locally-…`). Anything else reads as not connected.
 */
export function usableKey(value: string | undefined): string | null {
  const key = value?.trim() ?? "";
  if (key.length === 0 || key.startsWith("disabled-locally")) return null;
  return key;
}

export const notConnected = (
  provider: VerificationAdapterCode,
): {
  readonly kind: "NOT_CONNECTED";
  readonly provider: VerificationAdapterCode;
} => ({
  kind: "NOT_CONNECTED",
  provider,
});

/** The default fetch, bounded; a thrown or timed-out call is a failure. */
export const boundedFetch: ProviderFetch = async (url, init) => {
  const response = await fetch(url, {
    method: init.method,
    headers: { ...init.headers },
    ...(init.body === undefined ? {} : { body: init.body }),
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });
  return {
    status: response.status,
    json: () => response.json() as Promise<unknown>,
  };
};

/** Validates a normalised value; a provider shape we cannot read is a failure. */
export function validated<T>(
  schema: z.ZodType<T>,
  value: unknown,
): ProviderResult<T> {
  const parsed = schema.safeParse(value);
  return parsed.success
    ? { kind: "OK", value: parsed.data }
    : { kind: "FAILED", reason: "the provider's response could not be read" };
}

/** A call that throws (network, timeout) is a failure, never a success. */
export async function guarded<T>(
  work: () => Promise<ProviderResult<T>>,
): Promise<ProviderResult<T>> {
  try {
    return await work();
  } catch {
    return { kind: "FAILED", reason: "the provider could not be reached" };
  }
}
