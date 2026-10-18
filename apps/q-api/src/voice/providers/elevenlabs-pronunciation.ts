import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

import type { Logger } from "@capital-q/observability";

import {
  tidyPronunciation,
  type PronunciationTeacher,
} from "../pronunciation.js";

/**
 * ElevenLabs pronunciation dictionaries as the teacher. One dictionary for
 * the environment (names are pronounced the same for everyone), found by
 * name or created on first use; each correction adds an alias rule and
 * points both Speech Engines at the new version. Applies to sessions that
 * start afterwards; the current one keeps its dictionary.
 */

const DICTIONARY_NAME = "capital-q-voice";

export function createElevenLabsPronunciationTeacher(options: {
  readonly apiKey: string;
  readonly engineIds: readonly string[];
  readonly logger: Logger;
}): PronunciationTeacher {
  const client = new ElevenLabsClient({ apiKey: options.apiKey });
  const { logger } = options;
  let dictionaryId: string | undefined;

  const findDictionary = async (): Promise<string | undefined> => {
    if (dictionaryId !== undefined) return dictionaryId;
    const listed = await client.pronunciationDictionaries.list({});
    const found = listed.pronunciationDictionaries.find(
      (d) => d.name === DICTIONARY_NAME,
    );
    dictionaryId = found?.id;
    return dictionaryId;
  };

  return {
    teach: async (input) => {
      const tidy = tidyPronunciation(input);
      if (tidy === null) return false;
      const rule = {
        type: "alias" as const,
        stringToReplace: tidy.term,
        alias: tidy.sayAs,
      };
      try {
        let versionId: string;
        const existing = await findDictionary();
        if (existing === undefined) {
          const created =
            await client.pronunciationDictionaries.createFromRules({
              name: DICTIONARY_NAME,
              description:
                "Names and terms as the people of Capital Q say them.",
              rules: [rule],
            });
          dictionaryId = created.id;
          versionId = created.versionId;
        } else {
          const added = await client.pronunciationDictionaries.rules.add(
            existing,
            { rules: [rule] },
          );
          versionId = added.versionId;
        }
        const id = dictionaryId;
        if (id === undefined) return false;
        for (const engineId of options.engineIds) {
          await client.speechEngine.update(engineId, {
            tts: {
              pronunciationDictionaryLocators: [
                { pronunciationDictionaryId: id, versionId },
              ],
            },
          });
        }
        logger.info(
          { term: tidy.term, engines: options.engineIds.length },
          "pronunciation taught",
        );
        return true;
      } catch (error: unknown) {
        logger.warn(
          { err: error, term: tidy.term },
          "pronunciation not applied",
        );
        return false;
      }
    },
  };
}
