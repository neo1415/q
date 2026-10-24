import { describe, expect, it } from "vitest";

import {
  OnboardingContextRequiredError,
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
  INVESTOR_STEPS,
  INVESTOR_WRITE_TARGETS,
} from "../src/definition/investor-v1.js";
import type { InvestorDomainServices } from "../src/integration/services.js";
import { createInvestorWriteTargets } from "../src/integration/write-targets.js";

/**
 * QA F-52 (live 23 Oct 2026): a new investor named the firm before saying
 * how they invest ("Haddad Desert Ventures … We write USD 100k-500k seed
 * cheques …"). Nothing was set up, and every answer came back "the firm
 * context isn't active yet". The name is kept; the firm is set up from
 * whichever answer first finds both its name and type; before that, an
 * answer that needs the firm is refused alone, to be held.
 */

const USER = UserIdSchema.parse("b0000000-0000-4000-8000-000000000001");
const ORG = OrganisationIdSchema.parse("e0000000-0000-4000-8000-000000000001");
const INVESTOR = "f0000000-0000-4000-8000-0000000000aa";
const CONTEXT = ActorContextSchema.parse({
  userId: USER,
  tenantId: "c0000000-0000-4000-8000-000000000001",
  organisationId: ORG,
  membershipId: "d0000000-0000-4000-8000-000000000001",
  actorType: "HUMAN",
});

function fakes() {
  const calls: string[] = [];
  const services = {
    resolver: {
      resolveHumanContext: () =>
        Promise.resolve({ status: "RESOLVED", context: CONTEXT }),
    },
    organisations: {
      createOrganisation: () => {
        calls.push("createOrganisation");
        return Promise.resolve({ organisation: { id: ORG } });
      },
    },
    investors: {
      getCurrentInvestorOrganisation: () =>
        Promise.reject(new InvestorOrganisationNotFoundError()),
      createInvestorOrganisation: () => {
        calls.push("createInvestorOrganisation");
        return Promise.resolve({ id: INVESTOR });
      },
      upsertMyInvestorRepresentative: () => Promise.resolve({}),
      getInvestorOrganisation: () =>
        Promise.resolve({ deploymentState: "ACTIVELY_INVESTING", version: 1 }),
      updateInvestorOrganisation: () => Promise.resolve({}),
    },
  } as unknown as InvestorDomainServices;
  return { services, calls };
}

const answer = (
  stepKey: string,
  value: OnboardingResponse["value"],
): OnboardingResponse => ({ stepKey, value }) as unknown as OnboardingResponse;

function context(
  current: readonly OnboardingResponse[],
  bound: string[],
  /** The person's own firm of this name, already set up (null: none). */
  ownFirm: string | null = null,
  /** Another firm of this name on Capital Q, visible to the network. */
  visibleFirm: string | null = null,
): OnboardingWriteContext {
  const session = {
    id: "a1000000-0000-4000-8000-000000000001",
    subject: null,
    organisationId: null,
    tenantId: null,
    version: 1,
  };
  return {
    // The only read: the person's own firm workspace of this name.
    tx: {
      sql: (parts: TemplateStringsArray) =>
        Promise.resolve(
          parts.join("?").includes("marketplace_visibility")
            ? visibleFirm === null
              ? []
              : [{ display_name: visibleFirm }]
            : ownFirm === null
              ? []
              : [{ organisation_id: ownFirm }],
        ),
    },
    actor: {
      userId: USER,
      context: null,
      principal: {
        authUserId: AuthUserIdSchema.parse(
          "a0000000-0000-4000-8000-000000000001",
        ),
      },
    },
    session,
    step: {},
    correlationId: "cor_test",
    currentResponses: new Map(current.map((r) => [r.stepKey, r])),
    bindContext: (binding: { subject: { subjectId: string } }) => {
      bound.push(binding.subject.subjectId);
      return Promise.resolve({
        ...session,
        subject: binding.subject,
        organisationId: ORG,
        tenantId: CONTEXT.tenantId,
      });
    },
  } as unknown as OnboardingWriteContext;
}

function target(key: string, services: InvestorDomainServices) {
  const found = createInvestorWriteTargets({
    services: () => services,
  } as never).find((handler) => handler.targetKey === key);
  if (found === undefined) throw new Error(`no target ${key}`);
  return found;
}

const NAME = answer(INVESTOR_STEPS.organisationName, {
  type: "TEXT",
  text: "Haddad Desert Ventures (fictional QA fund)",
} as never);
const TYPE = answer(INVESTOR_STEPS.investorType, {
  type: "SINGLE_SELECT",
  optionKey: "vc",
} as never);
const DEPLOYING = {
  stepKey: INVESTOR_STEPS.deploymentStatus,
  value: { type: "SINGLE_SELECT", optionKey: "actively_investing" },
} as never;

describe("the firm from the first answers that name it", () => {
  it("keeps the name when how they invest is not known yet", async () => {
    const { services, calls } = fakes();
    const bound: string[] = [];
    await target(INVESTOR_WRITE_TARGETS.bootstrap, services).apply(
      context([], bound),
      NAME,
    );
    expect(calls).toEqual([]);
    expect(bound).toEqual([]);
  });

  it("an answer that needs the firm, with no name yet, is refused alone", async () => {
    const { services } = fakes();
    await expect(
      target(INVESTOR_WRITE_TARGETS.deploymentStatus, services).apply(
        context([TYPE], []),
        DEPLOYING,
      ),
    ).rejects.toBeInstanceOf(OnboardingContextRequiredError);
  });

  it("the next answer sets the firm up once the name and type are both in", async () => {
    const { services, calls } = fakes();
    const bound: string[] = [];
    await target(INVESTOR_WRITE_TARGETS.deploymentStatus, services).apply(
      context([NAME, TYPE], bound),
      DEPLOYING,
    );
    expect(calls).toEqual(["createOrganisation", "createInvestorOrganisation"]);
    expect(bound).toEqual([INVESTOR]);
  });
});

describe("one firm per person and name", () => {
  it("a second session with the same firm name reuses their own firm, never a second one", async () => {
    const { services, calls } = fakes();
    const bound: string[] = [];
    await target(INVESTOR_WRITE_TARGETS.deploymentStatus, services).apply(
      context([NAME, TYPE], bound, ORG),
      DEPLOYING,
    );
    // Their organisation is reused; only its investor profile is looked up
    // (and here, as in a half-finished earlier session, created once).
    expect(calls).not.toContain("createOrganisation");
    expect(bound).toEqual([INVESTOR]);
  });
});

describe("one firm per real firm", () => {
  it("a firm already on Capital Q under that name is not set up again: they are told how to join", async () => {
    const { services, calls } = fakes();
    await expect(
      target(INVESTOR_WRITE_TARGETS.deploymentStatus, services).apply(
        context([NAME, TYPE], [], null, "Haddad Desert Ventures"),
        DEPLOYING,
      ),
    ).rejects.toMatchObject({
      issues: [expect.objectContaining({ code: "firm_already_on_capital_q" })],
    });
    expect(calls).not.toContain("createOrganisation");
  });
});
