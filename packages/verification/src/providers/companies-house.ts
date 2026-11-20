import { z } from "zod";

import {
  boundedFetch,
  guarded,
  notConnected,
  RegistryRecordSchema,
  usableKey,
  validated,
  type ProviderFetch,
  type RegistryOfficer,
  type RegistryRecord,
  type VerificationProvider,
} from "./contract.js";

/**
 * UK Companies House (free public data API): the company profile, its
 * officers and its persons with significant control. Registry only; it
 * holds no ID checks. Key: COMPANIES_HOUSE_API_KEY (HTTP Basic, the key as
 * the user name).
 */
export const COMPANIES_HOUSE_BASE_URL =
  "https://api.company-information.service.gov.uk";

const ProfileSchema = z.object({
  company_name: z.string(),
  company_number: z.string(),
  company_status: z.string(),
  date_of_creation: z.string().optional(),
});
const OfficersSchema = z.object({
  items: z
    .array(
      z.object({
        name: z.string(),
        officer_role: z.string(),
        resigned_on: z.string().optional(),
      }),
    )
    .default([]),
});
const PscsSchema = z.object({
  items: z
    .array(
      z.object({
        name: z.string().optional(),
        kind: z.string(),
        ceased_on: z.string().optional(),
      }),
    )
    .default([]),
});

const ACTIVE = new Set(["active", "open", "registered"]);
const DISSOLVED = new Set([
  "dissolved",
  "closed",
  "converted-closed",
  "removed",
]);

/** "12345" -> "00012345"; prefixed numbers ("SC123456") as given. */
export function companiesHouseNumber(raw: string): string {
  const number = raw.replace(/\s+/gu, "").toUpperCase();
  return /^\d{1,8}$/u.test(number) ? number.padStart(8, "0") : number;
}

export function createCompaniesHouseProvider(options: {
  readonly apiKey: string | undefined;
  readonly fetch?: ProviderFetch | undefined;
  readonly baseUrl?: string | undefined;
}): VerificationProvider {
  const key = usableKey(options.apiKey);
  const http = options.fetch ?? boundedFetch;
  const base = options.baseUrl ?? COMPANIES_HOUSE_BASE_URL;
  const headers = {
    Authorization: `Basic ${Buffer.from(`${key ?? ""}:`).toString("base64")}`,
    Accept: "application/json",
  };
  const get = (path: string) =>
    http(`${base}${path}`, { method: "GET", headers });
  return {
    code: "COMPANIES_HOUSE",
    connected: key !== null,
    supports: (capability, jurisdiction) =>
      capability === "REGISTRY_LOOKUP" && jurisdiction === "GB",
    lookupCompany: async (input) => {
      if (key === null) return notConnected("COMPANIES_HOUSE");
      if (input.jurisdictionCode !== "GB") {
        return {
          kind: "UNSUPPORTED",
          reason: "Companies House covers the UK only",
        };
      }
      return guarded(async () => {
        const number = encodeURIComponent(
          companiesHouseNumber(input.registrationNumber),
        );
        const profileResponse = await get(`/company/${number}`);
        if (profileResponse.status === 404) return { kind: "NOT_FOUND" };
        if (profileResponse.status !== 200) {
          return {
            kind: "FAILED",
            reason: `registry answered ${String(profileResponse.status)}`,
          };
        }
        const profile = ProfileSchema.safeParse(await profileResponse.json());
        if (!profile.success) {
          return {
            kind: "FAILED",
            reason: "the registry's response could not be read",
          };
        }
        const [officersResponse, pscResponse] = await Promise.all([
          get(`/company/${number}/officers?items_per_page=100`),
          get(
            `/company/${number}/persons-with-significant-control?items_per_page=100`,
          ),
        ]);
        const officers =
          officersResponse.status === 200
            ? OfficersSchema.safeParse(await officersResponse.json())
            : null;
        const pscs =
          pscResponse.status === 200
            ? PscsSchema.safeParse(await pscResponse.json())
            : null;
        // Without the officer list the director match cannot be made: a
        // failure, not a record that silently lists nobody.
        if (officers?.success !== true) {
          return {
            kind: "FAILED",
            reason: "the registry's officer list could not be read",
          };
        }
        const people: RegistryOfficer[] = [
          ...officers.data.items.map((officer) => ({
            name: officer.name,
            role: officerRole(officer.officer_role),
            current: officer.resigned_on === undefined,
          })),
          ...(pscs?.success === true ? pscs.data.items : [])
            .filter(
              (psc) =>
                psc.kind.startsWith("individual") && psc.name !== undefined,
            )
            .map((psc) => ({
              name: psc.name ?? "",
              role: "PSC" as const,
              current: psc.ceased_on === undefined,
            })),
        ];
        const status = profile.data.company_status.toLowerCase();
        const record: RegistryRecord = {
          legalName: profile.data.company_name,
          registrationNumber: profile.data.company_number,
          jurisdictionCode: "GB",
          status: ACTIVE.has(status)
            ? "ACTIVE"
            : DISSOLVED.has(status)
              ? "DISSOLVED"
              : "INACTIVE",
          incorporatedOn: profile.data.date_of_creation ?? null,
          officers: people,
          providerReference: `companies-house:${profile.data.company_number}`,
        };
        return validated(RegistryRecordSchema, record);
      });
    },
    verifyIdentity: () =>
      Promise.resolve(
        key === null
          ? notConnected("COMPANIES_HOUSE")
          : {
              kind: "UNSUPPORTED",
              reason: "Companies House does not check identity documents",
            },
      ),
  };
}

function officerRole(role: string): RegistryOfficer["role"] {
  if (role.includes("director")) return "DIRECTOR";
  if (role.includes("secretary")) return "SECRETARY";
  return "OTHER";
}
