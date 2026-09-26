import { describe, expect, it } from "vitest";

import {
  createProposeHandleClaimTool,
  createQToolExecutor,
  createQToolRegistry,
  type HandleClaimPort,
} from "../src/index.js";
import {
  COMPANY_A,
  COMPANY_B_NETWORK,
  RUN,
  actorA,
  contextFor,
  fakePorts,
  planFor,
} from "./support.js";

/**
 * `propose_handle_claim` (BIZ-004): the model names the handle; code
 * decides whose organisation it is. Only the actor's own company or
 * investor organisation bound in the plan; nothing is written here.
 */

type Prepared = Parameters<HandleClaimPort["prepareHandleClaim"]>[0];

function harness() {
  const prepared: Prepared[] = [];
  const port: HandleClaimPort = {
    prepareHandleClaim: (entry) => {
      prepared.push(entry);
      return Promise.resolve({
        status: "PREPARED",
        awaitingApprovalOf: "Set your public handle.",
        reason: null,
      });
    },
  };
  const executor = createQToolExecutor({
    registry: createQToolRegistry([
      createProposeHandleClaimTool(fakePorts(), port),
    ]),
  });
  return { executor, prepared };
}

const call = (args: Record<string, unknown>) => ({
  callId: "h1",
  name: "propose_handle_claim",
  arguments: args,
});

const bound = (companyId: string) =>
  planFor(actorA, "OWN_COMPANY_QUESTION", [
    { kind: "COMPANY_PROFILE", sensitivity: "CONFIDENTIAL", companyId },
  ]);

describe("propose_handle_claim", () => {
  it("prepares a handle for the actor's own company", async () => {
    const { executor, prepared } = harness();
    const outcome = await executor.execute(
      call({ profile: "COMPANY", handle: "alpha-robotics" }),
      contextFor(actorA, bound(COMPANY_A)),
    );
    expect(outcome.status).toBe("SUCCEEDED");
    expect(prepared).toEqual([
      {
        runId: RUN,
        tenantId: actorA.tenantId,
        actorUserId: actorA.userId,
        subjectType: "COMPANY",
        subjectId: COMPANY_A,
        handle: "alpha-robotics",
      },
    ]);
  });

  it("never prepares one for another organisation's company", async () => {
    const { executor, prepared } = harness();
    const outcome = await executor.execute(
      call({ profile: "COMPANY", handle: "hijack" }),
      contextFor(actorA, bound(COMPANY_B_NETWORK)),
    );
    expect(outcome.status).toBe("DENIED");
    expect(prepared).toEqual([]);
  });
});
