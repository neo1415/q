import { createLogger } from "@capital-q/observability";
import type { PublicWebResearchService } from "@capital-q/q-research";
import { CorrelationIdSchema } from "@capital-q/contracts";
import { ActorContextSchema } from "@capital-q/security";
import { describe, expect, it, vi } from "vitest";

import { createPresenceReadPort } from "../src/composition/presence.js";

/**
 * P0-3 (onboarding plan 2026-11-07, RC2): a search that comes back without
 * sources because every provider refused, or a key is spent, is not
 * "nothing found". The person still hears nothing (DECISIONS 77: carry on
 * quietly), but the logs must say which, so research failing can be told
 * from a subject with no public presence.
 */

const actor = ActorContextSchema.parse({
  userId: "b0000000-0000-4000-8000-000000000001",
  tenantId: "c0000000-0000-4000-8000-000000000001",
  actorType: "HUMAN",
});
const base = createLogger(
  { serviceName: "q-api-test", environment: "test" },
  { level: "silent" },
);

function spied() {
  const warn = vi.fn();
  const info = vi.fn();
  return {
    logger: { ...base, warn, info } as unknown as typeof base,
    warn,
    info,
  };
}

function researchReturning(
  outcome: Awaited<ReturnType<PublicWebResearchService["research"]>>,
): PublicWebResearchService {
  return {
    research: () => Promise.resolve(outcome),
  } as unknown as PublicWebResearchService;
}

const request = {
  actor,
  correlationId: CorrelationIdSchema.parse(
    "cor_e0000000-0000-4000-8000-000000000001",
  ),
  subject: {
    subjectType: "COMPANY" as const,
    subjectId: "d0000000-0000-4000-8000-000000000001",
  },
  identity: {
    name: "Tamarind Ledger",
    websiteUrl: "https://tamarind.example",
    profileUrl: null,
    qualifier: null,
  },
};

describe("onboarding research: failures are logged, never mistaken for nothing found", () => {
  it("logs a provider refusal with its failure class", async () => {
    const { logger, warn } = spied();
    const port = createPresenceReadPort({
      research: researchReturning({
        status: "PROVIDER_UNAVAILABLE",
        failureClass: "AUTHENTICATION",
        message: "The search provider refused the key.",
      }),
      logger,
    });
    const found = await port.read(request);
    expect(found).toEqual([]);
    const logged = warn.mock.calls.map((call) => JSON.stringify(call));
    expect(logged.join("\n")).toMatch(/PROVIDER_UNAVAILABLE/);
    expect(logged.join("\n")).toMatch(/AUTHENTICATION/);
  });

  it("logs no public identity as such, apart from a failure", async () => {
    const { logger, warn, info } = spied();
    const port = createPresenceReadPort({
      research: researchReturning({
        status: "NO_PUBLIC_IDENTITY",
        message: "Nothing public to search for.",
      }),
      logger,
    });
    await port.read(request);
    const all = [...warn.mock.calls, ...info.mock.calls]
      .map((call) => JSON.stringify(call))
      .join("\n");
    expect(all).toMatch(/NO_PUBLIC_IDENTITY/);
  });
});
