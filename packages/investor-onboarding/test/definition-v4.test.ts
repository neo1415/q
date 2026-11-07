import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  renderOnboardingDefinitionMigration,
  validateOnboardingManifest,
  type OnboardingResponse,
  type OnboardingWriteContext,
} from "@capital-q/onboarding";
import { InvestorOrganisationNotFoundError } from "@capital-q/investors";
import { countryOfIso } from "@capital-q/taxonomy/countries";
import {
  ActorContextSchema,
  AuthUserIdSchema,
  OrganisationIdSchema,
  UserIdSchema,
} from "@capital-q/security";

import {
  INVESTOR_DEFINITION_CURRENT,
  INVESTOR_DEFINITION_V3,
  INVESTOR_DEFINITION_V4,
  INVESTOR_HQ_COUNTRY_STEP,
  INVESTOR_HQ_COUNTRY_WRITE_TARGET,
  INVESTOR_REVISABLE_STEPS,
  INVESTOR_STEPS,
  INVESTOR_WEBSITE_STEP,
  investorHqCountryOf,
} from "../src/index.js";
import type { InvestorDomainServices } from "../src/integration/services.js";
import { createInvestorWriteTargets } from "../src/integration/write-targets.js";

/**
 * Investor v4 (owner 2026-11-07, DECISIONS 79): the mandatory set, and the
 * firm's headquarters country, which KYB and founder-side ranking read and
 * no step asked.
 */
const MIGRATION = fileURLToPath(
  new URL(
    "../../../supabase/migrations/20261231450000_investor_onboarding_definition_v4.sql",
    import.meta.url,
  ),
);

const stepOf = (key: string) =>
  INVESTOR_DEFINITION_V4.steps.find((s) => s.stepKey === key);

describe("Investor Definition v4", () => {
  it("is valid and current", () => {
    expect(() =>
      validateOnboardingManifest(INVESTOR_DEFINITION_V4),
    ).not.toThrow();
    expect(INVESTOR_DEFINITION_CURRENT).toBe(INVESTOR_DEFINITION_V4);
    expect(INVESTOR_DEFINITION_V4.version).toBe(4);
  });

  it("asks where the firm is based, right after its website, as one country", () => {
    const keys = INVESTOR_DEFINITION_V4.steps.map((s) => s.stepKey);
    expect(keys.indexOf(INVESTOR_HQ_COUNTRY_STEP)).toBe(
      keys.indexOf(INVESTOR_WEBSITE_STEP) + 1,
    );
    expect(stepOf(INVESTOR_HQ_COUNTRY_STEP)).toMatchObject({
      required: true,
      configuration: {
        stepType: "reference_select",
        resourceType: "TAXONOMY_NODE",
        vocabularyCodes: ["geography"],
        maxItems: 1,
      },
      writesTo: [{ targetKey: INVESTOR_HQ_COUNTRY_WRITE_TARGET }],
    });
    expect(INVESTOR_REVISABLE_STEPS.has(INVESTOR_HQ_COUNTRY_STEP)).toBe(true);
  });

  it("makes the profile's, mandate's, matching's and verification's fields mandatory", () => {
    for (const key of [
      INVESTOR_STEPS.investorType,
      INVESTOR_STEPS.organisationName,
      INVESTOR_WEBSITE_STEP,
      INVESTOR_HQ_COUNTRY_STEP,
      INVESTOR_STEPS.businessTitle,
      INVESTOR_STEPS.deploymentStatus,
      INVESTOR_STEPS.stages,
      INVESTOR_STEPS.currency,
      INVESTOR_STEPS.chequeMin,
      INVESTOR_STEPS.chequeTypical,
      INVESTOR_STEPS.chequeMax,
      INVESTOR_STEPS.investmentRole,
      INVESTOR_STEPS.geography,
      INVESTOR_STEPS.sectors,
      INVESTOR_STEPS.inboundPreference,
    ]) {
      expect(stepOf(key)?.required, key).toBe(true);
    }
    expect(stepOf(INVESTOR_STEPS.discoveryMode)?.required).toBe(false);
  });

  it("never calls a mandatory step optional, nor says to leave it empty", () => {
    for (const step of INVESTOR_DEFINITION_V4.steps) {
      if (!step.required) continue;
      expect(step.configuration.supportingText ?? "", step.stepKey).not.toMatch(
        /optional|leave (it )?empty/iu,
      );
    }
  });

  it("changes nothing else: every v3 step keeps its key, order, type, branch and target", () => {
    const v4 = INVESTOR_DEFINITION_V4.steps.filter(
      (s) => s.stepKey !== INVESTOR_HQ_COUNTRY_STEP,
    );
    expect(v4.map((s) => s.stepKey)).toEqual(
      INVESTOR_DEFINITION_V3.steps.map((s) => s.stepKey),
    );
    INVESTOR_DEFINITION_V3.steps.forEach((before, index) => {
      const after = v4[index];
      expect(after?.branching).toEqual(before.branching);
      expect(after?.writesTo).toEqual(before.writesTo);
      expect(after?.configuration.stepType).toBe(before.configuration.stepType);
    });
  });

  it("is committed exactly as rendered, publishing v4 for new sessions", () => {
    const rendered = renderOnboardingDefinitionMigration(
      INVESTOR_DEFINITION_V4,
      {
        packet: "OWNER-MANDATORY-SET",
        source: "packages/investor-onboarding/src/definition",
      },
    );
    const committed = readFileSync(MIGRATION, "utf8");
    expect(committed.endsWith(rendered)).toBe(true);
    expect(rendered).toContain("set current_version = 4");
    expect(committed).not.toMatch(
      /^\s*(drop|alter|grant|revoke|create|delete|truncate)\b/imu,
    );
  });
});

describe("the firm's headquarters country", () => {
  const USER = UserIdSchema.parse("b0000000-0000-4000-8000-000000000004");
  const ORG = OrganisationIdSchema.parse(
    "e0000000-0000-4000-8000-000000000004",
  );
  const CONTEXT = ActorContextSchema.parse({
    userId: USER,
    tenantId: "c0000000-0000-4000-8000-000000000004",
    organisationId: ORG,
    membershipId: "d0000000-0000-4000-8000-000000000004",
    actorType: "HUMAN",
  });
  const answer = (stepKey: string, value: unknown): OnboardingResponse =>
    ({ stepKey, value }) as unknown as OnboardingResponse;

  const FIRM = [
    answer(INVESTOR_STEPS.organisationName, {
      type: "TEXT",
      text: "Wadden Polder Ventures (fictional QA fund)",
    }),
    answer(INVESTOR_STEPS.investorType, {
      type: "SINGLE_SELECT",
      optionKey: "vc",
    }),
  ];

  function fakes(current: string | null) {
    const updates: unknown[] = [];
    const services = {
      resolver: {
        resolveHumanContext: () =>
          Promise.resolve({ status: "RESOLVED", context: CONTEXT }),
      },
      organisations: {
        createOrganisation: () =>
          Promise.resolve({ organisation: { id: ORG } }),
      },
      investors: {
        getCurrentInvestorOrganisation: () =>
          Promise.reject(new InvestorOrganisationNotFoundError()),
        createInvestorOrganisation: () =>
          Promise.resolve({ id: "f0000000-0000-4000-8000-0000000000dd" }),
        upsertMyInvestorRepresentative: () => Promise.resolve({}),
        getInvestorOrganisation: () =>
          Promise.resolve({ hqCountry: current, version: 7 }),
        updateInvestorOrganisation: (command: { input: unknown }) => {
          updates.push(command.input);
          return Promise.resolve({});
        },
      },
    } as unknown as InvestorDomainServices;
    return { services, updates };
  }

  function context(chosen: OnboardingResponse): OnboardingWriteContext {
    const session = {
      id: "a1000000-0000-4000-8000-000000000004",
      subject: null,
      organisationId: null,
      tenantId: null,
      version: 1,
    };
    return {
      tx: { sql: () => Promise.resolve([]) },
      actor: {
        userId: USER,
        context: null,
        principal: {
          authUserId: AuthUserIdSchema.parse(
            "a0000000-0000-4000-8000-000000000004",
          ),
        },
      },
      session,
      step: {},
      correlationId: "cor_test",
      currentResponses: new Map(
        [...FIRM, chosen].map((r) => [r.stepKey, r] as const),
      ),
      bindContext: (binding: { subject: unknown }) =>
        Promise.resolve({
          ...session,
          subject: binding.subject,
          organisationId: ORG,
          tenantId: CONTEXT.tenantId,
        }),
    } as unknown as OnboardingWriteContext;
  }

  async function write(current: string | null, value: unknown) {
    const { services, updates } = fakes(current);
    const target = createInvestorWriteTargets({
      services: () => services,
    } as never).find((h) => h.targetKey === INVESTOR_HQ_COUNTRY_WRITE_TARGET);
    if (target === undefined) throw new Error("no HQ country target");
    const chosen = answer(INVESTOR_HQ_COUNTRY_STEP, value);
    await target.apply(context(chosen), chosen);
    return updates;
  }

  const nodeOf = (iso: string) => {
    const node = countryOfIso(iso)?.nodeId;
    if (node === undefined) throw new Error(iso);
    return {
      type: "RESOURCE_REFERENCE",
      resourceType: "TAXONOMY_NODE",
      resourceIds: [node],
    };
  };

  it("saves the country's ISO code on the firm", async () => {
    expect(await write(null, nodeOf("NL"))).toEqual([
      { expectedVersion: 7, hqCountry: "NL" },
    ]);
    expect(await write(null, { type: "TEXT", text: "Kenya" })).toEqual([
      { expectedVersion: 7, hqCountry: "KE" },
    ]);
  });

  it('leaves it unknown for "I don\'t know", and writes nothing when already so', async () => {
    expect(await write("NL", { type: "TEXT", text: "I don't know" })).toEqual([
      { expectedVersion: 7, hqCountry: null },
    ]);
    expect(await write(null, { type: "TEXT", text: "I don't know" })).toEqual(
      [],
    );
    expect(investorHqCountryOf({ type: "TEXT", text: "West Africa" })).toBe(
      null,
    );
  });
});
