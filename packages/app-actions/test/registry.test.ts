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
    const tools = APP_ACTIONS.flatMap((action) =>
      action.tool === undefined ? [] : [action.tool.name],
    );
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
      // An action is served to Q by a generated tool or, until its area's
      // second step, by the hand tool it names; never by neither.
      if (action.tool === undefined) {
        expect(action.legacyTool).toMatch(/^[a-z][a-z_]*$/);
      } else {
        expect(action.tool.eval.say).toHaveLength(2);
      }
    }
  });

  it("the slice, then profile and records: each action's Q tool and classification", () => {
    expect(
      APP_ACTIONS.map((action) => [
        action.name,
        action.tool?.name ?? `legacy:${action.legacyTool ?? ""}`,
        action.classification,
      ]),
    ).toEqual([
      ["pitch.details.set", "set_pitch_sharing", "CONSEQUENTIAL"],
      ["discovery.company.save", "save_company", "INSTANT"],
      ["discovery.company.unsave", "unsave_company", "INSTANT"],
      ["discovery.company.pass", "pass_company", "INSTANT"],
      ["discovery.company.unpass", "unpass_company", "INSTANT"],
      [
        "company.profile.update",
        "legacy:propose_profile_change",
        "CONSEQUENTIAL",
      ],
      ["company.team.me.upsert", "legacy:propose_team_change", "CONSEQUENTIAL"],
      [
        "company.founder_profile.me.update",
        "legacy:propose_team_change",
        "CONSEQUENTIAL",
      ],
      [
        "company.team_facts.update",
        "legacy:propose_team_change",
        "CONSEQUENTIAL",
      ],
      [
        "investor.profile.update",
        "legacy:propose_profile_change",
        "CONSEQUENTIAL",
      ],
      [
        "investor.representative.me.upsert",
        "legacy:propose_team_change",
        "CONSEQUENTIAL",
      ],
      ["q_card.handle.claim", "legacy:propose_handle_claim", "CONSEQUENTIAL"],
      ["q_card.update", "legacy:propose_q_card_change", "CONSEQUENTIAL"],
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
    // Actions still served by a hand tool have no generated eval case yet.
    expect(cases).toHaveLength(
      APP_ACTIONS.filter((action) => action.tool !== undefined).length * 3 + 2,
    );
    expect(
      cases.find((c) => c.id === "discovery.company.pass#misheard")?.say,
    ).toBe(`Pass on ${misheard("Kazikit")}.`);
    expect(misheard("Kazikit")).not.toBe("Kazikit");
  });
});
