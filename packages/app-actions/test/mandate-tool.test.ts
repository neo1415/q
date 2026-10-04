import { describe, expect, it } from "vitest";

import { CorrelationIdSchema } from "@capital-q/contracts";
import { ActorContextSchema } from "@capital-q/security";

import { APP_ACTIONS, type AppActionPorts } from "../src/index.js";

/**
 * follow-55 (Zino live 2026-10-04, run c8b23349): "I want to edit my
 * profile to make sure that I invest in pre-seed to Series A. Can you save
 * that for me?" was refused as REQUIRED_INPUT_NOT_SAID: change_my_mandate
 * required an `operation` nobody says, and its stage inputs named no
 * codes. A change to fields is an UPDATE; stages are the taxonomy's codes.
 */

const actor = ActorContextSchema.parse({
  userId: "b0000000-0000-4000-8000-000000000001",
  tenantId: "c0000000-0000-4000-8000-000000000001",
  organisationId: "d0000000-0000-4000-8000-000000000001",
  membershipId: "e0000000-0000-4000-8000-000000000001",
  actorType: "HUMAN",
});
const context = {
  actor,
  idempotencyKey: "q:1",
  correlationId: CorrelationIdSchema.parse(
    "cor_00000000-0000-4000-8000-000000000001",
  ),
  surface: "Q" as const,
};
const ORG = "f0000000-0000-4000-8000-000000000001";
const MANDATE = "a1000000-0000-4000-8000-000000000001";

const family = APP_ACTIONS.find(
  (candidate) => candidate.tool?.name === "change_my_mandate",
);

const ports = {
  ownInvestorOrganisationId: () => Promise.resolve(ORG),
  investors: {
    listInvestorMandates: () =>
      Promise.resolve({
        items: [{ id: MANDATE, status: "ACTIVE", version: 22 }],
      }),
  },
} as unknown as AppActionPorts;

describe("change_my_mandate from their words (follow-55)", () => {
  it("takes a stage change with no operation said, as an UPDATE of the current mandate", async () => {
    const tool = family?.tool;
    expect(tool).toBeDefined();
    if (tool === undefined) return;
    const said = tool.input.safeParse({
      minStageCode: "pre_seed",
      maxStageCode: "series_a",
    });
    expect(said.success).toBe(true);
    if (!said.success) return;
    const canonical = await tool.toCanonical(said.data, context, ports);
    expect(canonical).toMatchObject({
      operation: "UPDATE",
      input: {
        investorOrganisationId: ORG,
        mandateId: MANDATE,
        input: {
          minStageCode: "pre_seed",
          maxStageCode: "series_a",
          expectedVersion: 22,
        },
        atLatest: true,
      },
    });
  });

  it("names the stage codes, and refuses words where a code belongs", () => {
    const tool = family?.tool;
    if (tool === undefined) throw new Error("change_my_mandate missing");
    const shape = (
      tool.input as unknown as {
        shape: Record<string, { description?: string }>;
      }
    ).shape;
    expect(shape["minStageCode"]?.description).toContain(
      "pre_seed, seed, series_a",
    );
    expect(shape["operation"]?.description).toContain("the default");
    expect(
      tool.input.safeParse({
        minStageCode: "Pre-seed",
        maxStageCode: "Series A",
      }).success,
    ).toBe(false);
    expect(tool.description).toContain("maxStageCode");
  });
});
