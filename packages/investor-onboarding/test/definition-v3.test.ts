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
  INVESTOR_DEFINITION_CURRENT,
  INVESTOR_DEFINITION_V2,
  INVESTOR_DEFINITION_V3,
  INVESTOR_STEPS,
  INVESTOR_WRITE_TARGETS,
  NOT_SURE_OPTION_KEY,
} from "../src/index.js";
import type { InvestorDomainServices } from "../src/integration/services.js";
import { createInvestorWriteTargets } from "../src/integration/write-targets.js";

/**
 * Live re-check 2026-10-31: an investor did not know whether the firm was
 * deploying; Q offered to record that, they said "Yes, please.", and with
 * no option to hold it their words became the deployment status. v3 adds
 * "Not sure yet": an answer, never a deployment state.
 */

const MIGRATION = fileURLToPath(
  new URL(
    "../../../supabase/migrations/20261231210000_investor_onboarding_definition_v3.sql",
    import.meta.url,
  ),
);

const deploymentStep = (manifest: typeof INVESTOR_DEFINITION_V3) =>
  manifest.steps.find((s) => s.stepKey === INVESTOR_STEPS.deploymentStatus);

const optionKeysOf = (manifest: typeof INVESTOR_DEFINITION_V3) => {
  const configuration = deploymentStep(manifest)?.configuration;
  return configuration?.stepType === "single_select"
    ? configuration.options.map((o) => o.optionKey)
    : [];
};

describe("Investor Definition v3", () => {
  it("is current, and v2 with 'Not sure yet' last on the required deployment step", () => {
    expect(INVESTOR_DEFINITION_CURRENT).toBe(INVESTOR_DEFINITION_V3);
    expect(INVESTOR_DEFINITION_V3.version).toBe(3);
    expect(() =>
      validateOnboardingManifest(INVESTOR_DEFINITION_V3),
    ).not.toThrow();
    expect(optionKeysOf(INVESTOR_DEFINITION_V3)).toEqual([
      ...optionKeysOf(INVESTOR_DEFINITION_V2),
      NOT_SURE_OPTION_KEY,
    ]);
    expect(deploymentStep(INVESTOR_DEFINITION_V3)?.required).toBe(true);
  });

  it("keeps every other v2 step exactly as it was", () => {
    const v3 = new Map(INVESTOR_DEFINITION_V3.steps.map((s) => [s.stepKey, s]));
    expect([...v3.keys()]).toEqual(
      INVESTOR_DEFINITION_V2.steps.map((s) => s.stepKey),
    );
    for (const step of INVESTOR_DEFINITION_V2.steps) {
      if (step.stepKey === INVESTOR_STEPS.deploymentStatus) continue;
      expect(v3.get(step.stepKey), step.stepKey).toEqual(step);
    }
    const { configuration: before, ...restBefore } =
      deploymentStep(INVESTOR_DEFINITION_V2) ?? {};
    const { configuration: after, ...restAfter } =
      deploymentStep(INVESTOR_DEFINITION_V3) ?? {};
    expect(restAfter).toEqual(restBefore);
    expect({ ...after, options: undefined }).toEqual({
      ...before,
      options: undefined,
    });
  });

  it("is committed exactly as rendered, publishing v3 for new sessions", () => {
    const rendered = renderOnboardingDefinitionMigration(
      INVESTOR_DEFINITION_V3,
      {
        packet: "LIVE-RECHECK-1031-INVESTOR-NOT-SURE",
        source: "packages/investor-onboarding/src/definition",
      },
    );
    const committed = readFileSync(MIGRATION, "utf8");
    expect(committed.endsWith(rendered)).toBe(true);
    expect(rendered).toContain("set current_version = 3");
    // Additive reference data only: every statement inserts or publishes.
    expect(committed).not.toMatch(
      /^\s*(drop|alter|grant|revoke|create|delete|truncate)\b/imu,
    );
  });
});

const USER = UserIdSchema.parse("b0000000-0000-4000-8000-000000000003");
const ORG = OrganisationIdSchema.parse("e0000000-0000-4000-8000-000000000003");
const INVESTOR = "f0000000-0000-4000-8000-0000000000cc";
const CONTEXT = ActorContextSchema.parse({
  userId: USER,
  tenantId: "c0000000-0000-4000-8000-000000000003",
  organisationId: ORG,
  membershipId: "d0000000-0000-4000-8000-000000000003",
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
        Promise.resolve({ deploymentState: current, version: 4 }),
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
    text: "Wadden Polder Ventures (fictional QA fund)",
  }),
  answer(INVESTOR_STEPS.investorType, {
    type: "SINGLE_SELECT",
    optionKey: "vc",
  }),
];

function context(chosen: OnboardingResponse): OnboardingWriteContext {
  const session = {
    id: "a1000000-0000-4000-8000-000000000003",
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
          "a0000000-0000-4000-8000-000000000003",
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

function deploymentTarget(services: InvestorDomainServices) {
  const found = createInvestorWriteTargets({
    services: () => services,
  } as never).find(
    (handler) => handler.targetKey === INVESTOR_WRITE_TARGETS.deploymentStatus,
  );
  if (found === undefined) throw new Error("no deployment target");
  return found;
}

const chose = (optionKey: string) =>
  answer(INVESTOR_STEPS.deploymentStatus, {
    type: "SINGLE_SELECT",
    optionKey,
  });

describe("'Not sure yet' on deploying", () => {
  it("leaves the firm's deployment state unknown, never a state", async () => {
    const { services, updates } = fakes("ACTIVELY_INVESTING");
    const chosen = chose(NOT_SURE_OPTION_KEY);
    await deploymentTarget(services).apply(context(chosen), chosen);
    expect(updates).toEqual([{ expectedVersion: 4, deploymentState: null }]);
  });

  it("writes nothing when the state is already unknown", async () => {
    const { services, updates } = fakes(null);
    const chosen = chose(NOT_SURE_OPTION_KEY);
    await deploymentTarget(services).apply(context(chosen), chosen);
    expect(updates).toEqual([]);
  });

  it("still writes a real state as before", async () => {
    const { services, updates } = fakes(null);
    const chosen = chose("paused");
    await deploymentTarget(services).apply(context(chosen), chosen);
    expect(updates).toEqual([
      { expectedVersion: 4, deploymentState: "PAUSED" },
    ]);
  });
});
