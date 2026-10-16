import {
  qUiTextPath,
  QUiTextDtoSchema,
  Q_STANDING_LANGUAGE_PATH,
  Q_STANDING_PATH,
  Q_STANDING_PERSONALITY_PATH,
  QStandingDtoSchema,
  Q_WORDS_PATH,
  QWordsDtoSchema,
  type QLanguagePreference,
  type QPersonality,
} from "@capital-q/contracts";

import { call, type ApiSession } from "./request.js";

/** The person's own Q personality and whether Q paused the account. A Q API session. */
export function getQStanding(session: ApiSession) {
  return call(session, "GET", Q_STANDING_PATH, QStandingDtoSchema);
}

/** The person chooses who Q is with them. */
export function setQPersonality(
  session: ApiSession,
  personality: QPersonality,
) {
  return call(session, "PUT", Q_STANDING_PERSONALITY_PATH, QStandingDtoSchema, {
    body: { personality },
  });
}

/** The person chooses the language Q uses with them (multilingual Q). */
export function setQLanguage(
  session: ApiSession,
  language: QLanguagePreference,
) {
  return call(session, "PUT", Q_STANDING_LANGUAGE_PATH, QStandingDtoSchema, {
    body: { language },
  });
}

/**
 * The interface's machine translations for a language (any-language
 * interface): what is cached so far; the server translates the rest in the
 * background. A Q API session.
 */
export function getUiText(session: ApiSession, language: string) {
  return call(session, "GET", qUiTextPath(language), QUiTextDtoSchema);
}

/**
 * Words Capital Q stored for this person, in their chosen language: null
 * entries stay English. A Q API session.
 */
export function localiseWords(session: ApiSession, texts: readonly string[]) {
  return call(session, "POST", Q_WORDS_PATH, QWordsDtoSchema, {
    body: { texts: [...texts] },
  });
}
