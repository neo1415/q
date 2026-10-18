import type { FastifyInstance } from "fastify";

import {
  createProblemDetails,
  PROBLEM_CONTENT_TYPE,
  Q_UI_TEXT_PATH,
  QUiTextDtoSchema,
  type ModelAttribution,
  type QUiTextDto,
} from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import type { ModelGateway, ModelSpendCap } from "@capital-q/model-gateway";
import { languageInfo, type LanguageInfo } from "@capital-q/q-core/language";
import {
  acceptUiTranslations,
  checkUiTranslation,
  UI_TEXT_CATALOG_VERSION,
  UI_TEXT_HAND_GAPS,
  UI_TEXT_SOURCE,
  UI_TRANSLATION_JSON_SCHEMA,
  UiTranslationBatchResultSchema,
  uiTextBatches,
  uiTranslationMessages,
  type UiTranslationBatchResult,
} from "@capital-q/q-core/ui-text";

import {
  getActorContext,
  requireActorContextHook,
  requireActorContextOrPersonalHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";
import type { QVoiceRoutesDependencies } from "../voice/routes.js";

/**
 * The interface in any language (owner directive 2026-10-16): Capital Q's
 * English catalogue, machine-translated once per language through the
 * Model Gateway (UI_TRANSLATION), kept in q_runtime.ui_translations and
 * served to the web. The first person to pick a language starts it; the
 * screens show English for anything not yet translated, and every later
 * visit is instant. Only the source catalogue is ever translated (a client
 * names a language, never text), the class has its own daily spend cap,
 * and a translation that breaks a placeholder, a figure, a currency code
 * or a product name is refused and kept as refused, so it is not paid for
 * twice.
 */

type Logger = {
  readonly info: (object: Record<string, unknown>, message: string) => void;
  readonly warn: (object: Record<string, unknown>, message: string) => void;
};

export type UiTextRow =
  | {
      readonly source: string;
      readonly status: "ACCEPTED";
      readonly text: string;
      readonly modelCode: string | null;
    }
  | {
      readonly source: string;
      readonly status: "REJECTED";
      readonly reason: string;
      readonly modelCode: string | null;
    };

export type UiTextStore = {
  /** Every settled row for a language and version: accepted text by source, and every settled source. */
  readonly read: (
    language: string,
    version: string,
  ) => Promise<{
    readonly accepted: ReadonlyMap<string, string>;
    readonly settled: ReadonlySet<string>;
  }>;
  /**
   * Insert-only, except a cached translation this store refused at read
   * (English left in it), which the fresh result replaces.
   */
  readonly write: (
    language: string,
    version: string,
    rows: readonly UiTextRow[],
  ) => Promise<void>;
};

export function createPostgresUiTextStore(sql: DatabaseExecutor): UiTextStore {
  // Accepted rows a later check refuses (English left in them), by
  // language|version|source: the text seen, so a fresh translation replaces
  // exactly that row and nothing else (live AL 2026-10-16: "Picking là où
  // nous nous étions arrêtés" was served from the cache).
  const stale = new Map<string, string>();
  return {
    read: async (language, version) => {
      const rows = await sql<
        {
          source_text: string;
          status: string;
          translated_text: string | null;
        }[]
      >`
        select source_text, status, translated_text
          from q_runtime.ui_translations
         where language = ${language} and catalog_version = ${version}`;
      const accepted = new Map<string, string>();
      const settled = new Set<string>();
      const target = languageInfo(language);
      for (const row of rows) {
        if (row.status === "ACCEPTED" && row.translated_text !== null) {
          // A cached translation is checked as a new one is; one that fails
          // now is not served and is asked for again.
          if (
            target !== null &&
            !checkUiTranslation(row.source_text, row.translated_text, target).ok
          ) {
            stale.set(
              `${language}|${version}|${row.source_text}`,
              row.translated_text,
            );
            continue;
          }
          accepted.set(row.source_text, row.translated_text);
        }
        settled.add(row.source_text);
      }
      return { accepted, settled };
    },
    write: async (language, version, rows) => {
      if (rows.length === 0) return;
      const sources = rows.map((row) => row.source);
      const statuses = rows.map((row) => row.status);
      const texts = rows.map((row) =>
        row.status === "ACCEPTED" ? row.text : null,
      );
      const reasons = rows.map((row) =>
        row.status === "REJECTED" ? row.reason : null,
      );
      const models = rows.map((row) => row.modelCode);
      // The hash is computed by the database from the English itself, so a
      // row can only ever be found by the string it translates.
      await sql`
        insert into q_runtime.ui_translations
          (language, catalog_version, source_hash, source_text, status,
           translated_text, rejection_reason, model_code)
        select ${language}, ${version},
               encode(sha256(convert_to(r.source, 'UTF8')), 'hex'),
               r.source, r.status, r.text, r.reason, r.model
          from unnest(${sources}::text[], ${statuses}::text[], ${texts}::text[],
                      ${reasons}::text[], ${models}::text[])
               as r(source, status, text, reason, model)
        on conflict (language, catalog_version, source_hash) do nothing`;
      // The stale rows this process refused at read: replaced by the fresh
      // result, only while they still hold the text that was refused.
      for (const row of rows) {
        const key = `${language}|${version}|${row.source}`;
        const seen = stale.get(key);
        if (seen === undefined) continue;
        stale.delete(key);
        await sql`
          update q_runtime.ui_translations
             set status = ${row.status},
                 translated_text = ${row.status === "ACCEPTED" ? row.text : null},
                 rejection_reason = ${row.status === "REJECTED" ? row.reason : null},
                 model_code = ${row.modelCode}
           where language = ${language}
             and catalog_version = ${version}
             and source_hash = encode(sha256(convert_to(${row.source}, 'UTF8')), 'hex')
             and status = 'ACCEPTED'
             and translated_text = ${seen}`;
      }
    },
  };
}

export type UiTextTranslation =
  | {
      readonly ok: true;
      readonly result: UiTranslationBatchResult;
      readonly modelCode: string;
      readonly costUsd: number;
    }
  | { readonly ok: false; readonly reason: "DAILY_BUDGET" | "UNAVAILABLE" };

export type UiTextTranslator = (
  language: LanguageInfo,
  batch: readonly string[],
  attribution: ModelAttribution,
) => Promise<UiTextTranslation>;

/** One batch through the Model Gateway: the class's route, budget and ledger. */
export function createGatewayUiTextTranslator(
  gateway: ModelGateway,
  budget: {
    readonly maxAttempts: number;
    readonly maxEstimatedCostUsd: number;
    readonly maxOutputTokens: number;
    readonly attemptTimeoutMs: number;
  },
): UiTextTranslator {
  return async (language, batch, attribution) => {
    try {
      const response = await gateway.execute<UiTranslationBatchResult>(
        {
          taskClass: "UI_TRANSLATION",
          // Capital Q's own interface copy: no person's data.
          sensitivity: "PUBLIC",
          reasoning: "NONE",
          temperature: 0.2,
          budget,
          messages: [...uiTranslationMessages(language, batch)],
          output: {
            kind: "STRUCTURED",
            schemaName: "UiTranslationBatch",
            jsonSchema: { ...UI_TRANSLATION_JSON_SCHEMA },
          },
          attribution,
        },
        { schema: UiTranslationBatchResultSchema, invalidListItems: "DROP" },
      );
      if (response.output.kind !== "STRUCTURED") {
        return { ok: false, reason: "UNAVAILABLE" };
      }
      return {
        ok: true,
        result: response.output.value,
        modelCode: response.modelCode,
        costUsd: response.cost.amount,
      };
    } catch (error: unknown) {
      const failureClass =
        typeof error === "object" && error !== null && "failureClass" in error
          ? String(error.failureClass)
          : "";
      return {
        ok: false,
        reason:
          failureClass === "BUDGET_EXCEEDED" ? "DAILY_BUDGET" : "UNAVAILABLE",
      };
    }
  };
}

/**
 * `CQ_UI_TRANSLATION_DAILY_CAP_USD`: the UI_TRANSLATION class's own daily
 * ceiling, USD 2 unless set. A plain non-negative number up to 50, or
 * startup fails: a typo must never lift the founder's cap.
 */
export function parseUiTranslationDailyCapUsd(
  env: Readonly<Record<string, string | undefined>>,
): number {
  const raw = env["CQ_UI_TRANSLATION_DAILY_CAP_USD"]?.trim();
  if (raw === undefined || raw === "") return 2;
  if (!/^\d+(\.\d+)?$/u.test(raw) || Number(raw) > 50) {
    throw new Error(
      "CQ_UI_TRANSLATION_DAILY_CAP_USD must be a number of US dollars between 0 and 50",
    );
  }
  return Number(raw);
}

export type UiTextService = {
  /** What is cached for a language now; starts translating the rest when needed. */
  readonly catalog: (
    language: string,
    attribution: Omit<ModelAttribution, "correlationId" | "purpose">,
  ) => Promise<QUiTextDto | null>;
  /** Resolves when no translation is running (tests). */
  readonly idle: () => Promise<void>;
};

export type UiTextServiceDependencies = {
  readonly store: UiTextStore;
  readonly translate: UiTextTranslator;
  /** The UI_TRANSLATION class's daily ceiling. */
  readonly cap: ModelSpendCap;
  readonly logger?: Logger | undefined;
  /** Defaults: the generated source catalogue and hand-catalogue gaps. */
  readonly source?: readonly string[] | undefined;
  readonly handGaps?: Readonly<Record<string, readonly string[]>> | undefined;
  /** Batches in flight per language. */
  readonly concurrency?: number | undefined;
  readonly now?: (() => number) | undefined;
  /** How long a read is reused before the store is asked again. */
  readonly cacheMs?: number | undefined;
  /** How long a language waits after a failure before it is tried again. */
  readonly retryAfterMs?: number | undefined;
};

type Cached = {
  readonly at: number;
  readonly accepted: Map<string, string>;
  readonly settled: Set<string>;
};

export function createUiTextService(
  dependencies: UiTextServiceDependencies,
): UiTextService {
  const source = dependencies.source ?? UI_TEXT_SOURCE;
  const handGaps = dependencies.handGaps ?? UI_TEXT_HAND_GAPS;
  const now = dependencies.now ?? Date.now;
  const cacheMs = dependencies.cacheMs ?? 30_000;
  const retryAfterMs = dependencies.retryAfterMs ?? 10 * 60_000;
  const concurrency = Math.max(1, dependencies.concurrency ?? 2);
  const version = UI_TEXT_CATALOG_VERSION;
  const cache = new Map<string, Cached>();
  const running = new Map<string, Promise<void>>();
  const paused = new Map<
    string,
    { readonly at: number; readonly reason: "DAILY_BUDGET" | "UNAVAILABLE" }
  >();

  /** What this language needs: everything, or only what its hand catalogue lacks. */
  const needed = (info: LanguageInfo): readonly string[] =>
    handGaps[info.primary] ?? source;

  async function read(tag: string): Promise<Cached> {
    const hit = cache.get(tag);
    if (hit !== undefined && now() - hit.at < cacheMs) return hit;
    const rows = await dependencies.store.read(tag, version);
    const fresh: Cached = {
      at: now(),
      accepted: new Map(rows.accepted),
      settled: new Set(rows.settled),
    };
    cache.set(tag, fresh);
    return fresh;
  }

  async function fill(
    info: LanguageInfo,
    missing: readonly string[],
    attribution: ModelAttribution,
  ): Promise<void> {
    const batches = [...uiTextBatches(missing)];
    let stopped = false;
    const worker = async (): Promise<void> => {
      for (
        let batch = batches.shift();
        batch !== undefined && !stopped;
        batch = batches.shift()
      ) {
        const verdict = await dependencies.cap.check();
        if (!verdict.allowed) {
          stopped = true;
          paused.set(info.tag, { at: now(), reason: "DAILY_BUDGET" });
          dependencies.logger?.warn(
            {
              language: info.tag,
              capUsd: verdict.capUsd,
              spentUsd: verdict.spentUsd,
            },
            "ui translation paused: the day's translation budget is spent",
          );
          return;
        }
        const outcome = await dependencies.translate(info, batch, attribution);
        if (!outcome.ok) {
          stopped = true;
          paused.set(info.tag, { at: now(), reason: outcome.reason });
          dependencies.logger?.warn(
            { language: info.tag, reason: outcome.reason },
            "ui translation paused",
          );
          return;
        }
        dependencies.cap.note(outcome.costUsd);
        const { accepted, rejected } = acceptUiTranslations(
          batch,
          outcome.result,
          info,
        );
        const rows: UiTextRow[] = [
          ...[...accepted].map(([text, translated]): UiTextRow => ({
            source: text,
            status: "ACCEPTED",
            text: translated,
            modelCode: outcome.modelCode,
          })),
          ...[...rejected].map(([text, why]): UiTextRow => ({
            source: text,
            status: "REJECTED",
            reason: why.ok ? "UNKNOWN" : why.reason,
            modelCode: outcome.modelCode,
          })),
        ];
        await dependencies.store.write(info.tag, version, rows);
        const cached = cache.get(info.tag);
        if (cached !== undefined) {
          for (const row of rows) {
            cached.settled.add(row.source);
            if (row.status === "ACCEPTED")
              cached.accepted.set(row.source, row.text);
          }
        }
      }
    };
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    dependencies.logger?.info(
      { language: info.tag, asked: missing.length, stopped },
      "ui translation pass finished",
    );
  }

  return {
    catalog: async (language, attribution) => {
      const info = languageInfo(language);
      if (info === null) return null;
      const want = info.primary === "en" ? [] : needed(info);
      const cached = want.length === 0 ? null : await read(info.tag);
      const entries: Record<string, string> = {};
      let settled = 0;
      const missing: string[] = [];
      for (const english of want) {
        const translated = cached?.accepted.get(english);
        if (translated !== undefined) entries[english] = translated;
        if (cached?.settled.has(english) === true) settled += 1;
        else missing.push(english);
      }
      const hold = paused.get(info.tag);
      const holding = hold !== undefined && now() - hold.at < retryAfterMs;
      if (missing.length > 0 && !holding && !running.has(info.tag)) {
        paused.delete(info.tag);
        const pass = fill(info, missing, {
          ...attribution,
          correlationId: `ui-text:${info.tag}`,
          purpose: "OTHER",
        })
          .catch((error: unknown) => {
            paused.set(info.tag, { at: now(), reason: "UNAVAILABLE" });
            dependencies.logger?.warn(
              { err: error, language: info.tag },
              "ui translation failed",
            );
          })
          .finally(() => {
            running.delete(info.tag);
          });
        running.set(info.tag, pass);
      }
      const stillPaused = paused.get(info.tag);
      return QUiTextDtoSchema.parse({
        language: info.tag,
        version,
        entries,
        total: want.length,
        settled,
        complete: missing.length === 0,
        paused:
          missing.length > 0 &&
          stillPaused !== undefined &&
          now() - stillPaused.at < retryAfterMs
            ? stillPaused.reason
            : null,
      });
    },
    idle: async () => {
      while (running.size > 0) await Promise.all([...running.values()]);
    },
  };
}

export type UiTextRoutesDependencies = ActorContextDependencies & {
  readonly identity?: QVoiceRoutesDependencies["identity"] | undefined;
  readonly uiText: UiTextService;
};

/** `GET /v1/q/ui-text/{language}`: a signed-in person's screens in their language. */
export function registerUiTextRoutes(
  app: FastifyInstance,
  dependencies: UiTextRoutesDependencies,
): void {
  const identity = dependencies.identity;
  const withContext =
    identity === undefined
      ? requireActorContextHook(dependencies)
      : requireActorContextOrPersonalHook({ ...dependencies, identity });
  app.get(
    Q_UI_TEXT_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const params = request.params as { readonly language?: unknown };
      const language =
        typeof params.language === "string" ? params.language : "";
      const actor = getActorContext(request);
      const catalog = await dependencies.uiText.catalog(language, {
        tenantId: actor.tenantId,
        userId: actor.userId,
      });
      if (catalog === null) {
        const problem = createProblemDetails({
          code: "INVALID_REQUEST",
          requestId: request.id,
          detail: "That is not a language Capital Q can offer.",
        });
        return reply
          .status(problem.status)
          .type(PROBLEM_CONTENT_TYPE)
          .send(problem);
      }
      // Shared product copy: the same for everyone, never personal.
      void reply.header(
        "Cache-Control",
        catalog.complete ? "private, max-age=300" : "no-store",
      );
      return catalog;
    },
  );
}

/** The catalogue version code-written answer lines are cached under, apart from the UI's. */
// v2: the same glossary as ui-text.v2 (one set of instructions).
export const ANSWER_WORDS_VERSION = "answer-words.v2" as const;

/**
 * Q's code-written lines in any language (lane ml's answers: attention,
 * person search, fit, mandate; arrival and welcome lines). The caller
 * passes English SKELETONS: every name, figure, currency code, quote and
 * link already lifted out into `{v1}`, `{v2}`…, so only product copy is
 * ever sent (PUBLIC). The same translator, store, checks and daily cap as
 * the interface, under its own catalogue version.
 *
 * Returns the accepted translation per line that is ready in time; a
 * missing key means none yet (the caller says that line in English). A
 * line never seen waits up to `waitMs` for the model, then is ready for
 * the next caller. English, or a language the registry cannot offer,
 * returns an empty map without any model call.
 */
export type TranslateLines = (
  language: string,
  lines: readonly string[],
  attribution: Omit<ModelAttribution, "correlationId" | "purpose">,
  options?: TranslateLinesOptions,
) => Promise<ReadonlyMap<string, string>>;

export type TranslateLinesOptions = {
  /**
   * Only lines already translated come back, without waiting: lines never
   * seen are still sent to the model in the background, so the next caller
   * has them (lane ob1: a code-written reply must not wait on a model).
   */
  readonly cachedOnly?: boolean | undefined;
};

export function createLineTranslator(dependencies: {
  readonly store: UiTextStore;
  readonly translate: UiTextTranslator;
  /** Shared with the interface's service: one UI_TRANSLATION ceiling. */
  readonly cap: ModelSpendCap;
  readonly logger?: Logger | undefined;
  readonly version?: string | undefined;
  /** How long a caller waits for lines nobody has asked for before. */
  readonly waitMs?: number | undefined;
  /** At most this many lines per call reach the model. */
  readonly maxLines?: number | undefined;
}): TranslateLines {
  const version = dependencies.version ?? ANSWER_WORDS_VERSION;
  const waitMs = dependencies.waitMs ?? 6_000;
  const maxLines = dependencies.maxLines ?? 200;
  // Settled lines per language (accepted text, or null when refused), so a
  // line is read from the store once per process and asked for once.
  const known = new Map<string, Map<string, string | null>>();
  const loaded = new Map<string, Promise<void>>();
  const inFlight = new Map<string, Promise<void>>();

  const memory = (tag: string): Map<string, string | null> => {
    let lines = known.get(tag);
    if (lines === undefined) {
      lines = new Map();
      known.set(tag, lines);
    }
    return lines;
  };

  const load = (tag: string): Promise<void> => {
    let pending = loaded.get(tag);
    if (pending === undefined) {
      pending = dependencies.store
        .read(tag, version)
        .then(({ accepted, settled }) => {
          const lines = memory(tag);
          for (const line of settled)
            lines.set(line, accepted.get(line) ?? null);
        })
        .catch((error: unknown) => {
          loaded.delete(tag);
          dependencies.logger?.warn(
            { err: error, language: tag },
            "answer words could not be read",
          );
        });
      loaded.set(tag, pending);
    }
    return pending;
  };

  const ask = async (
    info: LanguageInfo,
    missing: readonly string[],
    attribution: ModelAttribution,
  ): Promise<void> => {
    const lines = memory(info.tag);
    for (const batch of uiTextBatches(missing)) {
      const verdict = await dependencies.cap.check();
      if (!verdict.allowed) {
        dependencies.logger?.warn(
          {
            language: info.tag,
            capUsd: verdict.capUsd,
            spentUsd: verdict.spentUsd,
          },
          "answer words paused: the day's translation budget is spent",
        );
        return;
      }
      const outcome = await dependencies.translate(info, batch, attribution);
      if (!outcome.ok) return;
      dependencies.cap.note(outcome.costUsd);
      const { accepted, rejected } = acceptUiTranslations(
        batch,
        outcome.result,
        info,
      );
      const rows: UiTextRow[] = [
        ...[...accepted].map(([text, translated]): UiTextRow => ({
          source: text,
          status: "ACCEPTED",
          text: translated,
          modelCode: outcome.modelCode,
        })),
        ...[...rejected].map(([text, why]): UiTextRow => ({
          source: text,
          status: "REJECTED",
          reason: why.ok ? "UNKNOWN" : why.reason,
          modelCode: outcome.modelCode,
        })),
      ];
      for (const row of rows) {
        lines.set(row.source, row.status === "ACCEPTED" ? row.text : null);
      }
      await dependencies.store.write(info.tag, version, rows);
    }
  };

  return async (language, requested, attribution, options) => {
    const info = languageInfo(language);
    const result = new Map<string, string>();
    if (info === null || info.primary === "en") return result;
    await load(info.tag);
    const lines = memory(info.tag);
    const unique = [...new Set(requested)].filter(
      (line) => line.trim().length > 0 && line.length <= 4_000,
    );
    const missing = unique
      .filter(
        (line) => !lines.has(line) && !inFlight.has(`${info.tag}|${line}`),
      )
      .slice(0, maxLines);
    const waits = unique
      .map((line) => inFlight.get(`${info.tag}|${line}`))
      .filter((wait): wait is Promise<void> => wait !== undefined);
    if (missing.length > 0) {
      const pass = ask(info, missing, {
        ...attribution,
        correlationId: `answer-words:${info.tag}`,
        purpose: "OTHER",
      })
        .catch((error: unknown) => {
          dependencies.logger?.warn(
            { err: error, language: info.tag },
            "answer words translation failed",
          );
        })
        .finally(() => {
          for (const line of missing) inFlight.delete(`${info.tag}|${line}`);
        });
      for (const line of missing) inFlight.set(`${info.tag}|${line}`, pass);
      waits.push(pass);
    }
    if (waits.length > 0 && options?.cachedOnly !== true) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        Promise.all(waits),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, waitMs);
        }),
      ]);
      if (timer !== undefined) clearTimeout(timer);
    }
    for (const line of unique) {
      const translated = lines.get(line);
      if (translated !== undefined && translated !== null) {
        result.set(line, translated);
      }
    }
    return result;
  };
}
