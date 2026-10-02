import { describe, expect, it } from "vitest";

import { ActorContextSchema } from "@capital-q/security";

import {
  APP_ACTIONS,
  misheard,
  parityCases,
  resolveReference,
  type ReferenceCandidates,
} from "../src/index.js";

/**
 * ADR 0040: the registry itself. Every entry is complete (a tool, a card,
 * a route or a reason it has none), names are coerced by one rule, and
 * the parity eval's cases come from the registry, not from a hand list.
 */

const actor = ActorContextSchema.parse({
  userId: "b0000000-0000-4000-8000-000000000001",
  tenantId: "c0000000-0000-4000-8000-000000000001",
  organisationId: "d0000000-0000-4000-8000-000000000001",
  membershipId: "e0000000-0000-4000-8000-000000000001",
  actorType: "HUMAN",
});

describe("the action registry", () => {
  it("names each action once, each tool once, each route once", () => {
    const names = APP_ACTIONS.map((action) => action.name);
    const tools = APP_ACTIONS.map((action) => action.tool.name);
    const routes = APP_ACTIONS.flatMap((action) =>
      action.http === undefined
        ? []
        : [`${action.http.method} ${action.http.path}`],
    );
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(tools).size).toBe(tools.length);
    expect(new Set(routes).size).toBe(routes.length);
    for (const action of APP_ACTIONS) {
      expect(action.name).toMatch(/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/);
      expect(action.tool.eval.say).toHaveLength(2);
    }
  });

  it("the slice: a pitch's audience (approval) and the feed's four decisions (instant)", () => {
    expect(
      APP_ACTIONS.map((action) => [action.tool.name, action.classification]),
    ).toEqual([
      ["set_pitch_sharing", "CONSEQUENTIAL"],
      ["save_company", "INSTANT"],
      ["unsave_company", "INSTANT"],
      ["pass_company", "INSTANT"],
      ["unpass_company", "INSTANT"],
    ]);
  });
});

describe("one coercion for every name", () => {
  const candidates: ReferenceCandidates = (kind) =>
    Promise.resolve(
      kind === "COMPANY"
        ? [
            { id: "c1", name: "Nixo" },
            { id: "c2", name: "Kazikit" },
            { id: "c3", name: "Kazikit Capital" },
          ]
        : kind === "MEDIA"
          ? [{ id: "m1", name: "Nixo pitch" }]
          : [],
    );

  it("takes one clear match, misheard included; asks about several; finds nothing for none", async () => {
    expect(
      await resolveReference(candidates, "COMPANY", actor, "Nixon"),
    ).toEqual({
      kind: "RESOLVED",
      id: "c1",
    });
    expect(
      (await resolveReference(candidates, "COMPANY", actor, "Kazi")).kind,
    ).toBe("SEVERAL");
    expect(
      await resolveReference(candidates, "COMPANY", actor, "Zorblax"),
    ).toEqual({
      kind: "NONE",
    });
  });

  it("'my pitch video' is the one pitch they have", async () => {
    expect(
      await resolveReference(candidates, "MEDIA", actor, "my pitch video"),
    ).toEqual({ kind: "RESOLVED", id: "m1" });
  });
});

describe("the parity eval's cases come from the registry", () => {
  it("two phrasings and a misheard name per action, two questions per read", () => {
    const cases = parityCases(
      APP_ACTIONS,
      { COMPANY: "Kazikit", MEDIA: "Nixo pitch" },
      { media: "Nixo pitch" },
    );
    expect(cases).toHaveLength(APP_ACTIONS.length * 3 + 2);
    expect(
      cases.find((c) => c.id === "discovery.company.pass#misheard")?.say,
    ).toBe(`Pass on ${misheard("Kazikit")}.`);
    expect(misheard("Kazikit")).not.toBe("Kazikit");
  });
});
