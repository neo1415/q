/**
 * 2026-10-20 (meetings speed): a guest's self-introduction, read by code.
 *
 * Q asks a guest it does not know to introduce themselves, then puts what
 * they said on the roster. Most answers are plain ("I'm Ada Obi, partner at
 * Acme Capital"), and a model call (one to three seconds) to read them kept
 * Q from moving on. Code reads the plain ones; anything it cannot read a
 * name from goes to the model as before. What is not said stays unknown
 * (null): code never guesses a role or an organisation.
 */

export type Introduction = {
  readonly name: string;
  readonly role: string | null;
  readonly organisation: string | null;
};

/** Capitalised words after "I'm" that are not a name. */
const NOT_A_NAME = new Set([
  "a",
  "an",
  "the",
  "just",
  "really",
  "so",
  "very",
  "not",
  "here",
  "happy",
  "glad",
  "good",
  "fine",
  "great",
  "sorry",
  "joining",
  "from",
  "with",
  "at",
  "calling",
  "excited",
  "pleased",
  "delighted",
  "okay",
  "ok",
  "yes",
  "yeah",
  "sure",
  "q",
  "on",
  "in",
  "also",
  "only",
  "well",
]);

const NAME_WORD = String.raw`[A-Z][\p{L}'’-]+`;
const NAME_JOIN = String.raw`(?:de|da|del|van|von|bin|al|le|la|di)`;
const NAME = new RegExp(
  String.raw`(?:^|[\s,.!?])(?:[Mm]y name(?: is|'s|’s)|[Ii] am|[Ii]'m|[Ii]’m|[Tt]his is|[Ii]t's|[Ii]t’s|[Cc]all me)\s+(${NAME_WORD}(?:\s+(?:${NAME_WORD}|${NAME_JOIN}\s+${NAME_WORD})){0,3})`,
  "u",
);

const ORG_NAME = String.raw`((?:the\s+)?[A-Z0-9][\p{L}\d&.'’-]*(?:\s+(?:[A-Z0-9&][\p{L}\d&.'’-]*|of|and|&)){0,5})`;
const ORG = new RegExp(
  String.raw`\b(?:from|at|with|representing|over at)\s+${ORG_NAME}`,
  "u",
);
/** "the CFO of Nixo Labs": "of" names an organisation only right after a role. */
const ORG_AFTER_ROLE = new RegExp(String.raw`^\s+of\s+${ORG_NAME}`, "u");

const ROLE = new RegExp(
  String.raw`\b((?:co-?\s?founder|founder|ceo|cto|cfo|coo|cmo|managing partner|general partner|venture partner|operating partner|partner|principal|associate|analyst|managing director|director|head of [\p{L}]+(?: [\p{L}]+)?|vice president|vp of [\p{L}]+|vp|investor|angel investor|advisor|adviser|chief [\p{L}]+ officer|president|chair(?:man|woman|person)?|board member|engineer|lawyer|counsel|investment manager|portfolio manager))\b`,
  "iu",
);

const tidy = (value: string) =>
  value
    .replace(/\s+/g, " ")
    .replace(/[\s,.;:!?]+$/u, "")
    .replace(/\s+(?:of|and|&)$/iu, "")
    .trim();

/**
 * The name, role and organisation a person gave for themselves; null when
 * code cannot read a name (the model reads it then).
 */
export function readIntroduction(text: string): Introduction | null {
  const said = text.replace(/\s+/g, " ").trim().slice(0, 600);
  const named = NAME.exec(said);
  if (named?.[1] === undefined) return null;
  // Words after the name that start a new clause are not part of it.
  const words = named[1].split(" ");
  const kept: string[] = [];
  for (const word of words) {
    if (NOT_A_NAME.has(word.toLowerCase().replace(/[’']s$/u, ""))) break;
    kept.push(word);
  }
  const name = tidy(kept.join(" "));
  if (name.length < 2 || NOT_A_NAME.has(name.toLowerCase())) return null;
  const after = said.slice((named.index ?? 0) + named[0].length);
  const org = ORG.exec(after);
  const role = ROLE.exec(after);
  // "the CFO of Nixo Labs": an organisation right after the role.
  const ofRole =
    org === null && role !== null
      ? ORG_AFTER_ROLE.exec(after.slice((role.index ?? 0) + role[0].length))
      : null;
  const found = org?.[1] ?? ofRole?.[1];
  const organisation =
    found === undefined ? null : tidy(found).slice(0, 200) || null;
  return {
    name: name.slice(0, 200),
    role:
      role?.[1] === undefined
        ? null
        : tidy(role[1]).replace(/\s+/g, " ").slice(0, 200),
    organisation,
  };
}
