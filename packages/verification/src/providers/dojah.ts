import { z } from "zod";

import {
  boundedFetch,
  guarded,
  IdentityCheckSchema,
  notConnected,
  RegistryRecordSchema,
  usableKey,
  validated,
  type ProviderFetch,
  type RegistryOfficer,
  type VerificationProvider,
} from "./contract.js";

/**
 * Dojah (decision 113: Africa). KYB through its business detail lookup in
 * Nigeria (CAC), Kenya (BRS) and South Africa (CIPC); in Nigeria, a BVN or
 * NIN with a live selfie. Keys: DOJAH_APP_ID and DOJAH_SECRET_KEY (its
 * AppId and Authorization headers). Endpoint paths and fields follow
 * Dojah's public API reference (Nov 2026); confirm them in Dojah's sandbox
 * before the first live call, as no live call is made from this code's
 * tests.
 */
export const DOJAH_BASE_URL = "https://api.dojah.io";

export const DOJAH_KYB_COUNTRIES: ReadonlySet<string> = new Set([
  "NG",
  "KE",
  "ZA",
]);

const Named = z.object({
  name: z.string().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  middle_name: z.string().optional(),
  other_name: z.string().optional(),
  affiliate_type: z.string().optional(),
  role: z.string().optional(),
  status: z.string().optional(),
});
type NamedPerson = z.infer<typeof Named>;

const BusinessSchema = z.object({
  entity: z.object({
    company_name: z.string(),
    registration_number: z.string().optional(),
    rc_number: z.string().optional(),
    status: z.string().optional(),
    company_status: z.string().optional(),
    date_of_registration: z.string().optional(),
    registration_date: z.string().optional(),
    directors: z.array(Named).optional(),
    shareholders: z.array(Named).optional(),
    affiliates: z.array(Named).optional(),
  }),
});

const IdentitySchema = z.object({
  entity: z.object({
    first_name: z.string().optional(),
    last_name: z.string().optional(),
    middle_name: z.string().optional(),
    reference_id: z.string().optional(),
    selfie_verification: z
      .object({ match: z.boolean(), confidence_value: z.number().optional() })
      .optional(),
  }),
});

const fullName = (person: NamedPerson): string =>
  (
    person.name ??
    [
      person.first_name,
      person.middle_name ?? person.other_name,
      person.last_name,
    ]
      .filter((part) => part !== undefined && part.trim().length > 0)
      .join(" ")
  ).trim();

const roleOf = (person: NamedPerson, fallback: RegistryOfficer["role"]) => {
  const role = (person.affiliate_type ?? person.role ?? "").toUpperCase();
  if (role.includes("DIRECTOR")) return "DIRECTOR" as const;
  if (role.includes("SHARE")) return "SHAREHOLDER" as const;
  if (role.includes("SECRETARY")) return "SECRETARY" as const;
  return fallback;
};

const isoDate = (raw: string | undefined): string | null => {
  const match = /^(\d{4}-\d{2}-\d{2})/u.exec(raw ?? "");
  return match?.[1] ?? null;
};

export function createDojahProvider(options: {
  readonly appId: string | undefined;
  readonly secretKey: string | undefined;
  readonly fetch?: ProviderFetch | undefined;
  readonly baseUrl?: string | undefined;
}): VerificationProvider {
  const appId = usableKey(options.appId);
  const secret = usableKey(options.secretKey);
  const connected = appId !== null && secret !== null;
  const http = options.fetch ?? boundedFetch;
  const base = options.baseUrl ?? DOJAH_BASE_URL;
  const headers = {
    AppId: appId ?? "",
    Authorization: secret ?? "",
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  return {
    code: "DOJAH",
    connected,
    supports: (capability, jurisdiction) =>
      capability === "REGISTRY_LOOKUP"
        ? DOJAH_KYB_COUNTRIES.has(jurisdiction)
        : jurisdiction === "NG",
    lookupCompany: async (input) => {
      if (!connected) return notConnected("DOJAH");
      if (!DOJAH_KYB_COUNTRIES.has(input.jurisdictionCode)) {
        return {
          kind: "UNSUPPORTED",
          reason: "Dojah KYB here covers NG, KE and ZA",
        };
      }
      return guarded(async () => {
        const query = new URLSearchParams({
          international_number: input.registrationNumber,
          country_code: input.jurisdictionCode,
          full: "true",
        });
        const response = await http(
          `${base}/api/v1/kyb/business/detail?${query.toString()}`,
          { method: "GET", headers },
        );
        if (response.status === 404) return { kind: "NOT_FOUND" };
        if (response.status !== 200) {
          return {
            kind: "FAILED",
            reason: `registry answered ${String(response.status)}`,
          };
        }
        const parsed = BusinessSchema.safeParse(await response.json());
        if (!parsed.success) {
          return {
            kind: "FAILED",
            reason: "the registry's response could not be read",
          };
        }
        const business = parsed.data.entity;
        const status = (
          business.status ??
          business.company_status ??
          ""
        ).toUpperCase();
        const number =
          business.registration_number ??
          business.rc_number ??
          input.registrationNumber;
        const people: RegistryOfficer[] = [
          ...(business.directors ?? []).map((p) => ({
            person: p,
            role: "DIRECTOR" as const,
          })),
          ...(business.shareholders ?? []).map((p) => ({
            person: p,
            role: "SHAREHOLDER" as const,
          })),
          ...(business.affiliates ?? []).map((p) => ({
            person: p,
            role: roleOf(p, "OTHER"),
          })),
        ]
          .map(({ person, role }) => ({
            name: fullName(person),
            role: roleOf(person, role),
            current: !/(RESIGN|CEASE|REMOVED|INACTIVE)/u.test(
              (person.status ?? "").toUpperCase(),
            ),
          }))
          .filter((person) => person.name.length > 0);
        return validated(RegistryRecordSchema, {
          legalName: business.company_name,
          registrationNumber: number,
          jurisdictionCode: input.jurisdictionCode,
          status:
            status === "ACTIVE" || status === "REGISTERED"
              ? "ACTIVE"
              : /(DISSOLV|STRUCK|DEREGISTER|STRIKE)/u.test(status)
                ? "DISSOLVED"
                : status.length === 0
                  ? "UNKNOWN"
                  : "INACTIVE",
          incorporatedOn: isoDate(
            business.date_of_registration ?? business.registration_date,
          ),
          officers: people,
          providerReference: `dojah:${input.jurisdictionCode}:${number}`,
        });
      });
    },
    verifyIdentity: async (input) => {
      if (!connected) return notConnected("DOJAH");
      if (
        input.countryCode !== "NG" ||
        (input.idType !== "BVN" && input.idType !== "NIN") ||
        input.idNumber === undefined ||
        input.selfieImage === undefined
      ) {
        return {
          kind: "UNSUPPORTED",
          reason: "Dojah checks a Nigerian BVN or NIN with a live selfie",
        };
      }
      const idType = input.idType;
      const idNumber = input.idNumber;
      const selfie = input.selfieImage;
      return guarded(async () => {
        const field = idType === "BVN" ? "bvn" : "nin";
        const response = await http(`${base}/api/v1/kyc/${field}/verify`, {
          method: "POST",
          headers,
          body: JSON.stringify({ [field]: idNumber, selfie_image: selfie }),
        });
        if (response.status === 404) return { kind: "NOT_FOUND" };
        if (response.status !== 200) {
          return {
            kind: "FAILED",
            reason: `identity check answered ${String(response.status)}`,
          };
        }
        const parsed = IdentitySchema.safeParse(await response.json());
        if (!parsed.success) {
          return {
            kind: "FAILED",
            reason: "the identity check's response could not be read",
          };
        }
        const person = parsed.data.entity;
        const name = fullName(person);
        return validated(IdentityCheckSchema, {
          idVerified: true,
          selfieMatched: person.selfie_verification?.match ?? null,
          nameOnId: name.length === 0 ? null : name,
          // Never the BVN or NIN: Dojah's reference, else the applicant.
          providerReference:
            person.reference_id ?? `dojah:${field}:${input.externalUserId}`,
        });
      });
    },
  };
}
