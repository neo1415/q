import { createHmac } from "node:crypto";

import { z } from "zod";

import {
  boundedFetch,
  guarded,
  IdentityCheckSchema,
  notConnected,
  RegistryRecordSchema,
  usableKey,
  validated,
  type IdentityCheck,
  type ProviderFetch,
  type ProviderResult,
  type RegistryOfficer,
  type RegistryRecord,
  type VerificationProvider,
} from "./contract.js";

/**
 * Sumsub (decision 113: the rest of the world). An applicant per person
 * (ID document and liveness, finished by the person in Sumsub's own flow)
 * and per company (KYB against the registry). Both are asynchronous: a
 * start returns PENDING with the applicant id, and the result is read once
 * Sumsub has reviewed it. Keys: SUMSUB_APP_TOKEN and SUMSUB_SECRET_KEY
 * (every request signed with HMAC-SHA256); levels SUMSUB_KYC_LEVEL and
 * SUMSUB_KYB_LEVEL, configured in Sumsub's dashboard.
 */
export const SUMSUB_BASE_URL = "https://api.sumsub.com";

/** Sumsub names countries in ISO alpha-3. Outside this list: unsupported. */
const ALPHA3: Readonly<Record<string, string>> = {
  AE: "ARE",
  AR: "ARG",
  AT: "AUT",
  AU: "AUS",
  BE: "BEL",
  BR: "BRA",
  CA: "CAN",
  CH: "CHE",
  CL: "CHL",
  CO: "COL",
  CZ: "CZE",
  DE: "DEU",
  DK: "DNK",
  EG: "EGY",
  ES: "ESP",
  FI: "FIN",
  FR: "FRA",
  GB: "GBR",
  GH: "GHA",
  GR: "GRC",
  HK: "HKG",
  IE: "IRL",
  IL: "ISR",
  IN: "IND",
  IT: "ITA",
  JP: "JPN",
  KE: "KEN",
  KR: "KOR",
  LU: "LUX",
  MA: "MAR",
  MX: "MEX",
  MY: "MYS",
  NG: "NGA",
  NL: "NLD",
  NO: "NOR",
  NZ: "NZL",
  PL: "POL",
  PT: "PRT",
  RW: "RWA",
  SA: "SAU",
  SE: "SWE",
  SG: "SGP",
  TZ: "TZA",
  UG: "UGA",
  US: "USA",
  ZA: "ZAF",
};
const ALPHA2 = new Map(
  Object.entries(ALPHA3).map(([two, three]) => [three, two]),
);

const Person = z.object({
  firstName: z.string().optional(),
  middleName: z.string().optional(),
  lastName: z.string().optional(),
});

const ApplicantSchema = z.object({
  id: z.string().min(1),
  info: Person.extend({
    companyInfo: z
      .object({
        companyName: z.string(),
        registrationNumber: z.string().optional(),
        country: z.string().optional(),
        incorporatedOn: z.string().optional(),
        beneficiaries: z
          .array(
            z.object({
              info: Person.optional(),
              types: z.array(z.string()).default([]),
            }),
          )
          .default([]),
      })
      .optional(),
  }).optional(),
  review: z
    .object({
      reviewStatus: z.string(),
      reviewResult: z
        .object({ reviewAnswer: z.enum(["GREEN", "RED"]) })
        .optional(),
    })
    .optional(),
});
type Applicant = z.infer<typeof ApplicantSchema>;

const nameOf = (person: z.infer<typeof Person> | undefined): string =>
  [person?.firstName, person?.middleName, person?.lastName]
    .filter((part) => part !== undefined && part.trim().length > 0)
    .join(" ")
    .trim();

/** The request signature Sumsub checks: HMAC-SHA256 over ts+method+path+body. */
export function sumsubSignature(
  secret: string,
  ts: string,
  method: string,
  pathWithQuery: string,
  body: string,
): string {
  return createHmac("sha256", secret)
    .update(`${ts}${method}${pathWithQuery}${body}`)
    .digest("hex");
}

export type SumsubProvider = VerificationProvider & {
  /** The company check once Sumsub has reviewed it; PENDING until then. */
  readonly readCompanyCheck: (
    applicantId: string,
  ) => Promise<ProviderResult<RegistryRecord>>;
  /** The person's ID and liveness once reviewed; PENDING until then. */
  readonly readIdentityCheck: (
    applicantId: string,
  ) => Promise<ProviderResult<IdentityCheck>>;
};

export function createSumsubProvider(options: {
  readonly appToken: string | undefined;
  readonly secretKey: string | undefined;
  readonly kycLevel?: string | undefined;
  readonly kybLevel?: string | undefined;
  readonly fetch?: ProviderFetch | undefined;
  readonly baseUrl?: string | undefined;
  /** Seconds since the epoch; a test fixes it. */
  readonly now?: (() => number) | undefined;
}): SumsubProvider {
  const token = usableKey(options.appToken);
  const secret = usableKey(options.secretKey);
  const connected = token !== null && secret !== null;
  const http = options.fetch ?? boundedFetch;
  const base = options.baseUrl ?? SUMSUB_BASE_URL;
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));
  const kycLevel = options.kycLevel?.trim() || "basic-kyc-level";
  const kybLevel = options.kybLevel?.trim() || "basic-kyb-level";

  const call = async (
    method: "GET" | "POST",
    pathWithQuery: string,
    payload?: unknown,
  ) => {
    const body = payload === undefined ? "" : JSON.stringify(payload);
    const ts = String(now());
    return http(`${base}${pathWithQuery}`, {
      method,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-App-Token": token ?? "",
        "X-App-Access-Ts": ts,
        "X-App-Access-Sig": sumsubSignature(
          secret ?? "",
          ts,
          method,
          pathWithQuery,
          body,
        ),
      },
      ...(payload === undefined ? {} : { body }),
    });
  };

  const create = (level: string, payload: unknown) =>
    guarded<never>(async () => {
      const response = await call(
        "POST",
        `/resources/applicants?levelName=${encodeURIComponent(level)}`,
        payload,
      );
      if (response.status !== 200 && response.status !== 201) {
        return {
          kind: "FAILED",
          reason: `applicant answered ${String(response.status)}`,
        };
      }
      const parsed = ApplicantSchema.safeParse(await response.json());
      return parsed.success
        ? { kind: "PENDING", providerReference: parsed.data.id }
        : { kind: "FAILED", reason: "the applicant could not be read" };
    });

  const read = async (
    applicantId: string,
  ): Promise<
    | { readonly applicant: Applicant }
    | { readonly result: ProviderResult<never> }
  > => {
    const response = await call(
      "GET",
      `/resources/applicants/${encodeURIComponent(applicantId)}/one`,
    );
    if (response.status === 404) return { result: { kind: "NOT_FOUND" } };
    if (response.status !== 200) {
      return {
        result: {
          kind: "FAILED",
          reason: `applicant answered ${String(response.status)}`,
        },
      };
    }
    const parsed = ApplicantSchema.safeParse(await response.json());
    if (!parsed.success) {
      return {
        result: { kind: "FAILED", reason: "the applicant could not be read" },
      };
    }
    const answer = parsed.data.review?.reviewResult?.reviewAnswer;
    if (
      parsed.data.review?.reviewStatus !== "completed" ||
      answer === undefined
    ) {
      return { result: { kind: "PENDING", providerReference: parsed.data.id } };
    }
    return { applicant: parsed.data };
  };

  return {
    code: "SUMSUB",
    connected,
    supports: (_capability, jurisdiction) => ALPHA3[jurisdiction] !== undefined,
    lookupCompany: async (input) => {
      if (!connected) return notConnected("SUMSUB");
      const country = ALPHA3[input.jurisdictionCode];
      if (country === undefined) {
        return {
          kind: "UNSUPPORTED",
          reason: "no Sumsub country for this jurisdiction",
        };
      }
      return create(kybLevel, {
        externalUserId: `company:${input.jurisdictionCode}:${input.registrationNumber}`,
        type: "company",
        info: {
          companyInfo: {
            companyName: input.legalName ?? input.registrationNumber,
            registrationNumber: input.registrationNumber,
            country,
          },
        },
      });
    },
    verifyIdentity: async (input) => {
      if (!connected) return notConnected("SUMSUB");
      if (ALPHA3[input.countryCode] === undefined) {
        return {
          kind: "UNSUPPORTED",
          reason: "no Sumsub country for this jurisdiction",
        };
      }
      // The document and the liveness are captured in Sumsub's own flow;
      // nothing biometric passes through Capital Q on this route.
      return create(kycLevel, {
        externalUserId: input.externalUserId,
        type: "individual",
      });
    },
    readCompanyCheck: async (applicantId) => {
      if (!connected) return notConnected("SUMSUB");
      return guarded(async () => {
        const got = await read(applicantId);
        if ("result" in got) return got.result;
        const company = got.applicant.info?.companyInfo;
        if (company === undefined) {
          return { kind: "FAILED", reason: "the applicant holds no company" };
        }
        const people: RegistryOfficer[] = company.beneficiaries
          .map((beneficiary) => ({
            name: nameOf(beneficiary.info),
            role: beneficiary.types.includes("director")
              ? ("DIRECTOR" as const)
              : beneficiary.types.some(
                    (t) => t === "shareholder" || t === "ubo",
                  )
                ? ("SHAREHOLDER" as const)
                : ("OTHER" as const),
            current: true,
          }))
          .filter((person) => person.name.length > 0);
        const jurisdiction = ALPHA2.get(company.country ?? "");
        if (jurisdiction === undefined) {
          return {
            kind: "FAILED",
            reason: "the applicant's country could not be read",
          };
        }
        return validated(RegistryRecordSchema, {
          legalName: company.companyName,
          registrationNumber: company.registrationNumber ?? "",
          jurisdictionCode: jurisdiction,
          // GREEN is Sumsub's registry check passing; RED is not read as
          // dissolved, only as not shown active.
          status:
            got.applicant.review?.reviewResult?.reviewAnswer === "GREEN"
              ? "ACTIVE"
              : "UNKNOWN",
          incorporatedOn: /^\d{4}-\d{2}-\d{2}$/u.test(
            company.incorporatedOn ?? "",
          )
            ? (company.incorporatedOn ?? null)
            : null,
          officers: people,
          providerReference: `sumsub:${got.applicant.id}`,
        });
      });
    },
    readIdentityCheck: async (applicantId) => {
      if (!connected) return notConnected("SUMSUB");
      return guarded(async () => {
        const got = await read(applicantId);
        if ("result" in got) return got.result;
        const green =
          got.applicant.review?.reviewResult?.reviewAnswer === "GREEN";
        const name = nameOf(got.applicant.info);
        return validated(IdentityCheckSchema, {
          idVerified: green,
          selfieMatched: green,
          nameOnId: name.length === 0 ? null : name,
          providerReference: `sumsub:${got.applicant.id}`,
        });
      });
    },
  };
}
