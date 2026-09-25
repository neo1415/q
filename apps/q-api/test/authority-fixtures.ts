import type {
  QDelegationReader,
  QTurnAuthority,
} from "@capital-q/model-gateway/q";

/**
 * Capital Q's independent reading of a turn, as a test states it: what the
 * person's latest words establish. The reading itself is a model's; these
 * tests assert what code permits given it.
 */
export function reading(
  partial: {
    readonly stated?: readonly string[];
    readonly declined?: readonly string[];
    readonly handed?: readonly string[];
    readonly approved?: readonly string[];
    readonly finishing?: boolean;
  } = {},
): QTurnAuthority {
  return {
    stated: new Set(partial.stated ?? []),
    declined: new Set(partial.declined ?? []),
    handed: new Set(partial.handed ?? []),
    approved: new Set(partial.approved ?? []),
    finishing: partial.finishing ?? false,
  };
}

/** A reader that always reads the turn this way; `null`: could not read. */
export function readerOf(
  value: QTurnAuthority | null | (() => QTurnAuthority | null),
  heard: { utterance?: string; lastQ?: string }[] = [],
): QDelegationReader {
  return {
    read: (input) => {
      heard.push({ utterance: input.utterance, lastQ: input.lastQ });
      return Promise.resolve(typeof value === "function" ? value() : value);
    },
  };
}
