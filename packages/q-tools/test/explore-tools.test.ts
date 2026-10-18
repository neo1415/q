import { describe, expect, it } from "vitest";

import type { ActorContext } from "@capital-q/security";

import {
  ExplorePitchesLikeOutputSchema,
  SearchNetworkOutputSchema,
  createDefaultQTools,
  createQToolExecutor,
  createQToolRegistry,
  type ExploreToolPitch,
  type ExploreToolPort,
} from "../src/index.js";
import {
  actorA,
  actorB,
  COMPANY_B_NETWORK,
  contextFor,
  fakePorts,
  planFor,
} from "./support.js";

/**
 * Explore for Q (ADR 0055): "explore pitches like X" and "search the
 * network" answer from the Explore read for the asking actor only, behind
 * the network-visible scope, with typed results that open profiles.
 */

const PITCH = "f0000000-0000-4000-8000-000000000011";
const pitch = (over: Partial<ExploreToolPitch> = {}): ExploreToolPitch => ({
  companyId: COMPANY_B_NETWORK,
  companyName: "Kora Health",
  pitchId: PITCH,
  title: "Clinics paid in weeks",
  stageCode: "seed",
  headquartersCountry: "NG",
  reason: null,
  related: [],
  profileHref: `/company/${COMPANY_B_NETWORK}`,
  ...over,
});

function fakeExplore(visibleTo: (actor: ActorContext) => boolean) {
  const asked: string[] = [];
  const port: ExploreToolPort = {
    pitchesLike: (actor, query) => {
      asked.push(actor.userId);
      if (!visibleTo(actor)) return Promise.resolve(null);
      expect(query.companyName ?? query.companyId).toBeTruthy();
      return Promise.resolve({
        anchor: pitch(),
        items: [
          pitch({
            companyId: "c0000000-0000-4000-8000-0000000000aa",
            companyName: "Lumen Labs",
            pitchId: "f0000000-0000-4000-8000-0000000000aa",
            related: ["SAME_SECTOR", "SAME_STAGE"],
            profileHref: "/company/c0000000-0000-4000-8000-0000000000aa",
          }),
        ],
      });
    },
    searchNetwork: (actor, query) => {
      asked.push(actor.userId);
      return Promise.resolve(
        visibleTo(actor) && query.text.includes("health")
          ? {
              companies: [
                {
                  companyId: COMPANY_B_NETWORK,
                  companyName: "Kora Health",
                  shortDescription: null,
                  stageCode: "seed",
                  headquartersCountry: "NG",
                  profileHref: `/company/${COMPANY_B_NETWORK}`,
                },
              ],
              pitches: [pitch({ reason: "ON_THE_NETWORK" })],
            }
          : { companies: [], pitches: [] },
      );
    },
  };
  return { port, asked };
}

const network = (actor: ActorContext) =>
  planFor(actor, "GENERAL_QUESTION", [
    { kind: "NETWORK_VISIBLE_DATA", sensitivity: "NETWORK_VISIBLE" },
  ]);

function executor(port: ExploreToolPort) {
  return createQToolExecutor({
    registry: createQToolRegistry(
      createDefaultQTools(fakePorts({ explore: port })),
    ),
  });
}

describe("explore_pitches_like", () => {
  it("returns typed pitches like the company, each opening its profile", async () => {
    const { port } = fakeExplore(() => true);
    const outcome = await executor(port).execute(
      {
        callId: "e1",
        name: "explore_pitches_like",
        arguments: { companyName: "Kora Health" },
      },
      contextFor(actorB, network(actorB)),
    );
    expect(outcome.status).toBe("SUCCEEDED");
    if (!outcome.result.ok) throw new Error("unreachable");
    const data = ExplorePitchesLikeOutputSchema.parse(outcome.result.data);
    expect(data.found).toBe(true);
    expect(data.items[0]?.related).toEqual(["SAME_SECTOR", "SAME_STAGE"]);
    for (const item of [data.anchor, ...data.items]) {
      expect(item?.profileHref).toMatch(/^\/company\//);
    }
  });

  it("is not offered without the network-visible scope", async () => {
    const { port, asked } = fakeExplore(() => true);
    const outcome = await executor(port).execute(
      {
        callId: "e2",
        name: "explore_pitches_like",
        arguments: { companyName: "Kora Health" },
      },
      contextFor(
        actorB,
        planFor(actorB, "COUNTERPARTY_COMPANY_QUESTION", [
          {
            kind: "COMPANY_PROFILE",
            sensitivity: "NETWORK_VISIBLE",
            companyId: COMPANY_B_NETWORK,
          },
        ]),
      ),
    );
    expect(outcome.status).not.toBe("SUCCEEDED");
    expect(asked).toEqual([]);
  });

  it("cross-tenant negative: another actor's hidden company is not found", async () => {
    const { port } = fakeExplore((actor) => actor.userId === actorB.userId);
    const outcome = await executor(port).execute(
      {
        callId: "e3",
        name: "explore_pitches_like",
        arguments: { companyId: COMPANY_B_NETWORK },
      },
      contextFor(actorA, network(actorA)),
    );
    if (!outcome.result.ok) throw new Error("unreachable");
    const data = ExplorePitchesLikeOutputSchema.parse(outcome.result.data);
    expect(data.found).toBe(false);
    expect(data.items).toEqual([]);
  });

  it("refuses an input with neither a company id nor a name", async () => {
    const { port, asked } = fakeExplore(() => true);
    const outcome = await executor(port).execute(
      { callId: "e4", name: "explore_pitches_like", arguments: {} },
      contextFor(actorB, network(actorB)),
    );
    expect(outcome.status).not.toBe("SUCCEEDED");
    expect(asked).toEqual([]);
  });
});

describe("search_network", () => {
  it("returns typed companies and pitches with an Explore link", async () => {
    const { port } = fakeExplore(() => true);
    const outcome = await executor(port).execute(
      { callId: "s1", name: "search_network", arguments: { query: "health" } },
      contextFor(actorB, network(actorB)),
    );
    if (!outcome.result.ok) throw new Error("unreachable");
    const data = SearchNetworkOutputSchema.parse(outcome.result.data);
    expect(data.companies.map((c) => c.profileHref)).toEqual([
      `/company/${COMPANY_B_NETWORK}`,
    ]);
    expect(data.exploreHref).toBe("/explore?q=health");
    expect(JSON.stringify(data)).not.toMatch(/view|like_count|score/i);
  });
});
