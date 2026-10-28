import { describe, expect, it } from "vitest";

import { buildTurn, last, offered, ok } from "./q-turn-harness.js";

/**
 * Live 2026-10-28 (founder Ajopot): "What do investors like Lagoon Angels
 * Circle look for?" went to the public web and said it found no one
 * called Lagoon Angels Circle, although Lagoon Angels Circle is a Capital Q
 * investor on the founder's Discover page. A founder's named organisation
 * is now looked for among Capital Q's own investors they may see first
 * (through the `show` tool's INVESTOR_LOOKS_FOR step, public profile and
 * published gate only); only an unknown name goes to the public web, and
 * the answer then says it is not on Capital Q.
 */

const LAGOON = "81000000-0000-4000-8000-000000000001";

const OFFERED = [
  offered("show", "client.q_room.show"),
  offered("find_public_entity", "research.public_entity.find"),
];

const reading = (name: string) => ({
  personSearch: {
    name,
    entityKind: "ORGANIZATION" as const,
    city: null,
    country: null,
    organization: null,
    role: null,
    freshSearch: false,
  },
});

function world(known: readonly string[]) {
  return (proposal: Parameters<typeof ok>[0]) => {
    if (proposal.name === "show") {
      const args = proposal.arguments as { object?: string; name?: string };
      if (
        args.object === "INVESTOR_LOOKS_FOR" &&
        args.name !== undefined &&
        known.includes(args.name)
      ) {
        return ok(proposal, "client.q_room.show", {
          status: "SCREEN_WILL_DO_IT",
          clientAction: {
            kind: "SHOW_IN_Q_ROOM",
            object: "INVESTOR_LOOKS_FOR",
            id: LAGOON,
            title: args.name,
          },
        });
      }
      return null;
    }
    if (proposal.name === "find_public_entity") {
      return ok(proposal, "research.public_entity.find", {
        source: "WEB",
        result: {
          outcome: "NOT_FOUND",
          card: null,
          candidates: [],
          clarifyingQuestion: null,
          elapsedMs: 12,
        },
      });
    }
    return null;
  };
}

describe("a founder's named investor resolves on Capital Q first (live 2026-10-28)", () => {
  it("answers with the INVESTOR_LOOKS_FOR card and reads no public page", async () => {
    const { seam, request, executed, stored, alpha } = buildTurn({
      said: "What do investors like Lagoon Angels Circle look for?",
      script: [],
      offered: OFFERED,
      world: world(["Lagoon Angels Circle"]),
      reading: reading("Lagoon Angels Circle"),
    });
    expect((await seam.answer(request)).kind).toBe("ANSWERED");
    expect(executed.map((call) => call.name)).toContain("show");
    expect(executed.map((call) => call.name)).not.toContain(
      "find_public_entity",
    );
    expect(alpha.calls).toHaveLength(0);
    const final = last(stored);
    expect(final.content).toContain(
      "Lagoon Angels Circle is an investor on Capital Q",
    );
    expect(final.blocks).toContainEqual({
      kind: "UI_INTENT",
      intent: {
        kind: "SHOW_IN_Q_ROOM",
        object: "INVESTOR_LOOKS_FOR",
        id: LAGOON,
        title: "Lagoon Angels Circle",
      },
    });
    expect(final.blocks).toContainEqual({
      kind: "INVESTOR_REFERENCE",
      investorOrganisationId: LAGOON,
    });
  });

  it("says an unknown name is not on Capital Q, then searches the public web", async () => {
    const { seam, request, executed, stored } = buildTurn({
      said: "What do investors like Nimbus Alpha Fund look for?",
      script: [],
      offered: OFFERED,
      world: world(["Lagoon Angels Circle"]),
      reading: reading("Nimbus Alpha Fund"),
    });
    expect((await seam.answer(request)).kind).toBe("ANSWERED");
    expect(executed.map((call) => call.name)).toEqual(
      expect.arrayContaining(["show", "find_public_entity"]),
    );
    const final = last(stored);
    expect(final.content).toContain(
      "Nimbus Alpha Fund isn't an investor you can see on Capital Q.",
    );
    expect(final.content).toContain("found no one called Nimbus Alpha Fund");
    expect(final.kinds).not.toContain("UI_INTENT");
  });
});
