import { describe, expect, it, vi } from "vitest";

import {
  createCompaniesHouseProvider,
  createDojahProvider,
  createSumsubProvider,
  createVerificationProviders,
  identityProviderFor,
  providerConnections,
  registryProviderFor,
  startIdentityCheck,
  sumsubSignature,
  type ProviderFetch,
} from "../src/index.js";

import {
  COMPANIES_HOUSE_OFFICERS,
  COMPANIES_HOUSE_PROFILE,
  COMPANIES_HOUSE_PSC,
  DOJAH_BUSINESS_NG,
  DOJAH_BVN_SELFIE,
  SUMSUB_APPLICANT_CREATED,
  SUMSUB_COMPANY_GREEN,
  SUMSUB_PERSON_GREEN,
  SUMSUB_PERSON_PENDING,
} from "./fixtures/provider-responses.js";

/**
 * V1 adapters against recorded, synthetic responses: no live provider
 * call. A missing or disabled key is "not connected", and nothing is sent.
 */

const DISABLED = "disabled-locally-000000000000";
const KEY = "test-key-not-real";

type Recorded = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
};

function replay(routes: Record<string, { status: number; body: unknown }>) {
  const calls: Recorded[] = [];
  const fetch: ProviderFetch = (url, init) => {
    calls.push({
      url,
      method: init.method,
      headers: { ...init.headers },
      ...(init.body === undefined ? {} : { body: init.body }),
    });
    const path = new URL(url).pathname;
    const hit = routes[path] ?? { status: 404, body: {} };
    return Promise.resolve({
      status: hit.status,
      json: () => Promise.resolve(hit.body),
    });
  };
  return { fetch, calls };
}

const consent = {
  givenAt: "2026-11-20T10:00:00Z",
  textVersion: "biometric-consent-v1",
  explicit: true as const,
};
const selfie = "A".repeat(200);

describe("Companies House adapter", () => {
  it("reads the company, its officers and its PSCs", async () => {
    const { fetch, calls } = replay({
      "/company/01234567": { status: 200, body: COMPANIES_HOUSE_PROFILE },
      "/company/01234567/officers": {
        status: 200,
        body: COMPANIES_HOUSE_OFFICERS,
      },
      "/company/01234567/persons-with-significant-control": {
        status: 200,
        body: COMPANIES_HOUSE_PSC,
      },
    });
    const provider = createCompaniesHouseProvider({ apiKey: KEY, fetch });
    const result = await provider.lookupCompany({
      jurisdictionCode: "GB",
      registrationNumber: "1234567",
    });
    expect(result).toEqual({
      kind: "OK",
      value: {
        legalName: "EXAMPLE ROBOTICS LTD",
        registrationNumber: "01234567",
        jurisdictionCode: "GB",
        status: "ACTIVE",
        incorporatedOn: "2021-03-04",
        officers: [
          { name: "EXAMPLE, Ada Ngozi", role: "DIRECTOR", current: true },
          { name: "SAMPLE, Bo", role: "DIRECTOR", current: false },
          {
            name: "FICTIONAL SECRETARIES LIMITED",
            role: "SECRETARY",
            current: true,
          },
          { name: "Mr Cai Placeholder", role: "PSC", current: true },
        ],
        providerReference: "companies-house:01234567",
      },
    });
    expect(calls[0]?.headers.Authorization).toBe(
      `Basic ${Buffer.from(`${KEY}:`).toString("base64")}`,
    );
  });

  it("says not found, and refuses outside the UK and for ID checks", async () => {
    const { fetch } = replay({});
    const provider = createCompaniesHouseProvider({ apiKey: KEY, fetch });
    expect(
      await provider.lookupCompany({
        jurisdictionCode: "GB",
        registrationNumber: "99999999",
      }),
    ).toEqual({ kind: "NOT_FOUND" });
    expect(
      (
        await provider.lookupCompany({
          jurisdictionCode: "NG",
          registrationNumber: "1",
        })
      ).kind,
    ).toBe("UNSUPPORTED");
    expect(
      (
        await provider.verifyIdentity({
          countryCode: "GB",
          externalUserId: "00000000-0000-4000-8000-000000000001",
          consent,
        })
      ).kind,
    ).toBe("UNSUPPORTED");
  });

  it("a network failure is a failure, never a success", async () => {
    const provider = createCompaniesHouseProvider({
      apiKey: KEY,
      fetch: () => Promise.reject(new Error("down")),
    });
    expect(
      (
        await provider.lookupCompany({
          jurisdictionCode: "GB",
          registrationNumber: "1",
        })
      ).kind,
    ).toBe("FAILED");
  });
});

describe("Dojah adapter", () => {
  it("reads a Nigerian company with its directors and shareholders", async () => {
    const { fetch, calls } = replay({
      "/api/v1/kyb/business/detail": { status: 200, body: DOJAH_BUSINESS_NG },
    });
    const provider = createDojahProvider({
      appId: "app",
      secretKey: KEY,
      fetch,
    });
    const result = await provider.lookupCompany({
      jurisdictionCode: "NG",
      registrationNumber: "RC1234567",
    });
    expect(result.kind).toBe("OK");
    if (result.kind !== "OK") return;
    expect(result.value).toMatchObject({
      legalName: "LAGOS EXAMPLE TECHNOLOGIES LIMITED",
      status: "ACTIVE",
      incorporatedOn: "2020-06-15",
      providerReference: "dojah:NG:RC1234567",
    });
    expect(result.value.officers).toEqual([
      { name: "Ada Example", role: "DIRECTOR", current: true },
      { name: "Tunde K Sample", role: "SHAREHOLDER", current: true },
      { name: "Old Director", role: "DIRECTOR", current: false },
    ]);
    expect(calls[0]?.headers).toMatchObject({
      AppId: "app",
      Authorization: KEY,
    });
    expect(calls[0]?.url).toContain("country_code=NG");
  });

  it("checks a BVN with a selfie, and keeps no ID number", async () => {
    const { fetch, calls } = replay({
      "/api/v1/kyc/bvn/verify": { status: 200, body: DOJAH_BVN_SELFIE },
    });
    const provider = createDojahProvider({
      appId: "app",
      secretKey: KEY,
      fetch,
    });
    const result = await provider.verifyIdentity({
      countryCode: "NG",
      externalUserId: "00000000-0000-4000-8000-000000000001",
      idType: "BVN",
      idNumber: "22200000000",
      selfieImage: selfie,
      consent,
    });
    expect(result).toEqual({
      kind: "OK",
      value: {
        idVerified: true,
        selfieMatched: true,
        nameOnId: "ADA NGOZI EXAMPLE",
        providerReference: "dojah:bvn:00000000-0000-4000-8000-000000000001",
      },
    });
    expect(JSON.stringify(result)).not.toContain("22200000000");
    expect(calls[0]?.method).toBe("POST");
  });

  it("covers KYB in NG, KE and ZA only, and ID in Nigeria only", async () => {
    const provider = createDojahProvider({
      appId: "app",
      secretKey: KEY,
      fetch: replay({}).fetch,
    });
    expect(provider.supports("REGISTRY_LOOKUP", "KE")).toBe(true);
    expect(provider.supports("REGISTRY_LOOKUP", "GH")).toBe(false);
    expect(provider.supports("ID_SELFIE", "KE")).toBe(false);
    expect(
      (
        await provider.lookupCompany({
          jurisdictionCode: "GH",
          registrationNumber: "1",
        })
      ).kind,
    ).toBe("UNSUPPORTED");
  });
});

describe("Sumsub adapter", () => {
  it("starts a person applicant (signed) and reads the review once done", async () => {
    const { fetch, calls } = replay({
      "/resources/applicants": { status: 200, body: SUMSUB_APPLICANT_CREATED },
      "/resources/applicants/5f00000000000000000000aa/one": {
        status: 200,
        body: SUMSUB_PERSON_GREEN,
      },
    });
    const provider = createSumsubProvider({
      appToken: "tok",
      secretKey: KEY,
      fetch,
      now: () => 1_700_000_000,
    });
    const started = await provider.verifyIdentity({
      countryCode: "DE",
      externalUserId: "00000000-0000-4000-8000-000000000002",
      consent,
    });
    expect(started).toEqual({
      kind: "PENDING",
      providerReference: "5f00000000000000000000aa",
    });
    const sent = calls[0];
    expect(sent?.headers["X-App-Token"]).toBe("tok");
    const path =
      new URL(sent?.url ?? "").pathname + new URL(sent?.url ?? "").search;
    expect(sent?.headers["X-App-Access-Sig"]).toBe(
      sumsubSignature(KEY, "1700000000", "POST", path, sent?.body ?? ""),
    );
    expect(
      await provider.readIdentityCheck("5f00000000000000000000aa"),
    ).toEqual({
      kind: "OK",
      value: {
        idVerified: true,
        selfieMatched: true,
        nameOnId: "Eve Placeholder",
        providerReference: "sumsub:5f00000000000000000000aa",
      },
    });
  });

  it("an unreviewed applicant stays pending", async () => {
    const { fetch } = replay({
      "/resources/applicants/5f00000000000000000000aa/one": {
        status: 200,
        body: SUMSUB_PERSON_PENDING,
      },
    });
    const provider = createSumsubProvider({
      appToken: "tok",
      secretKey: KEY,
      fetch,
    });
    expect(
      (await provider.readIdentityCheck("5f00000000000000000000aa")).kind,
    ).toBe("PENDING");
  });

  it("reads a company check with its beneficiaries", async () => {
    const { fetch } = replay({
      "/resources/applicants/5f00000000000000000000bb/one": {
        status: 200,
        body: SUMSUB_COMPANY_GREEN,
      },
    });
    const provider = createSumsubProvider({
      appToken: "tok",
      secretKey: KEY,
      fetch,
    });
    const result = await provider.readCompanyCheck("5f00000000000000000000bb");
    expect(result).toEqual({
      kind: "OK",
      value: {
        legalName: "Beispiel Software GmbH",
        registrationNumber: "HRB 123456",
        jurisdictionCode: "DE",
        status: "ACTIVE",
        incorporatedOn: "2019-05-01",
        officers: [
          { name: "Eve Placeholder", role: "DIRECTOR", current: true },
          { name: "Finn Muster", role: "SHAREHOLDER", current: true },
        ],
        providerReference: "sumsub:5f00000000000000000000bb",
      },
    });
  });
});

describe("not connected, honestly", () => {
  it("a missing or disabled key is not connected, and nothing is sent", async () => {
    const fetch = vi.fn<ProviderFetch>();
    const providers = [
      createCompaniesHouseProvider({ apiKey: undefined, fetch }),
      createCompaniesHouseProvider({ apiKey: DISABLED, fetch }),
      createDojahProvider({ appId: "app", secretKey: DISABLED, fetch }),
      createDojahProvider({ appId: undefined, secretKey: KEY, fetch }),
      createSumsubProvider({ appToken: DISABLED, secretKey: DISABLED, fetch }),
      createSumsubProvider({ appToken: "  ", secretKey: KEY, fetch }),
    ];
    for (const provider of providers) {
      expect(provider.connected, provider.code).toBe(false);
      expect(
        await provider.lookupCompany({
          jurisdictionCode: "GB",
          registrationNumber: "1",
        }),
      ).toEqual({
        kind: "NOT_CONNECTED",
        provider: provider.code,
      });
      expect(
        (
          await provider.verifyIdentity({
            countryCode: "NG",
            externalUserId: "00000000-0000-4000-8000-000000000001",
            consent,
          })
        ).kind,
      ).toBe("NOT_CONNECTED");
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("the screen and the admin are told which are not connected", () => {
    const connections = providerConnections(
      createVerificationProviders({
        COMPANIES_HOUSE_API_KEY: KEY,
        DOJAH_APP_ID: DISABLED,
        DOJAH_SECRET_KEY: DISABLED,
      }),
    );
    expect(connections.map((c) => [c.provider, c.connected])).toEqual([
      ["COMPANIES_HOUSE", true],
      ["DOJAH", false],
      ["SUMSUB", false],
    ]);
    expect(connections[1]?.description).toContain("not connected");
    expect(JSON.stringify(connections)).not.toContain(KEY);
  });

  it("routes by country as decision 113 sets", () => {
    const providers = createVerificationProviders({});
    expect(registryProviderFor("GB", providers).code).toBe("COMPANIES_HOUSE");
    expect(registryProviderFor("KE", providers).code).toBe("DOJAH");
    expect(registryProviderFor("DE", providers).code).toBe("SUMSUB");
    expect(identityProviderFor("NG", providers).code).toBe("DOJAH");
    expect(identityProviderFor("GB", providers).code).toBe("SUMSUB");
  });
});

describe("biometric consent before any ID or selfie", () => {
  const input = {
    countryCode: "NG",
    externalUserId: "00000000-0000-4000-8000-000000000001",
    idType: "BVN",
    idNumber: "22200000000",
    selfieImage: selfie,
  };

  it("nothing is sent without explicit consent", async () => {
    const fetch = vi.fn<ProviderFetch>();
    const provider = createDojahProvider({
      appId: "app",
      secretKey: KEY,
      fetch,
    });
    expect(await startIdentityCheck(provider, input)).toEqual({
      kind: "CONSENT_REQUIRED",
    });
    expect(
      await startIdentityCheck(provider, {
        ...input,
        consent: { ...consent, explicit: false },
      }),
    ).toEqual({ kind: "CONSENT_REQUIRED" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("the consent is recorded before anything is sent; unrecorded, nothing is", async () => {
    const order: string[] = [];
    const { fetch } = replay({
      "/api/v1/kyc/bvn/verify": { status: 200, body: DOJAH_BVN_SELFIE },
    });
    const provider = createDojahProvider({
      appId: "app",
      secretKey: KEY,
      fetch: (url, init) => {
        order.push("sent");
        return fetch(url, init);
      },
    });
    const recorded = await startIdentityCheck(
      provider,
      { ...input, consent },
      (given) => {
        order.push(`consent ${given.textVersion}`);
        return Promise.resolve();
      },
    );
    expect(recorded.kind).toBe("OK");
    expect(order).toEqual(["consent biometric-consent-v1", "sent"]);
    order.length = 0;
    const refused = await startIdentityCheck(
      provider,
      { ...input, consent },
      () => Promise.reject(new Error("down")),
    );
    expect(refused.kind).toBe("FAILED");
    expect(order).toEqual([]);
  });

  it("with consent the check runs", async () => {
    const { fetch } = replay({
      "/api/v1/kyc/bvn/verify": { status: 200, body: DOJAH_BVN_SELFIE },
    });
    const provider = createDojahProvider({
      appId: "app",
      secretKey: KEY,
      fetch,
    });
    expect(
      (await startIdentityCheck(provider, { ...input, consent })).kind,
    ).toBe("OK");
  });
});
