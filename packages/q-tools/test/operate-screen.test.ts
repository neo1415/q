import { describe, expect, it } from "vitest";

import {
  QClientActionIntentSchema,
  QUiActIntentSchema,
  type PermittedContextPlan,
} from "@capital-q/contracts";

import {
  Q_CAPABILITIES,
  Q_CONTROL_CATALOG,
  createClientActionTools,
  createOperateScreenTool,
  resolveControlTarget,
} from "../src/index.js";
import { actorA, contextFor, fakePorts, planFor } from "./support.js";

/**
 * RECOVERY-2026-10 (C2): operate_screen names a registered control by id
 * or short name; code resolves it, refuses an act its kind does not take,
 * never guesses between two matches, and hands the screen a UI act with
 * its own act id for the receipt.
 */

function ownPlan(actor = actorA): PermittedContextPlan {
  const plan = planFor(actor, "GENERAL_QUESTION", [
    { kind: "OWN_Q_CONVERSATION", sensitivity: "CONFIDENTIAL" },
  ]);
  return {
    ...plan,
    scopes: plan.scopes.map((scope) =>
      scope.kind === "OWN_Q_CONVERSATION"
        ? { ...scope, filter: { ...scope.filter, userId: actor.userId } }
        : scope,
    ),
  };
}

const tool = createOperateScreenTool();
const own = () => contextFor(actorA, ownPlan());

async function allowedAct(input: Record<string, unknown>) {
  const decision = await tool.authorize(input, own());
  if (decision.outcome !== "ALLOW") {
    throw new Error(`denied: ${decision.safeMessage}`);
  }
  const grant = decision.grant as { clientAction: unknown };
  // What the screen receives is the lead's frozen contract.
  expect(QClientActionIntentSchema.safeParse(grant.clientAction).success).toBe(
    true,
  );
  return QUiActIntentSchema.parse(grant.clientAction);
}

async function deniedWith(input: Record<string, unknown>): Promise<string> {
  const decision = await tool.authorize(input, own());
  if (decision.outcome !== "DENY") throw new Error("allowed");
  return decision.safeMessage;
}

describe("operate_screen (RECOVERY C2)", () => {
  it("takes an exact control id, with a fresh act id for its receipt", async () => {
    const first = await allowedAct({
      act: "SELECT_TAB",
      target: "tab.readiness",
    });
    const second = await allowedAct({
      act: "SELECT_TAB",
      target: "tab.readiness",
    });
    expect(first).toMatchObject({
      kind: "UI_ACT",
      act: "SELECT_TAB",
      target: "tab.readiness",
    });
    expect(first.actId).not.toBe(second.actId);
  });

  it("takes a short name when exactly one control has it", async () => {
    expect(
      await allowedAct({ act: "SCROLL_TO", target: "Mandate" }),
    ).toMatchObject({ target: "section.mandate" });
  });

  it("never guesses between two controls with the same name: it asks", async () => {
    // tab.readiness and section.readiness are both real controls.
    expect(Q_CONTROL_CATALOG.map((c) => c.id)).toEqual(
      expect.arrayContaining(["tab.readiness", "section.readiness"]),
    );
    expect(await deniedWith({ act: "SCROLL_TO", target: "readiness" })).toMatch(
      /More than one control matches "readiness": .*tab\.readiness.*Ask which one/u,
    );
  });

  it("prefers the controls on screen now, when the run carries them", async () => {
    const onScreen = createOperateScreenTool({
      screenControls: () => [{ id: "section.readiness", kind: "SECTION" }],
    });
    const decision = await onScreen.authorize(
      { act: "SCROLL_TO", target: "readiness" },
      own(),
    );
    expect(decision.outcome).toBe("ALLOW");
    expect(
      resolveControlTarget("readiness", [
        { id: "section.readiness", kind: "SECTION" },
      ]),
    ).toEqual({
      kind: "ONE",
      control: { id: "section.readiness", kind: "SECTION" },
    });
  });

  it("refuses an id nobody registered, naming the close ones", async () => {
    expect(
      await deniedWith({ act: "SELECT_TAB", target: "tab.nowhere" }),
    ).toMatch(/No control/u);
    expect(await deniedWith({ act: "SCROLL_TO", target: "risk" })).toMatch(
      /section\.risks|list\.risks/u,
    );
  });

  it("refuses an act the control's kind does not take, and missing arguments", async () => {
    expect(
      await deniedWith({ act: "SET", target: "section.risks", value: true }),
    ).toMatch(/section\.risks is a section/u);
    expect(
      await deniedWith({ act: "SELECT_ITEM", target: "list.investors" }),
    ).toMatch(/which item/u);
    expect(
      await allowedAct({
        act: "SELECT_ITEM",
        target: "list.investors",
        index: 2,
      }),
    ).toMatchObject({ index: 2 });
    expect(
      await allowedAct({
        act: "FILTER",
        target: "filter.relationships",
        value: "NEEDS_YOU",
      }),
    ).toMatchObject({ value: "NEEDS_YOU" });
  });

  it("page acts take no target; BACK is the page they were on", async () => {
    expect(await allowedAct({ act: "BACK" })).toEqual({
      kind: "UI_ACT",
      actId: expect.stringMatching(/^uia_/u),
      act: "BACK",
    });
    expect(
      await allowedAct({ act: "SCROLL_DOWN", target: "x" }),
    ).not.toHaveProperty("target");
  });

  it("is refused outside their own conversation", async () => {
    const decision = await tool.authorize(
      { act: "BACK" },
      contextFor(actorA, planFor(actorA, "GENERAL_QUESTION", [])),
    );
    expect(decision.outcome).toBe("DENY");
  });

  it("is composed with the client actions and named in the capability registry", () => {
    const names = createClientActionTools(fakePorts()).map(
      (one) => one.providerName,
    );
    expect(names).toContain("operate_screen");
    expect(Q_CAPABILITIES.map((c) => c.id)).toContain("tool.operate_screen");
  });
});
