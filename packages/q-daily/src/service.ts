import { randomUUID } from "node:crypto";

import {
  Q_DAILY_OPTIONAL_SECTIONS,
  type QDailyEdition,
  type QDailyHomeDto,
  type QDailyOptionalSection,
  type QDailyPreferences,
  type QDailyRequestDto,
  type SetQDailyPreferencesRequest,
} from "@capital-q/contracts";

import { clusterBudget, DAILY_BUDGET, personalBudget } from "./budget.js";
import { editionEmail } from "./email.js";
import {
  composeEdition,
  gatherCluster,
  gatherPeople,
  writeTake,
} from "./pipeline.js";
import { clusterKeyOf, publicInterests, topicsOf } from "./profile.js";
import { localDate, nextDueAt } from "./schedule.js";
import type {
  DailyEmailSender,
  DailyFeedReader,
  DailyNewsIndex,
  DailyPhotoPort,
  DailyReaderStore,
  DailyStoryWriterPort,
  DailyTakePort,
  DailyWorkerStore,
  DueReader,
} from "./ports.js";

type Logger = {
  readonly info: (fields: Record<string, unknown>, message: string) => void;
  readonly warn: (fields: Record<string, unknown>, message: string) => void;
};

export type DailyTickResult = {
  readonly defaults: number;
  readonly prepared: number;
  readonly emailed: number;
  readonly skipped: number;
};

/**
 * The worker's side (DAILY spec §6): every tick, give new people their
 * weekly default, claim who is due, and prepare their editions one after
 * another within the daily cap. One person's failure is logged and their
 * next edition scheduled; it never stops the tick.
 */
export function createDailyEditionService(deps: {
  readonly store: DailyWorkerStore;
  readonly index?: DailyNewsIndex | undefined;
  readonly feeds?: DailyFeedReader | undefined;
  readonly writer?: DailyStoryWriterPort | undefined;
  readonly take?: DailyTakePort | undefined;
  readonly photos?: DailyPhotoPort | undefined;
  readonly email?: DailyEmailSender | undefined;
  /** The web app's origin for links in the email; null leaves them out. */
  readonly webOrigin: string | null;
  readonly maxEditionsPerDay?: number | undefined;
  readonly logger?: Logger | undefined;
}): {
  readonly tick: (now: Date, correlationId: string) => Promise<DailyTickResult>;
  readonly prepare: (
    reader: DueReader,
    now: Date,
    correlationId: string,
  ) => Promise<"PREPARED" | "EMAILED" | "SKIPPED">;
} {
  const { store } = deps;
  const dailyCap = Math.max(
    0,
    Math.min(
      deps.maxEditionsPerDay ?? DAILY_BUDGET.editionsPerDay,
      DAILY_BUDGET.editionsPerDay,
    ),
  );

  async function prepare(
    reader: DueReader,
    now: Date,
    correlationId: string,
  ): Promise<"PREPARED" | "EMAILED" | "SKIPPED"> {
    const next = nextDueAt(reader.frequency, reader.timeZone, now);
    const profile = await store.profileOf(reader.userId, reader.tenantId);
    if (profile === null) {
      await store.reschedule(reader.userId, next);
      return "SKIPPED";
    }
    const windowDays = reader.frequency === "DAILY" ? 2 : 7;
    const interests = publicInterests(profile);
    const clusterKey = clusterKeyOf(interests, windowDays);
    const issueDate = now.toISOString().slice(0, 10);
    const attribution = {
      tenantId: reader.tenantId,
      userId: reader.userId,
      correlationId,
    };

    let cluster = await store.clusterIssue(clusterKey, issueDate);
    let searchesUsed = 0;
    let modelCallsUsed = 0;
    if (cluster === null) {
      const meter = clusterBudget();
      const gathered = await gatherCluster({
        ports: deps,
        interests,
        windowDays,
        meter,
        attribution,
        now,
      });
      cluster = await store.saveClusterIssue({
        clusterKey,
        issueDate,
        topics: topicsOf(interests),
        stories: gathered.stories,
        searchesUsed: meter.searchesUsed(),
        modelCallsUsed: meter.modelCallsUsed(),
      });
      searchesUsed += meter.searchesUsed();
      modelCallsUsed += meter.modelCallsUsed();
    }

    const personal = personalBudget();
    const people = reader.sections.includes("PEOPLE")
      ? await gatherPeople({
          ports: deps,
          profile,
          windowDays,
          meter: personal,
          attribution,
          now,
          excludeIds: new Set(cluster.stories.map((story) => story.id)),
        })
      : [];

    const editionDate = localDate(now, reader.timeZone);
    const number = await store.nextNumber(reader.userId);
    const base = {
      id: randomUUID(),
      number,
      editionDate,
      frequency: reader.frequency,
      profile,
      interests,
      windowDays,
      sections: reader.sections,
      cluster: cluster.stories,
      people,
      now,
    } as const;
    const draft = composeEdition({ ...base, take: null });
    const printed = [
      ...(draft.lead === null ? [] : [draft.lead]),
      ...draft.sections.flatMap((section) => section.stories),
      ...draft.briefs,
    ];
    const take = reader.sections.includes("Q_TAKE")
      ? await writeTake({
          port: deps.take,
          profile,
          stories: printed,
          meter: personal,
          attribution,
        })
      : null;
    const edition = composeEdition({ ...base, take });
    searchesUsed += personal.searchesUsed();
    modelCallsUsed += personal.modelCallsUsed();

    const savedId = await store.saveEdition({
      id: edition.id,
      userId: reader.userId,
      tenantId: reader.tenantId,
      clusterIssueId: cluster.id,
      content: edition,
      searchesUsed: Math.min(searchesUsed, 50),
      modelCallsUsed: Math.min(modelCallsUsed, 50),
    });
    await store.reschedule(reader.userId, next);
    if (savedId === null) return "SKIPPED";

    const sender = deps.email;
    if (!reader.email || sender === undefined || !sender.available) {
      return "PREPARED";
    }
    if (profile.email === null) return "PREPARED";
    const links =
      deps.webOrigin === null
        ? null
        : {
            edition: `${deps.webOrigin}/daily/${savedId}`,
            settings: `${deps.webOrigin}/settings#q-daily`,
          };
    const rendered = editionEmail(edition, links);
    try {
      await sender.send({ to: profile.email, ...rendered });
      await store.markEmailed(savedId, { ok: true });
      return "EMAILED";
    } catch {
      await store.markEmailed(savedId, {
        ok: false,
        error: "The email relay refused or did not answer.",
      });
      return "PREPARED";
    }
  }

  return {
    prepare,
    tick: async (now, correlationId) => {
      const defaults = await store.ensureDefaults(now, 200);
      const today = await store.editionsToday(now);
      const room = Math.max(
        0,
        Math.min(DAILY_BUDGET.editionsPerTick, dailyCap - today),
      );
      if (room === 0) return { defaults, prepared: 0, emailed: 0, skipped: 0 };
      const due = await store.claimDue(now, room);
      let prepared = 0;
      let emailed = 0;
      let skipped = 0;
      for (const reader of due) {
        try {
          const outcome = await prepare(reader, now, correlationId);
          if (outcome === "SKIPPED") skipped += 1;
          else prepared += 1;
          if (outcome === "EMAILED") emailed += 1;
        } catch (error: unknown) {
          skipped += 1;
          deps.logger?.warn(
            { err: error, correlationId },
            "q daily edition failed; next one scheduled",
          );
          await store
            .reschedule(
              reader.userId,
              nextDueAt(reader.frequency, reader.timeZone, now),
            )
            .catch(() => undefined);
        }
      }
      return { defaults, prepared, emailed, skipped };
    },
  };
}

/** What a person reads and sets, by the resolved actor only (Q API). */
export type DailyActor = { readonly userId: string; readonly tenantId: string };

const REQUEST_GAP_MS = 20 * 60 * 60 * 1000;
const ARCHIVE_PAGE = 20;

export function defaultPreferences(nextDue: Date | null): QDailyPreferences {
  return {
    frequency: "WEEKLY",
    email: true,
    sections: [...Q_DAILY_OPTIONAL_SECTIONS],
    nextDueAt: nextDue === null ? null : nextDue.toISOString(),
  };
}

export function createDailyReaderService(deps: {
  readonly store: DailyReaderStore;
}): {
  readonly home: (
    actor: DailyActor,
    cursor: string | null,
    now: Date,
  ) => Promise<QDailyHomeDto>;
  readonly edition: (
    actor: DailyActor,
    editionId: string,
  ) => Promise<QDailyEdition | null>;
  readonly preferences: (
    actor: DailyActor,
    now: Date,
  ) => Promise<QDailyPreferences>;
  readonly setPreferences: (
    actor: DailyActor,
    patch: SetQDailyPreferencesRequest,
    now: Date,
  ) => Promise<QDailyPreferences>;
  readonly request: (actor: DailyActor, now: Date) => Promise<QDailyRequestDto>;
} {
  const { store } = deps;

  async function current(
    actor: DailyActor,
    now: Date,
  ): Promise<QDailyPreferences & { readonly requestedAt: string | null }> {
    const stored = await store.preferences(actor.userId, actor.tenantId);
    if (stored !== null) return stored;
    const zone = await store.timeZoneOf(actor.userId);
    return {
      ...defaultPreferences(nextDueAt("WEEKLY", zone, now)),
      requestedAt: null,
    };
  }

  function publicView(
    preferences: QDailyPreferences & { readonly requestedAt?: string | null },
  ): QDailyPreferences {
    return {
      frequency: preferences.frequency,
      email: preferences.email,
      sections: preferences.sections,
      nextDueAt: preferences.nextDueAt,
    };
  }

  return {
    home: async (actor, cursor, now) => {
      const [latest, archive, preferences] = await Promise.all([
        cursor === null
          ? store.latest(actor.userId, actor.tenantId)
          : Promise.resolve(null),
        store.archive(actor.userId, actor.tenantId, {
          before: cursor,
          limit: ARCHIVE_PAGE + 1,
        }),
        current(actor, now),
      ]);
      const page = archive.slice(0, ARCHIVE_PAGE);
      return {
        latest,
        archive: page,
        nextCursor:
          archive.length > ARCHIVE_PAGE
            ? (page[page.length - 1]?.editionDate ?? null)
            : null,
        preferences: publicView(preferences),
        preparing: preferences.requestedAt !== null,
      };
    },
    edition: (actor, editionId) =>
      store.edition(actor.userId, actor.tenantId, editionId),
    preferences: async (actor, now) => publicView(await current(actor, now)),
    setPreferences: async (actor, patch, now) => {
      const before = await current(actor, now);
      const frequency = patch.frequency ?? before.frequency;
      const sections: readonly QDailyOptionalSection[] =
        patch.sections === undefined
          ? before.sections
          : Q_DAILY_OPTIONAL_SECTIONS.filter((code) =>
              patch.sections?.includes(code),
            );
      const zone = await store.timeZoneOf(actor.userId);
      const due =
        frequency === before.frequency && before.nextDueAt !== null
          ? new Date(before.nextDueAt)
          : nextDueAt(frequency, zone, now);
      const saved = {
        frequency,
        email: patch.email ?? before.email,
        sections,
        nextDueAt: frequency === "OFF" ? null : due,
      };
      await store.savePreferences(actor.userId, actor.tenantId, saved);
      return {
        frequency: saved.frequency,
        email: saved.email,
        sections: [...saved.sections],
        nextDueAt:
          saved.nextDueAt === null ? null : saved.nextDueAt.toISOString(),
      };
    },
    request: async (actor, now) => {
      const preferences = await current(actor, now);
      if (preferences.frequency === "OFF") {
        return { status: "OFF", retryAfter: null };
      }
      if (preferences.requestedAt !== null) {
        return { status: "ALREADY_QUEUED", retryAfter: null };
      }
      const last = await store.lastEditionAt(actor.userId, actor.tenantId);
      if (last !== null && now.getTime() - last.getTime() < REQUEST_GAP_MS) {
        return {
          status: "TOO_SOON",
          retryAfter: new Date(last.getTime() + REQUEST_GAP_MS).toISOString(),
        };
      }
      if ((await store.preferences(actor.userId, actor.tenantId)) === null) {
        await store.savePreferences(actor.userId, actor.tenantId, {
          frequency: preferences.frequency,
          email: preferences.email,
          sections: preferences.sections,
          nextDueAt:
            preferences.nextDueAt === null
              ? null
              : new Date(preferences.nextDueAt),
        });
      }
      await store.request(actor.userId, actor.tenantId, now);
      return { status: "QUEUED", retryAfter: null };
    },
  };
}
