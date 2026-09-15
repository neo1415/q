import type { Logger } from "@capital-q/observability";

/**
 * Teaching Q how to say a name (CQ-Q-VOICE-001 rework). When a person
 * corrects a pronunciation ("it's vault-line"), the correction becomes a
 * rule the speech provider applies from then on. The port is provider-
 * neutral; the ElevenLabs adapter lives with the other vendor code.
 *
 * Rules are plain aliases (how to spell the sound), never phonemes the
 * person did not give, and never anything but a name or a term.
 */

export type PronunciationTeacher = {
  /** Record that `term` is said as `sayAs`. Returns false when it could not be applied. */
  readonly teach: (input: {
    readonly term: string;
    readonly sayAs: string;
  }) => Promise<boolean>;
};

const TERM_MAX = 60;

/** Bound and tidy a correction before it reaches any provider. */
export function tidyPronunciation(input: {
  readonly term: string;
  readonly sayAs: string;
}): { readonly term: string; readonly sayAs: string } | null {
  const term = input.term.trim().replace(/\s+/g, " ").slice(0, TERM_MAX);
  const sayAs = input.sayAs.trim().replace(/\s+/g, " ").slice(0, TERM_MAX);
  if (term.length < 2 || sayAs.length < 2) {
    return null;
  }
  if (!/^[\p{L}\p{N}][\p{L}\p{N}\s'.-]*$/u.test(term)) {
    return null;
  }
  if (!/^[\p{L}\p{N}][\p{L}\p{N}\s'.-]*$/u.test(sayAs)) {
    return null;
  }
  return { term, sayAs };
}

/** A teacher that only logs: for environments without a speech provider. */
export function createLoggingPronunciationTeacher(
  logger: Logger,
): PronunciationTeacher {
  return {
    teach: (input) => {
      logger.info(
        { term: input.term, sayAs: input.sayAs },
        "pronunciation noted (no provider to teach)",
      );
      return Promise.resolve(false);
    },
  };
}
