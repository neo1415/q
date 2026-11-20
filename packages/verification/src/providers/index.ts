import { createCompaniesHouseProvider } from "./companies-house.js";
import type {
  ProviderFetch,
  VerificationAdapterCode,
  VerificationProvider,
} from "./contract.js";
import { createDojahProvider, DOJAH_KYB_COUNTRIES } from "./dojah.js";
import { createSumsubProvider, type SumsubProvider } from "./sumsub.js";

/**
 * V1: the three verification providers, composed from the environment, and
 * the route decision 113 sets: the UK register through Companies House,
 * Nigeria, Kenya and South Africa through Dojah (and Nigerian ID through
 * Dojah), everything else through Sumsub. Names only here, never values.
 */
export const VERIFICATION_PROVIDER_ENV = {
  COMPANIES_HOUSE: ["COMPANIES_HOUSE_API_KEY"],
  DOJAH: ["DOJAH_APP_ID", "DOJAH_SECRET_KEY"],
  SUMSUB: ["SUMSUB_APP_TOKEN", "SUMSUB_SECRET_KEY"],
} as const satisfies Record<VerificationAdapterCode, readonly string[]>;

export type VerificationProviders = {
  readonly companiesHouse: VerificationProvider;
  readonly dojah: VerificationProvider;
  readonly sumsub: SumsubProvider;
};

export function createVerificationProviders(
  env: Readonly<Record<string, string | undefined>>,
  options: { readonly fetch?: ProviderFetch | undefined } = {},
): VerificationProviders {
  return {
    companiesHouse: createCompaniesHouseProvider({
      apiKey: env.COMPANIES_HOUSE_API_KEY,
      fetch: options.fetch,
    }),
    dojah: createDojahProvider({
      appId: env.DOJAH_APP_ID,
      secretKey: env.DOJAH_SECRET_KEY,
      fetch: options.fetch,
    }),
    sumsub: createSumsubProvider({
      appToken: env.SUMSUB_APP_TOKEN,
      secretKey: env.SUMSUB_SECRET_KEY,
      kycLevel: env.SUMSUB_KYC_LEVEL,
      kybLevel: env.SUMSUB_KYB_LEVEL,
      fetch: options.fetch,
    }),
  };
}

/** Whose register a company in this jurisdiction is checked against. */
export function registryProviderFor(
  jurisdictionCode: string,
  providers: VerificationProviders,
): VerificationProvider {
  if (jurisdictionCode === "GB") return providers.companiesHouse;
  if (DOJAH_KYB_COUNTRIES.has(jurisdictionCode)) return providers.dojah;
  return providers.sumsub;
}

/** Who checks a founder's ID and selfie in this country. */
export function identityProviderFor(
  countryCode: string,
  providers: VerificationProviders,
): VerificationProvider {
  return countryCode === "NG" ? providers.dojah : providers.sumsub;
}

export type ProviderConnection = {
  readonly provider: VerificationAdapterCode;
  readonly label: string;
  readonly covers: string;
  readonly connected: boolean;
  /** What the screen says; "Not connected" is said as it is. */
  readonly description: string;
};

const LABELS: Readonly<
  Record<
    VerificationAdapterCode,
    { readonly label: string; readonly covers: string }
  >
> = {
  COMPANIES_HOUSE: { label: "Companies House", covers: "UK company register" },
  DOJAH: {
    label: "Dojah",
    covers:
      "Company registers in Nigeria, Kenya and South Africa; Nigerian ID and selfie",
  },
  SUMSUB: {
    label: "Sumsub",
    covers: "ID, selfie and company checks in other countries",
  },
};

/** Each provider's connection, for the screen and the admin. No secret. */
export function providerConnections(
  providers: VerificationProviders,
): readonly ProviderConnection[] {
  return [providers.companiesHouse, providers.dojah, providers.sumsub].map(
    (provider) => {
      const { label, covers } = LABELS[provider.code];
      return {
        provider: provider.code,
        label,
        covers,
        connected: provider.connected,
        description: provider.connected
          ? `${label} is connected.`
          : `${label} is not connected. No automatic check runs through it; a Capital Q operator reviews these by hand.`,
      };
    },
  );
}
