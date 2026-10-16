import type { FastifyInstance } from "fastify";

import {
  createProblemDetails,
  PROBLEM_CONTENT_TYPE,
  Q_WORDS_PATH,
  QWordsDtoSchema,
  QWordsRequestSchema,
  type ModelAttribution,
} from "@capital-q/contracts";
import type { ModelSpendCap } from "@capital-q/model-gateway";
import { languageInfo } from "@capital-q/q-core/language";
import {
  acceptUiTranslations,
  answerSkeletons,
  localisedAnswer,
  uiTextBatches,
} from "@capital-q/q-core/ui-text";

import {
  getActorContext,
  requireActorContextHook,
  requireActorContextOrPersonalHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";
import type { QVoiceRoutesDependencies } from "../voice/routes.js";

import type { UiTextRow, UiTextStore, UiTextTranslator } from "./ui-text.js";

/**
 * Words Q writes by code, in the person's language (owner directive
 * 2026-10-16: any language, no per-language hand work). The answers Q
 * composes without a model (what needs them, a person or company looked
 * up, fit, their mandate, investors who could fit) and the questions Q
 * stored for them go through lane lang's translation layer: the same
 * UI_TRANSLATION gateway class, store and daily cap as the interface.
 *
 * Only a sentence's skeleton is ever translated: q-core lifts every name,
 * figure, currency code, quote and address out first, so no person's data
 * reaches the translator or the shared cache, and what was recorded comes
 * back exactly. A skeleton is translated once per language and reused for
 * everyone. When a sentence has no translation in time (first sight,
 * budget spent, provider down), the text stays in English: never half one
 * language, never a guess.
 */

/** The store's namespace for answer sentences, apart from the catalogue's. */
export const ANSWER_WORDS_VERSION = "answer-words.v1";
/** Bounds per call: what one answer or one screen can need. */
const MAX_TEXTS = 40;
const MAX_SKELETON_CHARS = 600;

type Logger = {
  readonly info: (object: Record<string, unknown>, message: string) => void;
  readonly warn: (object: Record<string, unknown>, message: string) => void;
};

export type AnswerWords = {
  /**
   * Each text in `language`, or null where it stays English (English
   * asked, unknown language, or a sentence not translated in time).
   */
  readonly localise: (
    language: string,
    texts: readonly string[],
    attribution: ModelAttribution,
  ) => Promise<readonly (string | null)[]>;
};

/**
 * Lines of English with `{placeholders}` (product copy, no person's data)
 * in a language: the accepted, validated translation of each line that is
 * ready in time; a line absent from the map has none yet. The shape agreed
 * with lane lang (`translateLines`): its UI_TRANSLATION cache can stand in
 * for this one without the answer path changing.
 */
export type TranslateLines = (
  language: string,
  lines: readonly string[],
  attribution: ModelAttribution,
) => Promise<ReadonlyMap<string, string>>;

/**
 * Until lane lang's translateLines lands: lines through its store,
 * translator and daily cap, under this namespace. A first-seen line waits
 * up to `deadlineMs`; past that it is ready for the next answer.
 */
export function createCachedLineTranslator(dependencies: {
  readonly store: UiTextStore;
  readonly translate: UiTextTranslator;
  readonly cap: ModelSpendCap;
  readonly logger?: Logger | undefined;
  readonly deadlineMs?: number | undefined;
  readonly now?: (() => number) | undefined;
  readonly cacheMs?: number | undefined;
}): TranslateLines {
  const now = dependencies.now ?? Date.now;
  const deadlineMs = dependencies.deadlineMs ?? 6_000;
  const cacheMs = dependencies.cacheMs ?? 60_000;
  const cache = new Map<
    string,
    { at: number; accepted: Map<string, string>; settled: Set<string> }
  >();
  /** Lines being translated now, so two answers never pay twice. */
  const inFlight = new Map<string, Promise<void>>();

  async function read(tag: string) {
    const hit = cache.get(tag);
    if (hit !== undefined && now() - hit.at < cacheMs) return hit;
    const rows = await dependencies.store.read(tag, ANSWER_WORDS_VERSION);
    const fresh = {
      at: now(),
      accepted: new Map(rows.accepted),
      settled: new Set(rows.settled),
    };
    cache.set(tag, fresh);
    return fresh;
  }

  async function translateMissing(
    tag: string,
    missing: readonly string[],
    attribution: ModelAttribution,
  ): Promise<void> {
    const info = languageInfo(tag);
    if (info === null) return;
    for (const batch of uiTextBatches(missing)) {
      const verdict = await dependencies.cap.check();
      if (!verdict.allowed) {
        dependencies.logger?.warn(
          { language: tag },
          "answer words stay English: the day's translation budget is spent",
        );
        return;
      }
      const outcome = await dependencies.translate(info, batch, attribution);
      if (!outcome.ok) {
        dependencies.logger?.warn(
          { language: tag, reason: outcome.reason },
          "answer words stay English: translation unavailable",
        );
        return;
      }
      dependencies.cap.note(outcome.costUsd);
      const { accepted, rejected } = acceptUiTranslations(
        batch,
        outcome.result,
      );
      const rows: UiTextRow[] = [
        ...[...accepted].map(([source, text]): UiTextRow => ({
          source,
          status: "ACCEPTED",
          text,
          modelCode: outcome.modelCode,
        })),
        ...[...rejected].map(([source, why]): UiTextRow => ({
          source,
          status: "REJECTED",
          reason: why.ok ? "UNKNOWN" : why.reason,
          modelCode: outcome.modelCode,
        })),
      ];
      await dependencies.store.write(tag, ANSWER_WORDS_VERSION, rows);
      const cached = cache.get(tag);
      if (cached !== undefined) {
        for (const row of rows) {
          cached.settled.add(row.source);
          if (row.status === "ACCEPTED")
            cached.accepted.set(row.source, row.text);
        }
      }
    }
  }

  return async (language, lines, attribution) => {
    const info = languageInfo(language);
    if (info === null || info.primary === "en") return new Map();
    const cached = await read(info.tag);
    const missing = [...new Set(lines)].filter(
      (line) => !cached.settled.has(line),
    );
    if (missing.length > 0) {
      const key = `${info.tag}\u0000${missing.join("\u0001")}`;
      const pass =
        inFlight.get(key) ??
        translateMissing(info.tag, missing, attribution).finally(() => {
          inFlight.delete(key);
        });
      inFlight.set(key, pass);
      await Promise.race([
        pass.catch(() => undefined),
        new Promise((resolve) => setTimeout(resolve, deadlineMs)),
      ]);
    }
    const accepted = (cache.get(info.tag) ?? cached).accepted;
    return new Map(
      lines.flatMap((line) => {
        const text = accepted.get(line);
        return text === undefined ? [] : [[line, text] as const];
      }),
    );
  };
}

/**
 * The answer path: each text's sentences lifted to skeletons (q-core),
 * the skeletons through `translateLines`, and the data put back. One path
 * for every language; nothing here knows any language's grammar.
 */
export function createAnswerWords(dependencies: {
  readonly translateLines: TranslateLines;
  readonly logger?: Logger | undefined;
}): AnswerWords {
  return {
    localise: async (language, texts, attribution) => {
      const info = languageInfo(language);
      const none = texts.map(() => null);
      if (info === null || info.primary === "en") return none;
      const asked = texts.slice(0, MAX_TEXTS);
      const skeletons = [
        ...new Set(asked.flatMap((text) => [...answerSkeletons(text)])),
      ].filter((skeleton) => skeleton.length <= MAX_SKELETON_CHARS);
      try {
        const translated = await dependencies.translateLines(
          info.tag,
          skeletons,
          attribution,
        );
        return texts.map((text, i) =>
          i < MAX_TEXTS ? localisedAnswer(text, translated) : null,
        );
      } catch (error: unknown) {
        dependencies.logger?.warn(
          { err: error, language: info.tag },
          "answer words stay English: translation failed",
        );
        return none;
      }
    },
  };
}

export type AnswerWordsRoutesDependencies = ActorContextDependencies & {
  readonly identity?: QVoiceRoutesDependencies["identity"] | undefined;
  readonly answerWords: AnswerWords;
  /** The person's own saved language; null for none (English stands). */
  readonly languageOf: (actor: {
    readonly tenantId: string;
    readonly userId: string;
  }) => Promise<string | null>;
};

/** `POST /v1/q/words`: words stored for this person, in their own language. */
export function registerAnswerWordsRoutes(
  app: FastifyInstance,
  dependencies: AnswerWordsRoutesDependencies,
): void {
  const identity = dependencies.identity;
  const withContext =
    identity === undefined
      ? requireActorContextHook(dependencies)
      : requireActorContextOrPersonalHook({ ...dependencies, identity });
  app.post(Q_WORDS_PATH, { onRequest: withContext }, async (request, reply) => {
    const parsed = QWordsRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      const problem = createProblemDetails({
        code: "INVALID_REQUEST",
        requestId: request.id,
        detail: "Up to 40 short texts can be put in your language at once.",
      });
      return reply
        .status(problem.status)
        .type(PROBLEM_CONTENT_TYPE)
        .send(problem);
    }
    const actor = getActorContext(request);
    // Their own saved language, never one the request names: a client
    // cannot make Q translate into whatever it likes.
    const language = await dependencies
      .languageOf({ tenantId: actor.tenantId, userId: actor.userId })
      .catch(() => null);
    const texts =
      language === null
        ? parsed.data.texts.map(() => null)
        : await dependencies.answerWords.localise(language, parsed.data.texts, {
            tenantId: actor.tenantId,
            userId: actor.userId,
            correlationId: `answer-words:${request.id}`,
            purpose: "OTHER",
          });
    void reply.header("Cache-Control", "no-store");
    return QWordsDtoSchema.parse({ language, texts });
  });
}
