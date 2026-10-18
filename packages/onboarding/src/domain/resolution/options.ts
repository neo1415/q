import type { OnboardingOptionView } from "@capital-q/contracts";

import { affirmativeText, negatedMention } from "../negation.js";
import { mentions, normalise } from "../text.js";

/**
 * Canonical option resolution for a definition's own vocabulary
 * (CQ-Q-VOICE-001 A §5): the one place a sentence is matched against a
 * step's options, in this order and no other —
 *
 *   1. the whole sentence IS a label, an option key or an alias (exact)
 *   2. a label, key or alias occurs as whole words (mention)
 *
 * — with negation and scope applied (a mention only in a negated span is
 * not a match), and with the nested-phrase rule (a phrase that only occurs
 * inside another matched option's phrase is that option's words). Semantic
 * candidates and model choice are deliberately absent here: an option
 * vocabulary is small and named, so bounded scoring is the whole rung.
 *
 * Journeys widen recognition with alias tables; the runtime never guesses
 * beyond a table it was given, and a model never emits an option key.
 */

export type OptionAliases = Readonly<Record<string, readonly string[]>>;

export type OptionMatch = {
  readonly option: OnboardingOptionView;
  /** The words that matched, normalised. */
  readonly phrases: readonly string[];
  readonly exact: boolean;
};

function namesOf(
  option: OnboardingOptionView,
  aliases: OptionAliases | undefined,
): readonly string[] {
  // A short key ("in", "us", "gb") is a code, not a word a person says;
  // matching it would read "based in Lagos" as India.
  return [
    option.label,
    ...(option.optionKey.length >= 4
      ? [option.optionKey.replace(/_/g, " ")]
      : []),
    ...(aliases?.[option.optionKey] ?? []),
  ];
}

/** Every option the sentence names affirmatively, exact match first. */
export function matchOptions(
  text: string,
  options: readonly OnboardingOptionView[],
  aliases: OptionAliases | undefined,
): readonly OptionMatch[] {
  const exact = normalise(text);
  const affirmed = affirmativeText(text);
  const matched: { option: OnboardingOptionView; phrases: string[] }[] = [];
  for (const option of options) {
    const names = namesOf(option, aliases);
    if (names.some((name) => normalise(name) === exact)) {
      return [{ option, phrases: [exact], exact: true }];
    }
    const phrases = names
      .filter(
        (name) =>
          mentions(affirmed, name) &&
          // Said somewhere affirmatively, and not ONLY where negated.
          !negatedMention(text, name),
      )
      .map((name) => normalise(name));
    if (phrases.length > 0) {
      matched.push({ option, phrases });
    }
  }
  // A phrase that only occurs inside another matched option's phrase is that
  // option's words, not a second answer: "co-invest alongside a lead" names
  // co-investing, not leading, although "lead" is in it.
  return matched
    .filter(({ option, phrases }) =>
      phrases.some(
        (phrase) =>
          !matched.some(
            (other) =>
              other.option !== option &&
              other.phrases.some(
                (outer) =>
                  outer.length > phrase.length &&
                  ` ${outer} `.includes(` ${phrase} `),
              ),
          ),
      ),
    )
    .map(({ option, phrases }) => ({ option, phrases, exact: false }));
}

/** The options only, for callers that need nothing but the choice. */
export function matchedOptions(
  text: string,
  options: readonly OnboardingOptionView[],
  aliases: OptionAliases | undefined,
): readonly OnboardingOptionView[] {
  return matchOptions(text, options, aliases).map((m) => m.option);
}

/**
 * Options the sentence names anywhere, negated or not. Used by exclusion
 * steps, where "we never invest in gambling" is exactly the mention that
 * matters and the person is asked how firmly they mean it.
 */
export function mentionedOptions(
  text: string,
  options: readonly OnboardingOptionView[],
  aliases: OptionAliases | undefined,
): readonly OnboardingOptionView[] {
  return options.filter((option) =>
    namesOf(option, aliases).some((name) => mentions(text, name)),
  );
}
