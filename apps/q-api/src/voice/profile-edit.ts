/**
 * Changing your own details by saying so.
 *
 * "Change my website to vaultlyne.com", "we're based in Lagos", "call me
 * Dan". Read deterministically from the person's words, read back for
 * confirmation, then performed by the platform's own API under their own
 * authority — the same shape as the visibility change next door, for the
 * same reason: a consequential change is proposed, approved and then
 * executed, never inferred and applied.
 *
 * Only their own. There is no field here that names somebody else, no way
 * to say whose profile is being edited, and the API the change goes
 * through resolves the subject from the caller's own session. A sentence
 * about another company is simply not a match.
 *
 * The words are DATA. This reads them; it never obeys them.
 */

/** What a person may change about themselves and their own company. */
export const PROFILE_FIELDS = [
  /** What to call them. Their own, never anybody else's. */
  "displayName",
  "companyName",
  "websiteUrl",
  "headquartersCity",
  "shortDescription",
] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];

export type SpokenProfileEdit = {
  readonly field: ProfileField;
  /** Exactly what they said the value should be, trimmed. Never invented. */
  readonly value: string;
};

/**
 * How the person refers to the thing being changed, and the longest a
 * spoken value may sensibly be. A value longer than this is a sentence
 * about the field rather than the field, and guessing which part was meant
 * is how a profile gets filled with someone's train of thought.
 */
const VALUE_MAX = 160;

type Rule = {
  readonly field: ProfileField;
  readonly pattern: RegExp;
  /** Cleans the captured value; returns null when what was captured is not a value. */
  readonly clean?: (raw: string) => string | null;
};

/** Trailing politeness and punctuation a person speaks but does not mean. */
const TAIL =
  /[\s,.;!?]*(?:please|thanks|thank you|instead|now|for me|if you can|would you)?[\s,.;!?]*$/i;

/**
 * The value is what they said next, not the rest of the paragraph.
 *
 * Caught live: "My name is Daniel. I run a company and we are raising"
 * became a request to be called "Daniel. I run a company and we are
 * raising", because the capture ran to the end of the utterance. A value
 * ends where the sentence does.
 */
function firstSentence(raw: string): string {
  const end = /[.!?…]\s+\S/.exec(raw);
  return end === null ? raw : raw.slice(0, end.index + 1);
}

function tidy(raw: string): string | null {
  const value = firstSentence(raw)
    .replace(TAIL, "")
    .trim()
    .replace(/[.,;:!?]+$/, "");
  if (value.length === 0 || value.length > VALUE_MAX) {
    return null;
  }
  return value;
}

/**
 * A spoken web address. Speech recognisers write "vaultlyne dot com" and
 * "www dot vaultlyne dot com" as often as they write the domain, so both
 * are accepted and normalised; anything that still is not a hostname is
 * refused rather than guessed at.
 */
function tidyUrl(raw: string): string | null {
  const spoken = firstSentence(raw)
    .replace(TAIL, "")
    .trim()
    .toLowerCase()
    .replace(/\s+dot\s+/g, ".")
    .replace(/\s+slash\s+/g, "/")
    .replace(/\s+/g, "");
  if (spoken.length === 0 || spoken.length > VALUE_MAX) {
    return null;
  }
  const withoutScheme = spoken.replace(/^https?:\/\//, "");
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/[^\s]*)?$/.test(withoutScheme)) {
    return null;
  }
  return `https://${withoutScheme}`;
}

const CHANGE = String.raw`(?:change|update|set|correct|fix|make)`;
const MINE = String.raw`(?:my|our|the)`;

const RULES: readonly Rule[] = [
  {
    field: "websiteUrl",
    pattern: new RegExp(
      String.raw`\b(?:${CHANGE}\s+)?${MINE}\s+(?:website|site|web ?site|url|domain)\s+(?:is|to|should be|should say)\s+(.+)$`,
      "i",
    ),
    clean: tidyUrl,
  },
  {
    field: "displayName",
    pattern: new RegExp(
      String.raw`\b(?:(?:please\s+)?call me|my name is|i'?m called|${CHANGE}\s+my name to|my name should be)\s+(.+)$`,
      "i",
    ),
  },
  {
    field: "companyName",
    pattern: new RegExp(
      String.raw`\b(?:${CHANGE}\s+)?${MINE}\s+(?:company|business|startup|organisation|organization)(?:'s)?\s+name\s+(?:is|to|should be)\s+(.+)$`,
      "i",
    ),
  },
  {
    field: "headquartersCity",
    pattern: new RegExp(
      String.raw`\b(?:we(?:'re| are)\s+(?:based|headquartered|located)\s+in|${MINE}\s+(?:head ?office|headquarters|hq|city)\s+(?:is in|is|to)|${CHANGE}\s+${MINE}\s+city\s+to)\s+(.+)$`,
      "i",
    ),
  },
  {
    field: "shortDescription",
    pattern: new RegExp(
      String.raw`\b(?:${CHANGE}\s+)?${MINE}\s+(?:description|summary|one[- ]liner|tagline|blurb)\s+(?:is|to|should be|should say)\s+(.+)$`,
      "i",
    ),
  },
];

/**
 * What the person asked to change, or null when nothing was asked.
 *
 * Deliberately narrow. A question ABOUT a field ("what is my website?") has
 * no value after "is to"/"should be" and does not match; a sentence that
 * merely mentions a website does not match either. Silence is the right
 * answer whenever the reading is not obvious, because the cost of a wrong
 * match is Q offering to change something nobody asked about.
 */
export function spokenProfileEdit(text: string): SpokenProfileEdit | null {
  const line = text.trim();
  if (line.length === 0) {
    return null;
  }
  for (const rule of RULES) {
    const found = rule.pattern.exec(line);
    const captured = found?.[1];
    if (captured === undefined) {
      continue;
    }
    const value = (rule.clean ?? tidy)(captured);
    if (value === null) {
      continue;
    }
    return { field: rule.field, value };
  }
  return null;
}

const FIELD_WORDS: Readonly<Record<ProfileField, string>> = {
  displayName: "what I call you",
  companyName: "your company's name",
  websiteUrl: "your website",
  headquartersCity: "where you're based",
  shortDescription: "your description",
};

/** Read back, so the change is approved rather than assumed. */
export function profileEditQuestion(edit: SpokenProfileEdit): string {
  return `I'll set ${FIELD_WORDS[edit.field]} to ${edit.value}. Shall I?`;
}

export function profileEditDone(edit: SpokenProfileEdit): string {
  return `Done. ${FIELD_WORDS[edit.field]} is now ${edit.value}.`;
}
