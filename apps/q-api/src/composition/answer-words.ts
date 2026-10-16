import type { FastifyInstance } from "fastify";

import {
  createProblemDetails,
  PROBLEM_CONTENT_TYPE,
  Q_WORDS_PATH,
  QWordsDtoSchema,
  QWordsRequestSchema,
  type ModelAttribution,
} from "@capital-q/contracts";
import { languageInfo } from "@capital-q/q-core/language";
import { answerSkeletons, localisedAnswer } from "@capital-q/q-core/ui-text";

import {
  getActorContext,
  requireActorContextHook,
  requireActorContextOrPersonalHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";
import type { QVoiceRoutesDependencies } from "../voice/routes.js";

import type { TranslateLines, TranslateLinesOptions } from "./ui-text.js";

/**
 * Words Q writes by code, in the person's language (owner directive
 * 2026-10-16: any language, no per-language hand work). The answers Q
 * composes without a model (what needs them, a person or company looked
 * up, fit, their mandate, investors who could fit) and the questions Q
 * stored for them go through lane lang's `translateLines` (ui-text.ts): the
 * same UI_TRANSLATION gateway class, store and daily cap as the interface.
 *
 * Only a sentence's skeleton is ever translated: q-core lifts every name,
 * figure, currency code, quote and address out first, so no person's data
 * reaches the translator or the shared cache, and what was recorded comes
 * back exactly. A skeleton is translated once per language and reused for
 * everyone. When a sentence has no translation in time (first sight,
 * budget spent, provider down), the text stays in English: never half one
 * language, never a guess.
 */

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
    attribution: Omit<ModelAttribution, "correlationId" | "purpose">,
    options?: TranslateLinesOptions,
  ) => Promise<readonly (string | null)[]>;
};

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
    localise: async (language, texts, attribution, options) => {
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
          options,
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
          });
    void reply.header("Cache-Control", "no-store");
    return QWordsDtoSchema.parse({ language, texts });
  });
}
