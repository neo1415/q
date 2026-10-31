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
import {
  ActorContextSchema,
  AuthUserIdSchema,
  OrganisationIdSchema,
  UserIdSchema,
} from "@capital-q/security";

import {
  INVESTOR_COVERAGE_PROFILE,
  INVESTOR_DEFINITION_CURRENT,
  INVESTOR_DEFINITION_V1,
  INVESTOR_DEFINITION_V2,
  INVESTOR_REVISABLE_STEPS,
  INVESTOR_STEPS,
  INVESTOR_WEBSITE_STEP,
  INVESTOR_WEBSITE_WRITE_TARGET,
} from "../src/index.js";
import type { InvestorDomainServices } from "../src/integration/services.js";
import { createInvestorWriteTargets } from "../src/integration/write-targets.js";

/**
 * QA QO-27c (24 Oct 2026): an investor said "our website is ..." and was
 * told it was queued; v1 had no step to hold it. v2 adds the firm's
 * website and writes it to the investor organisation, self-reported.
 */

const MIGRATION = fileURLToPath(
  new URL(
    "../../../supabase/migrations/20261231090000_investor_onboarding_definition_v2.sql",
    import.meta.url,
  ),
);

describe("Investor Definition v2", () => {
  it("is v1 with an optional website step after the firm's name", () => {
    // v3 ("Not sure yet" on deploying) is current now; v2 is its base.
    expect(INVESTOR_DEFINITION_CURRENT.version).toBeGreaterThan(
      INVESTOR_DEFINITION_V2.version,
    );
    expect(() =>
      validateOnboardingManifest(INVESTOR_DEFINITION_V2),
    ).not.toThrow();
    const keys = INVESTOR_DEFINITION_V2.steps.map((s) => s.stepKey);
    expect(keys.indexOf(INVESTOR_WEBSITE_STEP)).toBe(
      keys.indexOf(INVESTOR_STEPS.organisationName) + 1,
    );
    expect(keys.filter((k) => k !== INVESTOR_WEBSITE_STEP)).toEqual(
      INVESTOR_DEFINITION_V1.steps.map((s) => s.stepKey),
    );
    const website = INVESTOR_DEFINITION_V2.steps.find(
      (s) => s.stepKey === INVESTOR_WEBSITE_STEP,
    );
    expect(website).toMatchObject({
      required: false,
      configuration: { stepType: "short_text" },
      writesTo: [{ targetKey: INVESTOR_WEBSITE_WRITE_TARGET }],
    });
    // Saved when given; never pressed for ahead of the mandate.
    expect(
      INVESTOR_COVERAGE_PROFILE.fields[INVESTOR_WEBSITE_STEP]?.priority,
    ).toBe("OPTIONAL");
    expect(INVESTOR_REVISABLE_STEPS.has(INVESTOR_WEBSITE_STEP)).toBe(true);
  });

  it("keeps every v1 step exactly as it was", () => {
    const v2 = new Map(INVESTOR_DEFINITION_V2.steps.map((s) => [s.stepKey, s]));
    for (const step of INVESTOR_DEFINITION_V1.steps) {
      const { sequenceOrder: _a, ...before } = step;
      const { sequenceOrder: _b, ...after } = v2.get(step.stepKey) ?? step;
      expect(after, step.stepKey).toEqual(before);
    }
  });

  it("is committed exactly as rendered, publishing v2 for new sessions", () => {
    const rendered = renderOnboardingDefinitionMigration(
      INVESTOR_DEFINITION_V2,
      {
        packet: "QO-27C-INVESTOR-WEBSITE",
        source: "packages/investor-onboarding/src/definition",
      },
    );
    expect(readFileSync(MIGRATION, "utf8").endsWith(rendered)).toBe(true);
    expect(rendered).toContain("set current_version = 2");
  });
});

const USER = UserIdSchema.parse("b0000000-0000-4000-8000-000000000002");
const ORG = OrganisationIdSchema.parse("e0000000-0000-4000-8000-000000000002");
const INVESTOR = "f0000000-0000-4000-8000-0000000000bb";
const CONTEXT = ActorContextSchema.parse({
  userId: USER,
  tenantId: "c0000000-0000-4000-8000-000000000002",
  organisationId: ORG,
  membershipId: "d0000000-0000-4000-8000-000000000002",
  actorType: "HUMAN",
});

function fakes(current: string | null) {
  const updates: unknown[] = [];
  const services = {
    resolver: {
      resolveHumanContext: () =>
        Promise.resolve({ status: "RESOLVED", context: CONTEXT }),
    },
    organisations: {
      createOrganisation: () => Promise.resolve({ organisation: { id: ORG } }),
    },
    investors: {
      getCurrentInvestorOrganisation: () =>
        Promise.reject(new InvestorOrganisationNotFoundError()),
      createInvestorOrganisation: () => Promise.resolve({ id: INVESTOR }),
      upsertMyInvestorRepresentative: () => Promise.resolve({}),
      getInvestorOrganisation: () =>
        Promise.resolve({ websiteUrl: current, version: 3 }),
      updateInvestorOrganisation: (command: { input: unknown }) => {
        updates.push(command.input);
        return Promise.resolve({});
      },
    },
  } as unknown as InvestorDomainServices;
  return { services, updates };
}

const answer = (stepKey: string, value: unknown): OnboardingResponse =>
  ({ stepKey, value }) as unknown as OnboardingResponse;

const FIRM = [
  answer(INVESTOR_STEPS.organisationName, {
    type: "TEXT",
    text: "Lantern Rock Capital (fictional QA fund)",
  }),
  answer(INVESTOR_STEPS.investorType, {
    type: "SINGLE_SELECT",
    optionKey: "vc",
  }),
];

function context(): OnboardingWriteContext {
  const session = {
    id: "a1000000-0000-4000-8000-000000000002",
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
          "a0000000-0000-4000-8000-000000000002",
        ),
      },
    },
    session,
    step: {},
    correlationId: "cor_test",
    currentResponses: new Map(FIRM.map((r) => [r.stepKey, r])),
    bindContext: (binding: { subject: unknown }) =>
      Promise.resolve({
        ...session,
        subject: binding.subject,
        organisationId: ORG,
        tenantId: CONTEXT.tenantId,
      }),
  } as unknown as OnboardingWriteContext;
}

function websiteTarget(services: InvestorDomainServices) {
  const found = createInvestorWriteTargets({
    services: () => services,
  } as never).find(
    (handler) => handler.targetKey === INVESTOR_WEBSITE_WRITE_TARGET,
  );
  if (found === undefined) throw new Error("no website target");
  return found;
}

const said = (text: string) =>
  answer(INVESTOR_WEBSITE_STEP, { type: "TEXT", text });

describe("the firm's website", () => {
  it("is written to the investor organisation as an https address", async () => {
    const { services, updates } = fakes(null);
    await websiteTarget(services).apply(context(), said(" LanternRock.vc "));
    expect(updates).toEqual([
      { expectedVersion: 3, websiteUrl: "https://LanternRock.vc" },
    ]);
  });

  it("writes nothing when it is already the firm's website", async () => {
    const { services, updates } = fakes("https://lanternrock.vc");
    await websiteTarget(services).apply(
      context(),
      said("https://lanternrock.vc"),
    );
    expect(updates).toEqual([]);
  });

  it("refuses something that is not a web address, and writes nothing", async () => {
    const { services, updates } = fakes(null);
    await expect(
      websiteTarget(services).apply(context(), said("we're on linkedin")),
    ).rejects.toThrow("That isn't a web address.");
    expect(updates).toEqual([]);
  });
});
