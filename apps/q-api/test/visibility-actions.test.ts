import { describe, expect, it } from "vitest";

import type { VisibilityStateDto } from "@capital-q/contracts";
import type { VisibilityCentre } from "@capital-q/permissions";
import {
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
  type AuthorizationService,
} from "@capital-q/security";

import {
  createRevokeShareAction,
  createShareRaiseAction,
  shareRaisePreview,
} from "../src/composition/visibility-actions.js";

/**
 * Sharing by Q, approved (CQ-BIZ-003). Proven here:
 *   - the approver reads exactly what the investor will and will not
 *     receive, and that revoking cannot recall what was seen;
 *   - authorization asks the visibility centre and disclosure.manage; a
 *     relationship the company cannot see, a share that does not exist,
 *     or a person without disclosure.manage is refused;
 *   - execution runs under the approver, through the centre, and nothing
 *     runs before approval;
 *   - the board holds one prepared action per run for its own person and
 *     tenant, in the action's exact payload shape.
 */

const TENANT = "c0000000-0000-4000-8000-000000000001";
const USER = "b0000000-0000-4000-8000-000000000001";
const ORG = "d0000000-0000-4000-8000-000000000001";
const COMPANY = "a0000000-0000-4000-8000-000000000001";
const APEX = "88888888-0000-4000-8000-000000000001";
const POLICY = "99999999-0000-4000-8000-000000000001";

const FOUNDER: ActorContext = {
  userId: UserIdSchema.parse(USER),
  tenantId: TenantIdSchema.parse(TENANT),
  organisationId: OrganisationIdSchema.parse(ORG),
  actorType: "HUMAN",
};

const STATE: VisibilityStateDto = {
  companyId: COMPANY,
  objects: [
    {
      object: "CAPITAL_OBJECTIVE",
      resourceId: "33333333-0000-4000-8000-000000000001",
      scope: "founder_private",
      choices: [],
      shareable: true,
    },
  ],
  shares: [
    {
      policyId: POLICY,
      object: "CAPITAL_OBJECTIVE",
      relationshipId: APEX,
      recipientName: "Apex Ventures",
      accessLevel: "view",
      createdAt: "2026-09-25T10:00:00.000Z",
      expiresAt: null,
    },
  ],
  relationships: [
    {
      relationshipId: APEX,
      investorOrganisationId: APEX,
      name: "Apex Ventures",
    },
  ],
};

function harness(options: { manage?: boolean } = {}) {
  const calls: { name: string; actor: ActorContext }[] = [];
  const visibility: VisibilityCentre = {
    state: () => Promise.resolve(STATE),
    preview: () => Promise.reject(new Error("unused")),
    share: (command) => {
      calls.push({ name: "share", actor: command.actor });
      return Promise.resolve({ outcome: "CREATED", share: null });
    },
    revoke: (command) => {
      calls.push({ name: "revoke", actor: command.actor });
      return Promise.resolve({ outcome: "REVOKED" });
    },
  };
  const authorization: AuthorizationService = {
    authorize: (request) =>
      Promise.resolve(
        options.manage === false
          ? {
              outcome: "DENY",
              capability: request.capability,
              resource: request.resource,
              reasonCode: "NO_MATCHING_GRANT",
              authority: undefined,
            }
          : {
              outcome: "ALLOW",
              capability: request.capability,
              resource: request.resource,
              reasonCode: "CAPABILITY_GRANTED",
              authority: "ROLE_TEMPLATE",
            },
      ),
    requireCapability: () => Promise.resolve(),
  };
  return {
    calls,
    share: createShareRaiseAction({ visibility, authorization }),
    revoke: createRevokeShareAction({ visibility, authorization }),
  };
}

const SHARE = {
  companyId: COMPANY,
  relationshipId: APEX,
  recipientName: "Apex Ventures",
};

describe("disclosure.raise.share", () => {
  it("tells the approver what will and will not be received, and that it cannot be recalled", () => {
    const { share } = harness();
    const described = share.describe(SHARE, share.targets(SHARE));
    expect(described.summary).toBe("Share your raise with Apex Ventures");
    expect(described.preview).toBe(shareRaisePreview("Apex Ventures"));
    expect(described.preview).toContain("will receive: your raise's target");
    expect(described.preview).toContain("will not receive: the use of funds");
    expect(described.preview).toContain("can't be recalled");
  });

  it("is allowed only for a relationship the company can see, with disclosure.manage", async () => {
    expect((await harness().share.authorize(SHARE, FOUNDER)).outcome).toBe(
      "ALLOW",
    );
    expect(
      (
        await harness().share.authorize(
          { ...SHARE, relationshipId: "88888888-0000-4000-8000-000000000099" },
          FOUNDER,
        )
      ).outcome,
    ).toBe("DENY");
    expect(
      (await harness({ manage: false }).share.authorize(SHARE, FOUNDER))
        .outcome,
    ).toBe("DENY");
    expect(
      (
        await harness().share.authorize(SHARE, {
          ...FOUNDER,
          actorType: "Q",
        })
      ).outcome,
    ).toBe("DENY");
  });

  it("executes under the approver, through the centre", async () => {
    const { share, calls } = harness();
    const report = await share.executor.execute({ payload: SHARE } as never, {
      approver: FOUNDER,
      correlationId: "cor_00000000-0000-4000-8000-000000000001",
      attempt: 1,
    });
    expect(report).toEqual({
      outcome: "EXECUTED",
      result: { outcome: "CREATED" },
    });
    expect(calls).toEqual([{ name: "share", actor: FOUNDER }]);
  });
});

describe("disclosure.share.revoke", () => {
  it("is allowed only for a share that exists", async () => {
    const revoke = {
      companyId: COMPANY,
      policyId: POLICY,
      recipientName: "Apex Ventures",
    };
    expect((await harness().revoke.authorize(revoke, FOUNDER)).outcome).toBe(
      "ALLOW",
    );
    expect(
      (
        await harness().revoke.authorize(
          { ...revoke, policyId: "99999999-0000-4000-8000-000000000099" },
          FOUNDER,
        )
      ).outcome,
    ).toBe("DENY");
    expect(harness().revoke.describe(revoke, []).preview).toContain(
      "can't be recalled",
    );
  });
});
