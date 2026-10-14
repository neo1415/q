import { describe, expect, it } from "vitest";
import {
  createAppActionTools,
  createQToolExecutor,
  createQToolRegistry,
} from "../src/index.js";
import {
  AppToolOutputSchema,
  ReadMyOutputSchema,
} from "../src/tools/app-actions.js";
import { actorA, actorB, contextFor, fakePorts, planFor } from "./support.js";
import {
  APPLICATION,
  OTHER_APPLICATION,
  GATEWAY,
  detailFixture,
} from "./support/gateq-dossier.js";

function harness(detail = detailFixture()) {
  const calls: { gatewayId: string; applicationId: string; userId: string }[] =
    [];
  let lists = 0;
  const appActions = {
    gateqInbox: {
      ownGatewayId: async (actor: typeof actorA) =>
        actor.userId === actorA.userId && actor.tenantId === actorA.tenantId
          ? GATEWAY
          : null,
      detail: async (
        actor: typeof actorA,
        gatewayId: string,
        applicationId: string,
      ) => {
        calls.push({ gatewayId, applicationId, userId: actor.userId });
        return actor.userId === actorA.userId &&
          gatewayId === GATEWAY &&
          applicationId === detail.item.applicationId
          ? detail
          : { ok: false as const };
      },
      list: async () => {
        lists++;
        return { items: [detail.item, detailFixture(OTHER_APPLICATION).item] };
      },
      findApplication: async () => ({
        applicationId: detail.item.applicationId,
      }),
    },
  };
  const port = createQToolExecutor({
    registry: createQToolRegistry(
      createAppActionTools({ ...fakePorts(), appActions } as never),
    ),
  });
  async function execute(
    name: string,
    arguments_: Record<string, unknown>,
    actor = actorA,
  ) {
    const initial = planFor(actor, "RELATIONSHIP_QUESTION", [
      { kind: "OWN_Q_CONVERSATION", sensitivity: "CONFIDENTIAL" },
    ]);
    const plan = {
      ...initial,
      scopes: initial.scopes.map((scope) => ({
        ...scope,
        filter: { ...scope.filter, userId: actor.userId },
      })),
    };
    return port.execute(
      { callId: "selected", name, arguments: arguments_ },
      contextFor(actor, plan),
    );
  }
  return { execute, calls, lists: () => lists };
}

describe("exact submitted GateQ reading through existing Q tools", () => {
  it("reads only the selected frozen dossier with lineage, qualification and claim labels", async () => {
    const h = harness();
    const out = await h.execute("read_my", {
      kind: "gateq",
      applicationId: APPLICATION,
    });
    expect(out.status).toBe("SUCCEEDED");
    if (!out.result.ok) throw new Error("Read refused");
    const data = ReadMyOutputSchema.parse(out.result.data);
    expect(data.items).toHaveLength(1);
    expect(h.calls).toEqual([
      { gatewayId: GATEWAY, applicationId: APPLICATION, userId: actorA.userId },
    ]);
    expect(h.lists()).toBe(0);
    const source = data.items[0]?.sourceReading;
    expect(source).toMatchObject({
      applicationId: APPLICATION,
      gatewayId: GATEWAY,
      dossierSchemaVersion: "gateq-dossier.v1",
      submittedAt: detailFixture().item.submittedAt,
    });
    expect(source?.statement).toContain("500 paying customers");
    expect(source?.statement).toContain("sourceTurnSeq=7");
    expect(source?.statement).toContain(
      "sourceFactId=20000000-0000-4000-8000-000000000001",
    );
    expect(source?.statement).toContain("evidence=SELF_REPORTED");
    expect(source?.statement).toContain("Seed stage: MEETS");
    expect(source?.statement).toContain("Unknown: Gross margin");
  });

  it("keeps inbox listing lightweight without fetching every dossier", async () => {
    const h = harness();
    const out = await h.execute("read_my", { kind: "gateq" });
    expect(out.status).toBe("SUCCEEDED");
    expect(h.calls).toHaveLength(0);
    expect(h.lists()).toBe(1);
    expect(JSON.stringify(out.result)).not.toContain("sourceReading");
  });

  it("separates the short receipt from long bounded typed findings", async () => {
    const detail = detailFixture(APPLICATION, true);
    const h = harness(detail);
    const out = await h.execute("gateq_inbox_summarise", {
      applicationId: APPLICATION,
    });
    expect(out.status).toBe("SUCCEEDED");
    if (!out.result.ok) throw new Error("Summary refused");
    const data = AppToolOutputSchema.parse(out.result.data);
    expect(data.status).toBe("DONE");
    expect(data.says.length).toBeLessThanOrEqual(600);
    expect(data.sourceReading?.statement.length).toBeGreaterThan(600);
    expect(data.sourceReading?.statement.length).toBeLessThanOrEqual(7000);
    expect(data.sourceReading?.omittedLines).toBeGreaterThan(0);
    expect(data.sourceReading?.statement).toContain(
      "consult the frozen dossier",
    );
    expect(
      AppToolOutputSchema.safeParse({
        status: "DONE",
        says: data.sourceReading?.statement,
      }).success,
    ).toBe(false);
    expect(detail.dossier?.dimensions[0]?.facts).toHaveLength(20);
  });

  it.each([
    "foreign-application",
    "foreign-actor",
    "draft",
    "stale-reference",
    "stale-submission",
    "wrong-application",
  ])("refuses %s instead of substituting inbox metadata", async (mode) => {
    const detail = detailFixture();
    if (mode === "draft") detail.dossier = null;
    if (mode === "stale-reference" && detail.dossier)
      detail.dossier.application.reference = "stale";
    if (mode === "stale-submission" && detail.dossier)
      detail.dossier.application.submittedAt = "2025-01-01T00:00:00.000Z";
    if (mode === "wrong-application")
      detail.item.applicationId = OTHER_APPLICATION;
    const h = harness(detail);
    const out = await h.execute(
      "read_my",
      {
        kind: "gateq",
        applicationId:
          mode === "foreign-application" ? OTHER_APPLICATION : APPLICATION,
      },
      mode === "foreign-actor" ? actorB : actorA,
    );
    expect(out.status).toBe("SUCCEEDED");
    if (!out.result.ok) throw new Error("Read tool failed");
    expect(ReadMyOutputSchema.parse(out.result.data).items).toEqual([]);
    expect(h.lists()).toBe(0);
  });

  it("does not accept application selection on another read kind", async () => {
    const out = await harness().execute("read_my", {
      kind: "documents",
      applicationId: APPLICATION,
    });
    expect(out.failureCode).toBe("INVALID_ARGUMENTS");
  });
});
