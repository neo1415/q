import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { UtcTimestampSchema } from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import { createLogger } from "@capital-q/observability";
import {
  OnboardingDefinitionVersionIdSchema,
  OnboardingResponseIdSchema,
  OnboardingSessionIdSchema,
  type OnboardingResponse,
  type OnboardingResponseRepository,
  type OnboardingSession,
  type OnboardingSessionRepository,
  type OnboardingSuggestionRepository,
} from "@capital-q/onboarding";
import {
  createPresenceService,
  type PresenceBuild,
  type PresenceBuildLog,
} from "@capital-q/q-presence";
import { createPublicWebResearchService } from "@capital-q/q-research";
import {
  createReplayResearchProvider,
  RecordedResearchFixtureSchema,
} from "@capital-q/q-research/providers/recorded";
import { OrganisationIdSchema, UserIdSchema } from "@capital-q/security";

import { createWorkerPresenceReadPort } from "../src/presence/composition.js";
import { createPresenceResearchDispatch } from "../src/presence/dispatch.js";
import { TENANT_A } from "./support/fakes.js";

/**
 * The onboarding research gate (DECISIONS 48, onboarding plan §7): recorded
 * public pages replayed through the real path -- research service, the
 * worker's read of the public web, the presence build, the onboarding
 * dispatch -- with no network. Fictional accounts can never exercise real
 * research (they would find real namesakes), so this is where the path is
 * proven.
 *
 * The fixtures are SYNTHETIC and hand-written for an invented company on a
 * reserved domain (never recorded live, no paid search). The replay throws
 * on any request it does not hold, so a change to what is searched or read
 * is visible here. The model's reading of the pages is the one stand-in: a
 * fixed reading, labelled as such; the replayed web is what is under test.
 *
 * Three cases:
 *   found    → a pending F1.description suggestion citing the page: held
 *              for the person's confirmation, never authoritative;
 *   refused  → every provider refuses the key: logged with its failure
 *              class, no suggestion, and nothing for the person to hear;
 *   nothing  → no public presence: silent (no warning, no suggestion).
 */

const FIXTURES = join(
  process.cwd().endsWith("apps/workers")
    ? process.cwd()
    : join(process.cwd(), "apps/workers"),
  "test/fixtures/onboarding-research",
);
const fixture = (name: string) =>
  RecordedResearchFixtureSchema.parse(
    JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), "utf8")),
  );

const now = () => UtcTimestampSchema.parse(new Date().toISOString());
const notUsed = (): never => {
  throw new Error("not used by this test");
};

function world(name: string) {
  const companyId = randomUUID();
  const session: OnboardingSession = {
    id: OnboardingSessionIdSchema.parse(randomUUID()),
    tenantId: TENANT_A,
    userId: UserIdSchema.parse(randomUUID()),
    organisationId: OrganisationIdSchema.parse(randomUUID()),
    journeyType: "founder",
    definitionVersionId:
      OnboardingDefinitionVersionIdSchema.parse(randomUUID()),
    subject: { subjectType: "COMPANY", subjectId: companyId },
    status: "ACTIVE",
    currentStepKey: null,
    startedAt: now(),
    lastActivityAt: now(),
    completedAt: null,
    version: 1,
  };
  const text = (stepKey: string, value: string): OnboardingResponse => ({
    id: OnboardingResponseIdSchema.parse(randomUUID()),
    sessionId: session.id,
    stepKey,
    responseType: "TEXT",
    value: { type: "TEXT", text: value },
    rawText: value,
    note: null,
    sourceModality: "TYPED_TEXT",
    createdAt: now(),
    supersededByResponseId: null,
  });
  const name_ = text("F1.company_name", "Tamarind Ledger");
  const website = text("F1.website", "https://tamarind.example");
  const sessions = {
    findById: () => Promise.resolve(session),
    findByIdForUser: notUsed,
    findActive: notUsed,
    findLatestActive: notUsed,
    findLatest: notUsed,
    lockStart: notUsed,
    insert: notUsed,
    lockForUpdate: notUsed,
    commit: notUsed,
    bindContext: notUsed,
  } satisfies OnboardingSessionRepository;
  const responses = {
    listCurrent: () => Promise.resolve([name_, website]),
    listHistory: notUsed,
    findById: notUsed,
    insert: notUsed,
    supersede: notUsed,
    withdraw: notUsed,
  } satisfies OnboardingResponseRepository;
  const suggestions = {
    listPending: () => Promise.resolve([]),
    findById: notUsed,
    insert: notUsed,
    resolve: notUsed,
  } satisfies OnboardingSuggestionRepository;

  // The replayed web: a request the recording does not hold is thrown.
  const provider = createReplayResearchProvider({ fixture: fixture(name) });
  const base = createLogger(
    { serviceName: "workers-test", environment: "test" },
    { level: "silent" },
  );
  const warn = vi.fn();
  const logger = { ...base, warn } as unknown as typeof base;

  // Storage stand-ins: an in-memory build log, evidence and knowledge.
  let latest: PresenceBuild | null = null;
  const log: PresenceBuildLog = {
    latest: () => Promise.resolve(latest),
    start: (_actor, subject) => {
      latest = {
        id: randomUUID(),
        subject,
        status: "RUNNING",
        sourceCount: 0,
        understandingCount: 0,
        failureCode: null,
        startedAt: new Date().toISOString(),
        completedAt: null,
      };
      return Promise.resolve({ id: latest.id });
    },
    finish: (_actor, input) => {
      if (latest !== null) {
        latest = {
          ...latest,
          status: input.status,
          sourceCount: input.sourceCount,
          understandingCount: input.understandingCount,
          failureCode: input.failureCode,
          completedAt: new Date().toISOString(),
        };
      }
      return Promise.resolve();
    },
  };
  const readings: { sources: number }[] = [];
  const presence = createPresenceService({
    web: createWorkerPresenceReadPort({
      research: createPublicWebResearchService({ provider }),
      logger,
    }),
    evidence: {
      registerSource: () => Promise.resolve({ id: `src_${randomUUID()}` }),
      createItem: () => Promise.resolve({ id: `item_${randomUUID()}` }),
    },
    // The model's reading, fixed (labelled stand-in): it says what the
    // first page says the company does.
    reader: {
      read: (request) => {
        readings.push({ sources: request.sources.length });
        return Promise.resolve(
          request.sources.length === 0
            ? []
            : [
                {
                  key: "presence.what_they_do" as const,
                  statement:
                    "Tamarind Ledger helps market traders in Lagos keep track of what they are owed and collect it by transfer.",
                  sourceIndexes: [request.sources[0]?.index ?? 0],
                },
              ],
        );
      },
    },
    knowledge: { propose: () => Promise.resolve({ accepted: true }) },
    log,
  });
  const createSuggestion = vi.fn(() => Promise.resolve({}));
  const dispatch = createPresenceResearchDispatch({
    sql: {} as DatabaseExecutor,
    presence,
    sessions,
    responses,
    suggestions,
    createSuggestion,
    logger,
  });
  const run = () =>
    dispatch.onResponseCommitted({
      sessionId: session.id,
      stepKey: "F1.company_name",
      responseId: name_.id,
    });
  return { run, provider, createSuggestion, warn, readings };
}

describe("onboarding research, replayed (DECISIONS 48)", () => {
  it("found: the company's own pages become a suggestion held for their confirmation", async () => {
    const { run, provider, createSuggestion, warn } = world("found");
    expect(await run()).toBe("DONE");
    expect(provider.misses).toEqual([]);
    expect(createSuggestion).toHaveBeenCalledTimes(1);
    expect(createSuggestion).toHaveBeenCalledWith(
      expect.objectContaining({
        stepKey: "F1.description",
        suggestedValue: {
          type: "TEXT",
          text: expect.stringContaining("market traders") as unknown,
        },
        // It cites the page it came from.
        sourceRefs: [
          expect.objectContaining({ sourceType: "EVIDENCE_SOURCE" }),
        ],
      }),
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it("refused: every provider refuses; logged with its failure class, nothing for the person", async () => {
    const { run, provider, createSuggestion, warn, readings } =
      world("refused");
    expect(await run()).toBe("DONE");
    expect(provider.misses).toEqual([]);
    expect(createSuggestion).not.toHaveBeenCalled();
    // Nothing was read, so nothing was put to a model or to the person.
    expect(readings).toEqual([]);
    expect(
      warn.mock.calls.map((call) => JSON.stringify(call)).join("\n"),
    ).toMatch(/AUTHENTICATION/);
  });

  it("nothing found: no public presence, and silence", async () => {
    const { run, provider, createSuggestion, warn } = world("nothing");
    expect(await run()).toBe("DONE");
    expect(provider.misses).toEqual([]);
    expect(createSuggestion).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});
