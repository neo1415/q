import { describe, expect, it } from "vitest";

import {
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
} from "@capital-q/security";

import {
  matchCounterpart,
  nameableRecords,
} from "../src/tools/client-actions.js";

/**
 * RECOVERY-2026-10 (C, live GPT-Live 2026-10-09): the transcript wrote
 * "Tensor Gate" for Tensorgate. The network search is a text search, so
 * the run-together form is searched as well, and the match ignores
 * spacing: the spoken name finds the one record.
 */
const ACTOR: ActorContext = {
  userId: UserIdSchema.parse("b0000000-0000-4000-8000-000000000001"),
  tenantId: TenantIdSchema.parse("c0000000-0000-4000-8000-000000000001"),
  organisationId: OrganisationIdSchema.parse(
    "d0000000-0000-4000-8000-000000000001",
  ),
  membershipId: MembershipIdSchema.parse(
    "e0000000-0000-4000-8000-000000000001",
  ),
  actorType: "HUMAN",
};
const TENSORGATE = "7a1f7e2a-0c1d-4b5e-9a7f-2b3c4d5e6f70";

describe("a spoken name with other spacing (live 2026-10-09)", () => {
  it("'Tensor Gate' finds Tensorgate in the network", async () => {
    const searched: (string | undefined)[] = [];
    const ports = {
      companies: {
        searchCompanies: (query: { text?: string | undefined }) => {
          searched.push(query.text);
          // A text search: "tensor gate" does not find "Tensorgate".
          const hit = query.text?.toLowerCase() === "tensorgate";
          return Promise.resolve({
            items: hit ? [{ id: TENSORGATE, canonicalName: "Tensorgate" }] : [],
            nextCursor: null,
          });
        },
      },
      disclosure: {
        evaluateMany: (requests: readonly unknown[]) =>
          Promise.resolve(
            requests.map(() => ({
              outcome: "ALLOW",
              reasonCode: "NETWORK_VISIBLE",
            })),
          ),
      },
    } as unknown as Parameters<typeof nameableRecords>[0];
    const found = await nameableRecords(ports, ACTOR, "COMPANY", "Tensor Gate");
    expect(searched).toEqual(["Tensor Gate", "TensorGate"]);
    expect(matchCounterpart("Tensor Gate", found)).toBe(TENSORGATE);
  });
});
