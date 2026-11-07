import { describe, expect, it, vi } from "vitest";

import { CorrelationIdSchema } from "@capital-q/contracts";
import { createLogger } from "@capital-q/observability";
import type { PublicWebResearchService } from "@capital-q/q-research";
import { ActorContextSchema } from "@capital-q/security";

import { createWorkerPresenceReadPort } from "../src/presence/composition.js";

/**
 * The worker's own read of the public web for onboarding research (onboarding
 * plan §7). The same two fixes as q-api's port:
 *  - P0-3: a refused or spent provider is logged with its failure class,
 *    never mistaken for "nothing found", and never told to the person;
 *  - P1-5: the site they gave is read directly, and searches run as a
 *    planned job (the 8 s page budget, not a turn's 3 s).
 */

const actor = ActorContextSchema.parse({
  userId: "b0000000-0000-4000-8000-000000000001",
  tenantId: "c0000000-0000-4000-8000-000000000001",
  actorType: "HUMAN",
});
const base = createLogger(
  { serviceName: "workers-test", environment: "test" },
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

const request = {
  actor,
  correlationId: CorrelationIdSchema.parse(
    "cor_e0000000-0000-4000-8000-000000000002",
  ),
  subject: {
    subjectType: "COMPANY" as const,
    subjectId: "d0000000-0000-4000-8000-000000000002",
  },
  identity: {
    name: "Tamarind Ledger",
    websiteUrl: "https://tamarind.example",
    profileUrl: null,
    qualifier: null,
  },
};

describe("the worker's onboarding research read", () => {
  it("logs a provider refusal with its failure class (P0-3)", async () => {
    const { logger, warn } = spied();
    const research = {
      research: () =>
        Promise.resolve({
          status: "PROVIDER_UNAVAILABLE",
          failureClass: "AUTHENTICATION",
          message: "refused",
        }),
      extract: () =>
        Promise.resolve({ status: "OK", sources: [], rejectedUrls: [] }),
    } as unknown as PublicWebResearchService;
    const port = createWorkerPresenceReadPort({ research, logger });
    expect(await port.read(request)).toEqual([]);
    expect(
      warn.mock.calls.map((call) => JSON.stringify(call)).join("\n"),
    ).toMatch(/AUTHENTICATION/);
  });

  it("reads the site they gave directly, and searches as a planned job (P1-5)", async () => {
    const searched: { planned?: boolean }[] = [];
    const extracted: { urls: readonly string[]; signal?: AbortSignal }[] = [];
    const research = {
      research: (command: { planned?: boolean }) => {
        searched.push(command);
        return Promise.resolve({ status: "NO_PUBLIC_IDENTITY", message: "" });
      },
      extract: (command: { urls: readonly string[]; signal?: AbortSignal }) => {
        extracted.push(command);
        return Promise.resolve({
          status: "OK",
          sources: [
            {
              url: "https://tamarind.example/",
              title: "Tamarind Ledger",
              publishedAt: null,
              excerpt:
                "Tamarind Ledger helps market traders collect what they're owed.",
              retrievedAt: "2026-11-07T10:00:00.000Z",
            },
          ],
          rejectedUrls: [],
        });
      },
    } as unknown as PublicWebResearchService;
    const port = createWorkerPresenceReadPort({ research });

    const found = await port.read(request);

    expect(extracted[0]?.urls).toEqual(["https://tamarind.example"]);
    expect(extracted[0]?.signal).toBeInstanceOf(AbortSignal);
    expect(found.map((page) => page.url)).toContain(
      "https://tamarind.example/",
    );
    expect(searched.every((command) => command.planned === true)).toBe(true);
  });
});
