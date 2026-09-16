import { describe, expect, it, vi } from "vitest";

import type { CorrelationId } from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

import { createPresenceService } from "../src/application/build-presence.js";
import {
  PRESENCE_KEYS_EXCLUDED_FROM_RANKING,
  isRankingEligiblePresenceKey,
  PRESENCE_REFRESH_AFTER_MS,
  type PresenceBuild,
  type PresenceSubject,
} from "../src/contracts.js";
import type {
  PresenceBuildLog,
  PresenceEvidencePort,
  PresenceKnowledgePort,
  PresenceReaderPort,
  PresenceReadPort,
  PresenceSource,
  ProposedUnderstanding,
} from "../src/ports.js";

const ACTOR = {
  userId: "11111111-1111-4111-8111-111111111111",
  tenantId: "22222222-2222-4222-8222-222222222222",
  organisationId: "33333333-3333-4333-8333-333333333333",
  membershipId: "44444444-4444-4444-8444-444444444444",
  actorType: "HUMAN",
} as unknown as ActorContext;

const CORRELATION = "corr-presence-1" as CorrelationId;
const SUBJECT: PresenceSubject = {
  subjectType: "COMPANY",
  subjectId: "55555555-5555-4555-8555-555555555555",
};
const IDENTITY = {
  name: "The Vaultlyne",
  websiteUrl: "https://thevaultlyne.com",
  profileUrl: null,
  qualifier: null,
};

function source(
  url: string,
  excerpt = "A page about the company.",
): PresenceSource {
  return {
    url,
    title: "Vaultlyne",
    publishedAt: null,
    excerpt,
    provider: "public_web",
    retrievedAt: "2026-09-16T08:00:00.000Z",
  };
}

function fakeLog(latest: PresenceBuild | null = null): {
  readonly log: PresenceBuildLog;
  readonly finished: {
    value: Parameters<PresenceBuildLog["finish"]>[1] | null;
  };
  readonly starts: { count: number };
} {
  const finished: { value: Parameters<PresenceBuildLog["finish"]>[1] | null } =
    {
      value: null,
    };
  const starts = { count: 0 };
  return {
    finished,
    starts,
    log: {
      latest: () => Promise.resolve(latest),
      start: () => {
        starts.count += 1;
        return Promise.resolve({ id: "build-1" });
      },
      finish: (_actor, input) => {
        finished.value = input;
        return Promise.resolve();
      },
    },
  };
}

function fakeEvidence(
  failOn: readonly string[] = [],
): PresenceEvidencePort & { readonly registered: string[] } {
  const registered: string[] = [];
  return {
    registered,
    registerSource: (_actor, input) => {
      if (failOn.includes(input.sourceUrl)) {
        return Promise.reject(new Error("refused"));
      }
      registered.push(input.sourceUrl);
      return Promise.resolve({ id: `source-${String(registered.length)}` });
    },
    createItem: (_actor, input) =>
      Promise.resolve({ id: `item-${input.sourceId}` }),
  };
}

function fakeReader(
  understandings: readonly ProposedUnderstanding[],
): PresenceReaderPort & { readonly sawSources: { count: number } } {
  const sawSources = { count: 0 };
  return {
    sawSources,
    read: (request) => {
      sawSources.count = request.sources.length;
      return Promise.resolve(understandings);
    },
  };
}

function fakeKnowledge(
  accept: (key: string) => boolean = () => true,
): PresenceKnowledgePort & { readonly proposed: string[] } {
  const proposed: string[] = [];
  return {
    proposed,
    propose: (_actor, input) => {
      proposed.push(input.key);
      return Promise.resolve({ accepted: accept(input.key) });
    },
  };
}

function web(sources: readonly PresenceSource[]): PresenceReadPort {
  return { read: () => Promise.resolve(sources) };
}

describe("a public presence build", () => {
  it("records every page, has a model read them, and holds what the gate accepts", async () => {
    const log = fakeLog();
    const evidence = fakeEvidence();
    const knowledge = fakeKnowledge();
    const service = createPresenceService({
      web: web([
        source("https://a.example/one"),
        source("https://b.example/two"),
      ]),
      evidence,
      reader: fakeReader([
        {
          key: "presence.what_they_do",
          statement: "Their site says they connect legacy insurance systems.",
          sourceIndexes: [0],
        },
        {
          key: "presence.location",
          statement: "A 2025 article places them in Lagos.",
          sourceIndexes: [1],
        },
      ]),
      knowledge,
      log: log.log,
    });

    const outcome = await service.build({
      actor: ACTOR,
      subject: SUBJECT,
      identity: IDENTITY,
      correlationId: CORRELATION,
    });

    expect(outcome).toEqual({
      status: "COMPLETED",
      buildId: "build-1",
      sourceCount: 2,
      understandingCount: 2,
      // What was written, in its own words, so the caller can say it back
      // to the subject and ask whether it has the right person. Only ever
      // what the gate accepted, and only ever the subject's own.
      understandings: [
        {
          key: "presence.what_they_do",
          statement: "Their site says they connect legacy insurance systems.",
        },
        {
          key: "presence.location",
          statement: "A 2025 article places them in Lagos.",
        },
      ],
      domains: [],
    });
    expect(evidence.registered).toHaveLength(2);
    expect(knowledge.proposed).toEqual([
      "presence.what_they_do",
      "presence.location",
    ]);
    expect(log.finished.value).toMatchObject({
      status: "COMPLETED",
      sourceCount: 2,
      understandingCount: 2,
      failureCode: null,
    });
  });

  it("drops one page that could not be recorded and keeps the rest", async () => {
    const log = fakeLog();
    const evidence = fakeEvidence(["https://b.example/two"]);
    const reader = fakeReader([
      {
        key: "presence.what_they_do",
        statement: "Their site describes an integration product.",
        sourceIndexes: [0],
      },
    ]);
    const service = createPresenceService({
      web: web([
        source("https://a.example/one"),
        source("https://b.example/two"),
      ]),
      evidence,
      reader,
      knowledge: fakeKnowledge(),
      log: log.log,
    });

    const outcome = await service.build({
      actor: ACTOR,
      subject: SUBJECT,
      identity: IDENTITY,
      correlationId: CORRELATION,
    });

    expect(outcome).toMatchObject({ status: "COMPLETED", sourceCount: 1 });
    // The model only ever sees pages that were actually recorded, so every
    // index it cites resolves to a source id.
    expect(reader.sawSources.count).toBe(1);
  });

  it("holds nothing when the model cites no page", async () => {
    const knowledge = fakeKnowledge();
    const log = fakeLog();
    const service = createPresenceService({
      web: web([source("https://a.example/one")]),
      evidence: fakeEvidence(),
      reader: fakeReader([
        {
          key: "presence.milestone",
          statement: "They raised a round.",
          sourceIndexes: [],
        },
      ]),
      knowledge,
      log: log.log,
    });

    const outcome = await service.build({
      actor: ACTOR,
      subject: SUBJECT,
      identity: IDENTITY,
      correlationId: CORRELATION,
    });

    expect(knowledge.proposed).toEqual([]);
    expect(outcome).toMatchObject({ understandingCount: 0 });
  });

  it("counts only what the gate accepted", async () => {
    const log = fakeLog();
    const service = createPresenceService({
      web: web([source("https://a.example/one")]),
      evidence: fakeEvidence(),
      reader: fakeReader([
        {
          key: "presence.what_they_do",
          statement: "Their site describes an integration product.",
          sourceIndexes: [0],
        },
        {
          key: "presence.signal.public_voice",
          statement: "Their posts are mostly about hiring.",
          sourceIndexes: [0],
        },
      ]),
      knowledge: fakeKnowledge((key) => key === "presence.what_they_do"),
      log: log.log,
    });

    const outcome = await service.build({
      actor: ACTOR,
      subject: SUBJECT,
      identity: IDENTITY,
      correlationId: CORRELATION,
    });

    expect(outcome).toMatchObject({ understandingCount: 1 });
  });

  it("says nothing was found rather than inventing a build", async () => {
    const log = fakeLog();
    const knowledge = fakeKnowledge();
    const service = createPresenceService({
      web: web([]),
      evidence: fakeEvidence(),
      reader: fakeReader([]),
      knowledge,
      log: log.log,
    });

    const outcome = await service.build({
      actor: ACTOR,
      subject: SUBJECT,
      identity: IDENTITY,
      correlationId: CORRELATION,
    });

    expect(outcome).toEqual({ status: "NOTHING_FOUND", buildId: "build-1" });
    expect(knowledge.proposed).toEqual([]);
    expect(log.finished.value).toMatchObject({ status: "NOTHING_FOUND" });
  });

  it("never throws: a read that fails is a failed build, not a failed turn", async () => {
    const log = fakeLog();
    const service = createPresenceService({
      web: { read: () => Promise.reject(new Error("provider down")) },
      evidence: fakeEvidence(),
      reader: fakeReader([]),
      knowledge: fakeKnowledge(),
      log: log.log,
    });

    const outcome = await service.build({
      actor: ACTOR,
      subject: SUBJECT,
      identity: IDENTITY,
      correlationId: CORRELATION,
    });

    expect(outcome).toEqual({
      status: "FAILED",
      buildId: "build-1",
      failureCode: "READ_FAILED",
    });
    expect(log.finished.value).toMatchObject({ failureCode: "READ_FAILED" });
  });
});

describe("when a build is due", () => {
  const completed = (startedAt: string): PresenceBuild => ({
    id: "earlier",
    subject: SUBJECT,
    status: "COMPLETED",
    sourceCount: 3,
    understandingCount: 2,
    failureCode: null,
    startedAt,
    completedAt: startedAt,
  });

  function serviceWith(latest: PresenceBuild | null, now: number) {
    const log = fakeLog(latest);
    return {
      log,
      service: createPresenceService({
        web: web([source("https://a.example/one")]),
        evidence: fakeEvidence(),
        reader: fakeReader([]),
        knowledge: fakeKnowledge(),
        log: log.log,
        clock: () => now,
      }),
    };
  }

  it("skips a subject read recently, and reads one that is stale", async () => {
    const now = Date.parse("2026-09-16T08:00:00.000Z");
    const fresh = serviceWith(
      completed(new Date(now - 60_000).toISOString()),
      now,
    );
    await expect(
      fresh.service.build({
        actor: ACTOR,
        subject: SUBJECT,
        identity: IDENTITY,
        correlationId: CORRELATION,
      }),
    ).resolves.toEqual({ status: "SKIPPED", reason: "RECENT" });
    expect(fresh.log.starts.count).toBe(0);

    const stale = serviceWith(
      completed(
        new Date(now - PRESENCE_REFRESH_AFTER_MS - 60_000).toISOString(),
      ),
      now,
    );
    await expect(
      stale.service.build({
        actor: ACTOR,
        subject: SUBJECT,
        identity: IDENTITY,
        correlationId: CORRELATION,
      }),
    ).resolves.toMatchObject({ status: "COMPLETED" });
    expect(stale.log.starts.count).toBe(1);
  });

  it("reads a recent subject again when the person asks for a refresh", async () => {
    const now = Date.parse("2026-09-16T08:00:00.000Z");
    const fresh = serviceWith(
      completed(new Date(now - 60_000).toISOString()),
      now,
    );
    await expect(
      fresh.service.build({
        actor: ACTOR,
        subject: SUBJECT,
        identity: IDENTITY,
        correlationId: CORRELATION,
        force: true,
      }),
    ).resolves.toMatchObject({ status: "COMPLETED" });
    expect(fresh.log.starts.count).toBe(1);
  });

  it("does not start a second build while one is running", async () => {
    const now = Date.parse("2026-09-16T08:00:00.000Z");
    const running = serviceWith(
      {
        ...completed(new Date(now - 5_000).toISOString()),
        status: "RUNNING",
        completedAt: null,
      },
      now,
    );
    await expect(
      running.service.build({
        actor: ACTOR,
        subject: SUBJECT,
        identity: IDENTITY,
        correlationId: CORRELATION,
        force: true,
      }),
    ).resolves.toEqual({ status: "SKIPPED", reason: "IN_PROGRESS" });
    expect(running.log.starts.count).toBe(0);
  });

  it("refuses an identity with nothing to search for", async () => {
    const log = fakeLog();
    const service = createPresenceService({
      web: web([source("https://a.example/one")]),
      evidence: fakeEvidence(),
      reader: fakeReader([]),
      knowledge: fakeKnowledge(),
      log: log.log,
    });
    await expect(
      service.build({
        actor: ACTOR,
        subject: SUBJECT,
        identity: { ...IDENTITY, name: "" },
        correlationId: CORRELATION,
      }),
    ).resolves.toEqual({ status: "SKIPPED", reason: "NOT_CONFIGURED" });
    expect(log.starts.count).toBe(0);
  });
});

describe("observed signals and ranking", () => {
  it("excludes every signal key from ranking, and no other key", () => {
    for (const key of PRESENCE_KEYS_EXCLUDED_FROM_RANKING) {
      expect(key.startsWith("presence.signal."), key).toBe(true);
      expect(isRankingEligiblePresenceKey(key)).toBe(false);
    }
    expect(isRankingEligiblePresenceKey("presence.what_they_do")).toBe(true);
    expect(isRankingEligiblePresenceKey("presence.location")).toBe(true);
  });
});

describe("the reads happen at the same time", () => {
  it("does not wait for one page before recording the next", async () => {
    const order: string[] = [];
    const evidence: PresenceEvidencePort = {
      registerSource: async (_actor, input) => {
        order.push(`start:${input.sourceUrl}`);
        await new Promise((resolve) => setTimeout(resolve, 20));
        order.push(`done:${input.sourceUrl}`);
        return { id: input.sourceUrl };
      },
      createItem: (_actor, input) =>
        Promise.resolve({ id: `item-${input.sourceId}` }),
    };
    const log = fakeLog();
    const service = createPresenceService({
      web: web([
        source("https://a.example/one"),
        source("https://b.example/two"),
      ]),
      evidence,
      reader: fakeReader([]),
      knowledge: fakeKnowledge(),
      log: log.log,
    });
    await service.build({
      actor: ACTOR,
      subject: SUBJECT,
      identity: IDENTITY,
      correlationId: CORRELATION,
    });
    // Both started before either finished: sequential would be
    // start, done, start, done.
    expect(order.slice(0, 2)).toEqual([
      "start:https://a.example/one",
      "start:https://b.example/two",
    ]);
  });
});

describe("a subject read twice", () => {
  it("records one page once, however many reads surfaced it", async () => {
    const evidence = fakeEvidence();
    const log = fakeLog();
    const service = createPresenceService({
      web: web([
        source("https://a.example/one"),
        source("https://A.example/one"),
        source("https://b.example/two"),
      ]),
      evidence,
      reader: fakeReader([]),
      knowledge: fakeKnowledge(),
      log: log.log,
    });
    await service.build({
      actor: ACTOR,
      subject: SUBJECT,
      identity: IDENTITY,
      correlationId: CORRELATION,
    });
    expect(evidence.registered).toEqual([
      "https://a.example/one",
      "https://b.example/two",
    ]);
  });
});

describe("a build that is asked for twice at once", () => {
  it("is decided from the log, not from luck", async () => {
    const log = fakeLog(null);
    const service = createPresenceService({
      web: web([]),
      evidence: fakeEvidence(),
      reader: fakeReader([]),
      knowledge: fakeKnowledge(),
      log: log.log,
    });
    const spy = vi.spyOn(log.log, "latest");
    await service.build({
      actor: ACTOR,
      subject: SUBJECT,
      identity: IDENTITY,
      correlationId: CORRELATION,
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
