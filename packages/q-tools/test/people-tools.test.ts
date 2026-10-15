import { describe, expect, it } from "vitest";

import {
  createInMemoryKnownEntityStore,
  createKnownEntityIndex,
  createPersonLookup,
  createPersonSearch,
} from "@capital-q/q-research";
import type { QToolExecutionContext } from "@capital-q/q-runtime";

import {
  createDefaultQTools,
  createQToolExecutor,
  createQToolRegistry,
} from "../src/index.js";
import { actorA, contextFor, fakePorts, planFor } from "./support.js";

/**
 * people.find / people.brief against fakes: who may use them, that a
 * prepared entity answers with no web call, and that what leaves is the
 * member's own words (W2, 2026-10-10).
 */

const PUBLIC = { kind: "PUBLIC_EXTERNAL_DATA", sensitivity: "PUBLIC" } as const;
const withPublic = planFor(actorA, "GENERAL_QUESTION", [PUBLIC]);
const withoutPublic = planFor(actorA, "GENERAL_QUESTION", []);

async function harness() {
  const store = createInMemoryKnownEntityStore();
  await store.upsertPrepared({
    profileKey: "qa-demo-invest-qatar",
    entityKind: "GOVERNMENT_AGENCY",
    requiresRefresh: false,
    displayName: "Invest Qatar",
    aliases: ["Invest Qatar"],
    profileUrl: null,
    role: null,
    organization: null,
    location: "Doha, Qatar",
    confidence: "STRONG",
    facts: [],
    sources: [
      {
        sourceId: "S20",
        url: "https://www.investqatar.qa/",
        description: "Agency site",
        publishedAt: null,
        evidenceClass: "official",
      },
    ],
    quotes: [],
    image: {
      status: "NOT_ATTACHED",
      assetUrl: null,
      attribution: null,
      licenseNote: null,
    },
    profile: {},
    lastResearchedAt: "2026-10-09T00:00:00Z",
  });
  const known = createKnownEntityIndex({ store });
  await known.warm();
  const sentQueries: string[] = [];
  const web = createPersonSearch({
    providers: [
      {
        code: "fake",
        search: (request) => {
          sentQueries.push(request.query);
          return Promise.resolve({ hits: [], latencyMs: 1 });
        },
        extract: () =>
          Promise.resolve({ pages: [], failedUrls: [], latencyMs: 1 }),
      },
    ],
  });
  const people = createPersonLookup({ known, search: web });
  const ports = fakePorts({ people });
  return {
    sentQueries,
    port: createQToolExecutor({
      registry: createQToolRegistry(createDefaultQTools(ports)),
    }),
  };
}

function speaking(
  context: QToolExecutionContext,
  latestUserText: string,
): QToolExecutionContext {
  return { ...context, conversation: { latestUserText } };
}

describe("people.find", () => {
  it("is not offered and is denied without the actor-wide public scope", async () => {
    const { port } = await harness();
    const offered = await port.offer(contextFor(actorA, withoutPublic));
    expect(offered.map((t) => t.definition.name)).not.toContain(
      "find_public_entity",
    );
    const outcome = await port.execute(
      {
        callId: "p1",
        name: "find_public_entity",
        arguments: { name: "Invest Qatar" },
      },
      speaking(contextFor(actorA, withoutPublic), "find Invest Qatar"),
    );
    expect(outcome.status).toBe("DENIED");
  });

  it("answers a prepared agency with no web call and no personal role", async () => {
    const { port, sentQueries } = await harness();
    const outcome = await port.execute(
      {
        callId: "p2",
        name: "find_public_entity",
        arguments: { name: "Invest Qatar", entityKind: "GOVERNMENT_AGENCY" },
      },
      speaking(contextFor(actorA, withPublic), "find Invest Qatar"),
    );
    expect(outcome.status).toBe("SUCCEEDED");
    const data = outcome.result.ok
      ? (outcome.result.data as {
          source: string;
          result: { card: { subject: { entityKind: string; role: null } } };
        })
      : null;
    expect(data?.source).toBe("KNOWN_ENTITY");
    expect(data?.result.card.subject.entityKind).toBe("GOVERNMENT_AGENCY");
    expect(data?.result.card.subject.role).toBeNull();
    expect(sentQueries).toHaveLength(0);
  });

  it("sends only the member's own words to the web, even if the model adds an employer", async () => {
    const { port, sentQueries } = await harness();
    const outcome = await port.execute(
      {
        callId: "p3",
        name: "find_public_entity",
        arguments: {
          name: "Shadi Qishta",
          city: "Doha",
          country: "Qatar",
          organization: "Secret Holdings LP",
        },
      },
      speaking(
        contextFor(actorA, withPublic),
        "find Shadi Qishta, Doha, Qatar",
      ),
    );
    expect(outcome.status).toBe("SUCCEEDED");
    expect(sentQueries.length).toBeGreaterThan(0);
    expect(sentQueries.join(" | ")).not.toContain("secret");
    expect(sentQueries.join(" | ")).toContain("shadi qishta");
  });
});
