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
  /** Insert-only: a row already there is kept as it is. */
  readonly write: (
    language: string,
    version: string,
    rows: readonly UiTextRow[],
  ) => Promise<void>;
};

export function createPostgresUiTextStore(sql: DatabaseExecutor): UiTextStore {
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
      for (const row of rows) {
        settled.add(row.source_text);
        if (row.status === "ACCEPTED" && row.translated_text !== null) {
          accepted.set(row.source_text, row.translated_text);
        }
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
