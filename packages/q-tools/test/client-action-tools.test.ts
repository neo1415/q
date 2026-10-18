import { describe, expect, it } from "vitest";

import {
  QClientActionToolResultSchema,
  type PermittedContextPlan,
} from "@capital-q/contracts";
import type { CompanyProfileFacts } from "@capital-q/companies";

import {
  createClientActionTools,
  createGetQCardTool,
  createQToolExecutor,
  createQToolRegistry,
  OpenWebsiteInputSchema,
  SetThemeInputSchema,
  type QCardReadPort,
} from "../src/index.js";
import {
  COMPANY_A,
  COMPANY_B_NETWORK,
  PROFILES,
  actorA,
  actorB,
  contextFor,
  fakeCompanies,
  fakePorts,
  planFor,
} from "./support.js";

/**
 * Client actions and the Q Card read (R20/R33; founder live test
 * 2026-09-27 #4). The model names the tool and its arguments; each tool's
 * own schema and authorize step decide, and the result is the intent the
 * answer carries to the screen.
 */

const OWN_SITE = "https://alpha-robotics.example/";

function companiesWithSite() {
  const base = fakeCompanies();
  return {
    ...base,
    findCanonicalCompanyProfile: async (
      id: Parameters<typeof base.findCanonicalCompanyProfile>[0],
    ) => {
      const found = await base.findCanonicalCompanyProfile(id);
      return found !== null && found.id === (COMPANY_A as string)
        ? ({ ...found, websiteUrl: OWN_SITE } satisfies CompanyProfileFacts)
        : found;
    },
  };
}

/** A plan holding the actor's own conversation, plus any company scopes. */
function ownPlan(
  actor = actorA,
  companyIds: readonly string[] = [],
): PermittedContextPlan {
  const plan = planFor(actor, "GENERAL_QUESTION", [
    { kind: "OWN_Q_CONVERSATION", sensitivity: "CONFIDENTIAL" },
    ...companyIds.map((companyId) => ({
      kind: "COMPANY_PROFILE" as const,
      sensitivity: "CONFIDENTIAL" as const,
      companyId,
    })),
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

function executor() {
  const ports = fakePorts({ companies: companiesWithSite() });
  return createQToolExecutor({
    registry: createQToolRegistry(createClientActionTools(ports)),
  });
}

const call = (name: string, args: Record<string, unknown>) => ({
  callId: `c-${name}`,
  name,
  arguments: args,
});

function intentOf(outcome: { result: { ok: boolean; data?: unknown } }) {
  expect(outcome.result.ok).toBe(true);
  return QClientActionToolResultSchema.parse(outcome.result.data).clientAction;
}

describe("client action schemas", () => {
  it("set_theme takes only light, dark or system", () => {
    expect(SetThemeInputSchema.safeParse({ theme: "dark" }).success).toBe(true);
    expect(SetThemeInputSchema.safeParse({ theme: "blue" }).success).toBe(
      false,
    );
  });

  it("open_website takes only an absolute http(s) URL without credentials", () => {
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,hi",
      "/profile",
      "ftp://alpha.example",
      "https://user:pw@alpha.example",
    ]) {
      expect(OpenWebsiteInputSchema.safeParse({ url }).success, url).toBe(
        false,
      );
    }
    expect(OpenWebsiteInputSchema.safeParse({ url: OWN_SITE }).success).toBe(
      true,
    );
  });
});

describe("client action tools", () => {
  it("set_theme is allowed in the person's own conversation and carries the intent", async () => {
    const outcome = await executor().execute(
      call("set_theme", { theme: "dark" }),
      contextFor(actorA, ownPlan()),
    );
    expect(outcome.status).toBe("SUCCEEDED");
    expect(intentOf(outcome)).toEqual({ kind: "SET_THEME", theme: "dark" });
  });

  it("set_discover_filters carries the filters, normalised (ux/discover-filters)", async () => {
    const outcome = await executor().execute(
      call("set_discover_filters", {
        sectors: ["fintech", "fintech"],
        countries: ["ng"],
        raiseMax: "2000000",
        raiseCurrency: "USD",
        hasPitch: true,
      }),
      contextFor(actorA, ownPlan()),
    );
    expect(outcome.status).toBe("SUCCEEDED");
    expect(intentOf(outcome)).toEqual({
      kind: "SET_DISCOVER_FILTERS",
      sectorCodes: ["fintech"],
      stageCodes: [],
      countryCodes: ["NG"],
      raise: { max: "2000000", currency: "USD" },
      raiseDisclosedOnly: false,
      verifiedOnly: false,
      hasPitch: true,
    });
  });

  it("set_discover_filters with nothing set clears; a raise bound without a currency is refused", async () => {
    const cleared = await executor().execute(
      call("set_discover_filters", {}),
      contextFor(actorA, ownPlan()),
    );
    expect(intentOf(cleared)).toMatchObject({
      kind: "SET_DISCOVER_FILTERS",
      sectorCodes: [],
      raise: null,
    });
    const refused = await executor().execute(
      call("set_discover_filters", { raiseMin: "100000" }),
      contextFor(actorA, ownPlan()),
    );
    expect(refused.status).not.toBe("SUCCEEDED");
  });

  it("reload_page carries a reload", async () => {
    const outcome = await executor().execute(
      call("reload_page", {}),
      contextFor(actorA, ownPlan()),
    );
    expect(intentOf(outcome)).toEqual({ kind: "RELOAD_PAGE" });
  });

  it("is denied without the actor's own conversation scope", async () => {
    const plan = ownPlan(actorA);
    const outcome = await executor().execute(
      call("set_theme", { theme: "light" }),
      // Somebody else's plan: the own-conversation filter names another user.
      contextFor(actorA, {
        ...plan,
        scopes: plan.scopes.map((scope) =>
          scope.kind === "OWN_Q_CONVERSATION"
            ? { ...scope, filter: { ...scope.filter, userId: actorB.userId } }
            : scope,
        ),
      }),
    );
    expect(outcome.status).not.toBe("SUCCEEDED");
  });

  it("open_website opens the website on their own company record", async () => {
    const outcome = await executor().execute(
      call("open_website", { url: "https://www.alpha-robotics.example" }),
      contextFor(actorA, ownPlan(actorA, [COMPANY_A])),
    );
    expect(intentOf(outcome)).toEqual({
      kind: "OPEN_WEBSITE",
      url: "https://www.alpha-robotics.example/",
    });
  });

  it("open_website opens an address they gave in their own words", async () => {
    const outcome = await executor().execute(
      call("open_website", { url: "https://zino-aviation.example/about" }),
      {
        ...contextFor(actorA, ownPlan()),
        conversation: {
          latestUserText: "Open my site, zino-aviation.example, in a new tab",
        },
      },
    );
    expect(intentOf(outcome)).toEqual({
      kind: "OPEN_WEBSITE",
      url: "https://zino-aviation.example/about",
    });
  });

  it("open_website refuses a site that is neither theirs nor in their words", async () => {
    const outcome = await executor().execute(
      call("open_website", { url: "https://evil.example" }),
      {
        ...contextFor(actorA, ownPlan(actorA, [COMPANY_A])),
        conversation: { latestUserText: "open my website" },
      },
    );
    expect(outcome.status).toBe("DENIED");
  });

  it("open_website never takes another organisation's company website", async () => {
    const outcome = await executor().execute(
      call("open_website", { url: "https://beacon.example" }),
      contextFor(actorA, ownPlan(actorA, [COMPANY_B_NETWORK])),
    );
    expect(outcome.status).toBe("DENIED");
  });
});

describe("get_q_card", () => {
  function cardExecutor(card: Awaited<ReturnType<QCardReadPort["getCard"]>>) {
    const asked: Parameters<QCardReadPort["getCard"]>[1][] = [];
    const port: QCardReadPort = {
      getCard: (_actor, subject) => {
        asked.push(subject);
        return Promise.resolve(card);
      },
    };
    const run = createQToolExecutor({
      registry: createQToolRegistry([createGetQCardTool(fakePorts(), port)]),
    });
    return { run, asked };
  }
  const plan = (companyId: string) =>
    planFor(actorA, "OWN_COMPANY_QUESTION", [
      { kind: "COMPANY_PROFILE", sensitivity: "CONFIDENTIAL", companyId },
    ]);

  it("reads the actor's own company card as SAVED", async () => {
    const { run, asked } = cardExecutor({
      handle: "alpha-robotics",
      indexable: false,
      updatedAt: "2026-09-27T10:00:00.000Z",
    });
    const outcome = await run.execute(
      call("get_q_card", { subject: "COMPANY" }),
      contextFor(actorA, plan(COMPANY_A)),
    );
    expect(outcome.result.ok).toBe(true);
    expect(outcome.result.ok ? outcome.result.data : null).toMatchObject({
      status: "SAVED",
      handle: "alpha-robotics",
      publicPath: "/u/alpha-robotics",
    });
    expect(asked).toEqual([
      { subjectType: "COMPANY", subjectId: PROFILES[0]?.id },
    ]);
  });

  it("says NOT_MADE when there is no card", async () => {
    const { run } = cardExecutor(null);
    const outcome = await run.execute(
      call("get_q_card", { subject: "COMPANY" }),
      contextFor(actorA, plan(COMPANY_A)),
    );
    expect(outcome.result.ok ? outcome.result.data : null).toMatchObject({
      status: "NOT_MADE",
    });
  });

  it("never reads another organisation's card", async () => {
    const { run, asked } = cardExecutor(null);
    const outcome = await run.execute(
      call("get_q_card", { subject: "COMPANY" }),
      contextFor(actorA, plan(COMPANY_B_NETWORK)),
    );
    expect(outcome.status).toBe("DENIED");
    expect(asked).toEqual([]);
  });
});
