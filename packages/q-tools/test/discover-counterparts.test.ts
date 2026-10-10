import { describe, expect, it } from "vitest";

import {
  createCounterpartDiscovery,
  createInMemoryKnownEntityStore,
  createKnownEntityIndex,
} from "@capital-q/q-research";

import {
  createDefaultQTools,
  createQToolExecutor,
  createQToolRegistry,
} from "../src/index.js";
import { actorA, contextFor, fakePorts, planFor } from "./support.js";

/**
 * people.discover against fakes: who may use it, that it is offered only
 * when the discovery port is composed, and that private fields a model
 * might add never become words in a web query (D1, 2026-10-10).
 */

const PUBLIC = { kind: "PUBLIC_EXTERNAL_DATA", sensitivity: "PUBLIC" } as const;
const withPublic = planFor(actorA, "GENERAL_QUESTION", [PUBLIC]);
const withoutPublic = planFor(actorA, "GENERAL_QUESTION", []);

function harness() {
  const searched: string[] = [];
  const counterparts = createCounterpartDiscovery({
    known: createKnownEntityIndex({ store: createInMemoryKnownEntityStore() }),
    providers: [
      {
        code: "fake",
        search: (request) => {
          searched.push(request.query);
          return Promise.resolve({ hits: [], latencyMs: 1 });
        },
        extract: () =>
          Promise.resolve({ pages: [], failedUrls: [], latencyMs: 1 }),
      },
    ],
  });
  const ports = fakePorts({ counterparts });
  return {
    searched,
    port: createQToolExecutor({
      registry: createQToolRegistry(createDefaultQTools(ports)),
    }),
  };
}

describe("people.discover", () => {
  it("is offered only with the public scope, and denied without it", async () => {
    const { port } = harness();
    const offered = await port.offer(contextFor(actorA, withPublic));
    expect(offered.map((t) => t.definition.name)).toContain(
      "discover_investors",
    );
    const notOffered = await port.offer(contextFor(actorA, withoutPublic));
    expect(notOffered.map((t) => t.definition.name)).not.toContain(
      "discover_investors",
    );
    const outcome = await port.execute(
      {
        callId: "d1",
        name: "discover_investors",
        arguments: { regions: ["Arab"] },
      },
      contextFor(actorA, withoutPublic),
    );
    expect(outcome.status).toBe("DENIED");
  });

  it("is absent when no discovery port is composed", async () => {
    const port = createQToolExecutor({
      registry: createQToolRegistry(createDefaultQTools(fakePorts({}))),
    });
    const offered = await port.offer(contextFor(actorA, withPublic));
    expect(offered.map((t) => t.definition.name)).not.toContain(
      "discover_investors",
    );
  });

  it("sends no private words, even if the model puts them in sector or region", async () => {
    const { port, searched } = harness();
    const outcome = await port.execute(
      {
        callId: "d2",
        name: "discover_investors",
        arguments: {
          regions: ["Gulf", "our $3m raise"],
          sector: "fintech, 4 months runway",
          stage: "seed",
          count: 5,
          aboutMyCompany: true,
        },
      },
      {
        ...contextFor(actorA, withPublic),
        conversation: {
          latestUserText: "top three Gulf investors for our $3m raise",
        },
      },
    );
    expect(outcome.status).toBe("SUCCEEDED");
    expect(searched).toEqual(["seed venture capital investors Gulf"]);
    const joined = searched.join(" ").toLowerCase();
    for (const word of ["3m", "arr", "runway", "raise", "$"]) {
      expect(joined).not.toContain(word);
    }
  });
});
