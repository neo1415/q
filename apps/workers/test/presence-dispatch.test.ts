import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { UtcTimestampSchema } from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
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
import type { PresenceOutcome, PresenceService } from "@capital-q/q-presence";
import { OrganisationIdSchema, UserIdSchema } from "@capital-q/security";

import {
  createPresenceResearchDispatch,
  type PresenceResearchDispatchDependencies,
} from "../src/presence/dispatch.js";
import { TENANT_A } from "./support/fakes.js";

/**
 * The wiring this packet adds: a typed onboarding turn now researches too.
 *
 * `apps/q-api/src/voice/turn.ts` was the only caller of `@capital-q/
 * q-presence` before this, so a founder who typed the interview instead of
 * speaking it never had their company looked up at all. These tests exercise
 * `createPresenceResearchDispatch` in isolation -- no database, no queue --
 * against fakes for the onboarding repositories and the presence service,
 * to prove three things the packet promises: a naming step triggers a
 * build, a finding becomes a real onboarding suggestion carrying its
 * source, and an investor's mandate steps are never reachable through this
 * path (the locked invariant `presenceCandidates()` already enforces, kept
 * honest here at the one new call site that could otherwise bypass it).
 */

const now = () => UtcTimestampSchema.parse(new Date().toISOString());

function textResponse(input: {
  readonly stepKey: string;
  readonly text: string;
}): OnboardingResponse {
  return {
    id: OnboardingResponseIdSchema.parse(randomUUID()),
    sessionId: OnboardingSessionIdSchema.parse(randomUUID()),
    stepKey: input.stepKey,
    responseType: "TEXT",
    value: { type: "TEXT", text: input.text },
    rawText: input.text,
    note: null,
    sourceModality: "TYPED_TEXT",
    createdAt: now(),
    supersededByResponseId: null,
  };
}

function makeSession(
  overrides: Partial<OnboardingSession> = {},
): OnboardingSession {
  return {
    id: OnboardingSessionIdSchema.parse(randomUUID()),
    tenantId: TENANT_A,
    userId: UserIdSchema.parse(randomUUID()),
    organisationId: OrganisationIdSchema.parse(randomUUID()),
    journeyType: "founder",
    definitionVersionId:
      OnboardingDefinitionVersionIdSchema.parse(randomUUID()),
    subject: null,
    status: "ACTIVE",
    currentStepKey: null,
    startedAt: now(),
    lastActivityAt: now(),
    completedAt: null,
    version: 1,
    ...overrides,
  };
}

function fakeSessions(
  session: OnboardingSession | null,
): OnboardingSessionRepository {
  const notUsed = (): never => {
    throw new Error("not used by this test");
  };
  return {
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
  };
}

function fakeResponses(
  current: readonly OnboardingResponse[],
): OnboardingResponseRepository {
  const notUsed = (): never => {
    throw new Error("not used by this test");
  };
  return {
    listCurrent: () => Promise.resolve(current),
    listHistory: notUsed,
    findById: notUsed,
    insert: notUsed,
    supersede: notUsed,
  };
}

function fakeSuggestions(): OnboardingSuggestionRepository {
  const notUsed = (): never => {
    throw new Error("not used by this test");
  };
  return {
    listPending: () => Promise.resolve([]),
    findById: notUsed,
    insert: notUsed,
    resolve: notUsed,
  };
}

function fakePresence(outcome: PresenceOutcome): {
  readonly service: PresenceService;
  readonly builds: unknown[];
} {
  const builds: unknown[] = [];
  return {
    builds,
    service: {
      build: (command) => {
        builds.push(command);
        return Promise.resolve(outcome);
      },
      isDue: () => Promise.resolve(true),
    },
  };
}

/** Waits for the detached async work `onResponseCommitted` fires without awaiting. */
async function flush(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

function dependencies(
  overrides: Partial<PresenceResearchDispatchDependencies>,
): PresenceResearchDispatchDependencies {
  return {
    // Every fake repository below ignores the executor it is handed; a
    // real one is never needed to exercise this dispatcher's own logic.
    sql: {} as DatabaseExecutor,
    presence: fakePresence({
      status: "COMPLETED",
      buildId: "build_1",
      sourceCount: 0,
      understandingCount: 0,
      understandings: [],
      domains: [],
    }).service,
    sessions: fakeSessions(null),
    responses: fakeResponses([]),
    suggestions: fakeSuggestions(),
    createSuggestion: () => Promise.resolve({}),
    ...overrides,
  };
}

describe("presence research dispatch", () => {
  it("ignores a step that does not name a subject", async () => {
    const presence = fakePresence({
      status: "COMPLETED",
      buildId: "b",
      sourceCount: 0,
      understandingCount: 0,
      understandings: [],
      domains: [],
    });
    const createSuggestion = vi.fn(() => Promise.resolve({}));
    const dispatch = createPresenceResearchDispatch(
      dependencies({ presence: presence.service, createSuggestion }),
    );

    dispatch.onResponseCommitted({
      sessionId: randomUUID(),
      stepKey: "F1.website",
      responseId: randomUUID(),
    });
    await flush();

    expect(presence.builds).toHaveLength(0);
    expect(createSuggestion).not.toHaveBeenCalled();
  });

  it("turns a founder's company name into a research build, and a finding into a pending F1.description suggestion carrying its source", async () => {
    const responseId = randomUUID();
    const companyId = randomUUID();
    const companyNamed = textResponse({
      stepKey: "F1.company_name",
      text: "Acme Robotics",
    });
    const named: OnboardingResponse = {
      ...companyNamed,
      id: OnboardingResponseIdSchema.parse(responseId),
    };
    const session = makeSession({
      subject: { subjectType: "COMPANY", subjectId: companyId },
    });

    const retrievedAt = "2026-09-20T12:00:00.000Z";
    const presence = fakePresence({
      status: "COMPLETED",
      buildId: "build_acme",
      sourceCount: 1,
      understandingCount: 1,
      understandings: [
        {
          key: "presence.what_they_do",
          statement: "Acme Robotics builds warehouse robots.",
          sources: [
            {
              evidenceSourceId: "src_acme_1",
              url: "https://acme.example/about",
              title: "About Acme",
              retrievedAt,
            },
          ],
        },
      ],
      domains: ["acme.example"],
    });
    const createSuggestion = vi.fn(() => Promise.resolve({}));

    const dispatch = createPresenceResearchDispatch(
      dependencies({
        presence: presence.service,
        sessions: fakeSessions(session),
        responses: fakeResponses([named]),
        createSuggestion,
      }),
    );

    dispatch.onResponseCommitted({
      sessionId: session.id,
      stepKey: "F1.company_name",
      responseId,
    });
    await flush();

    expect(presence.builds).toHaveLength(1);
    expect(createSuggestion).toHaveBeenCalledTimes(1);
    expect(createSuggestion).toHaveBeenCalledWith({
      sessionId: session.id,
      stepKey: "F1.description",
      targetField: "company.description",
      suggestedValue: {
        type: "TEXT",
        text: "Acme Robotics builds warehouse robots.",
      },
      sourceRefs: [{ sourceType: "EVIDENCE_SOURCE", sourceId: "src_acme_1" }],
      confidence: null,
    });
  });

  it("never proposes an investor mandate step, even when the research names an investment focus", async () => {
    const responseId = randomUUID();
    const organisationId = randomUUID();
    const named = textResponse({
      stepKey: "I0.organisation_name",
      text: "Northwind Capital",
    });
    const namedWithId: OnboardingResponse = {
      ...named,
      id: OnboardingResponseIdSchema.parse(responseId),
    };
    const session = makeSession({
      journeyType: "investor",
      subject: {
        subjectType: "INVESTOR_ORGANISATION",
        subjectId: organisationId,
      },
    });

    const presence = fakePresence({
      status: "COMPLETED",
      buildId: "build_northwind",
      sourceCount: 1,
      understandingCount: 1,
      understandings: [
        {
          key: "presence.signal.stated_focus",
          statement: "Northwind says it backs seed-stage logistics companies.",
          sources: [
            {
              evidenceSourceId: "src_nw_1",
              url: "https://northwind.example",
              title: "Northwind Capital",
              retrievedAt: "2026-09-20T12:00:00.000Z",
            },
          ],
        },
      ],
      domains: ["northwind.example"],
    });
    const createSuggestion = vi.fn(() => Promise.resolve({}));

    const dispatch = createPresenceResearchDispatch(
      dependencies({
        presence: presence.service,
        sessions: fakeSessions(session),
        responses: fakeResponses([namedWithId]),
        createSuggestion,
      }),
    );

    dispatch.onResponseCommitted({
      sessionId: session.id,
      stepKey: "I0.organisation_name",
      responseId,
    });
    await flush();

    // The research ran -- an investor organisation is a legitimate subject
    // -- but nothing about what a firm's own website says may become a
    // declared mandate step, so no suggestion follows.
    expect(presence.builds).toHaveLength(1);
    expect(createSuggestion).not.toHaveBeenCalled();
  });

  it("never fails the caller when the research build rejects", async () => {
    const responseId = randomUUID();
    const companyId = randomUUID();
    const named = textResponse({
      stepKey: "F1.company_name",
      text: "Acme Robotics",
    });
    const namedWithId: OnboardingResponse = {
      ...named,
      id: OnboardingResponseIdSchema.parse(responseId),
    };
    const session = makeSession({
      subject: { subjectType: "COMPANY", subjectId: companyId },
    });
    const failingPresence: PresenceService = {
      build: () => Promise.reject(new Error("provider unavailable")),
      isDue: () => Promise.resolve(true),
    };
    const createSuggestion = vi.fn(() => Promise.resolve({}));

    const dispatch = createPresenceResearchDispatch(
      dependencies({
        presence: failingPresence,
        sessions: fakeSessions(session),
        responses: fakeResponses([namedWithId]),
        createSuggestion,
      }),
    );

    expect(() =>
      dispatch.onResponseCommitted({
        sessionId: session.id,
        stepKey: "F1.company_name",
        responseId,
      }),
    ).not.toThrow();
    await flush();

    expect(createSuggestion).not.toHaveBeenCalled();
  });
});
