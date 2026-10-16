import "server-only";

import {
  ApiProblemError,
  getReadiness,
  localiseWords,
} from "@capital-q/api-client";
import type { ReadinessDto } from "@capital-q/contracts";

import { serverUiLanguage } from "@/features/i18n/server";
import { apiSession, qApiSession } from "@/features/q/context";

/**
 * The founder's own readiness, read under their session. Null: not a
 * founder of a company (the API's 404) or it could not be read; the page
 * then says so in one sentence rather than showing an empty diagnosis.
 */
export async function ownReadiness(): Promise<ReadinessDto | null> {
  const session = await apiSession();
  if (session === null) return null;
  try {
    return await inTheirLanguage(await getReadiness(session));
  } catch (error: unknown) {
    if (error instanceof ApiProblemError) return null;
    return null;
  }
}

/**
 * The questions Q stored for them, in the language they chose (any
 * language): each question, why Q asks and its quick answers go through
 * Q's shared translation layer, names and figures kept as recorded. A
 * quick answer is chosen by its position, so its words may change freely.
 * Anything not translated, or any failure, stays as stored.
 */
async function inTheirLanguage(readiness: ReadinessDto): Promise<ReadinessDto> {
  if (readiness.followUps.length === 0) return readiness;
  const language = await serverUiLanguage();
  if (language === "en" || language.startsWith("en-")) return readiness;
  const session = await qApiSession();
  if (session === null) return readiness;
  const shown = readiness.followUps.slice(0, 6);
  const texts = shown.flatMap((followUp) => [
    followUp.question,
    followUp.why ?? "",
    ...followUp.quickAnswers,
  ]);
  const asked = texts.filter((text) => text.length > 0).slice(0, 40);
  const said = await localiseWords(session, asked).catch(() => null);
  if (said === null) return readiness;
  const words = new Map<string, string>();
  asked.forEach((text, i) => {
    const translated = said.texts[i];
    if (translated !== null && translated !== undefined)
      words.set(text, translated);
  });
  const put = (text: string) => words.get(text) ?? text;
  return {
    ...readiness,
    followUps: readiness.followUps.map((followUp) => ({
      ...followUp,
      question: put(followUp.question).slice(0, 500),
      why: followUp.why === null ? null : put(followUp.why).slice(0, 500),
      quickAnswers: followUp.quickAnswers.map((answer) =>
        put(answer).slice(0, 120),
      ),
    })),
  };
}
