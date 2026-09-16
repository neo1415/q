import type { PresenceFound } from "./presence-trigger.js";

/**
 * Q showing somebody it already knows who they are.
 *
 * Capital Q looks a person up the moment it has a name and something to
 * tell them apart by. That research was happening in silence: gathered,
 * gated, stored, and never mentioned, so the person had no idea any of it
 * had taken place and no chance to say it was the wrong Daniel.
 *
 * This is the sentence. It says what was found, says where from, and asks
 * one question with two answers. Saying where from is not a courtesy: a
 * system that simply knows things about somebody is unsettling, and a
 * system that says "your site and your LinkedIn say this" is not.
 *
 * Only ever the person's own, and only what the Write Gate accepted.
 */

/** Long enough to be recognisable, short enough to be a spoken sentence. */
const SPOKEN_MAX = 220;

export type Recognition = {
  readonly line: string;
  readonly options: readonly {
    readonly key: string;
    readonly label: string;
  }[];
};

export function recognitionQuestion(found: PresenceFound): Recognition | null {
  const statements = found.statements
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
  if (statements.length === 0) {
    return null;
  }

  // One or two of them, joined as somebody would say them. More than that
  // is a dossier being read out, which is the opposite of reassuring.
  let said = "";
  for (const statement of statements) {
    const next = said.length === 0 ? statement : `${said} ${statement}`;
    if (next.length > SPOKEN_MAX) {
      break;
    }
    said = next;
  }
  if (said.length === 0) {
    said = statements[0]?.slice(0, SPOKEN_MAX) ?? "";
  }
  if (said.length === 0) {
    return null;
  }

  const where = describeDomains(found.domains);
  return {
    line: `Before we go on — I had a look at what's public under your name${where}. ${ensureStop(said)} Have I got the right person?`,
    options: [
      { key: "yes", label: "That's me" },
      { key: "no", label: "That's someone else" },
    ],
  };
}

/** What Q says when somebody says it has the wrong person. */
export const WRONG_PERSON_LINE =
  "Thanks for saying so, I'll leave that out. Nothing of it is yours and I won't use it. Let's carry on.";

/** What Q says when it has the right one. */
export const RIGHT_PERSON_LINE =
  "Good, that helps. I'll keep it in mind as we go.";

function describeDomains(domains: readonly string[]): string {
  const named = domains
    .filter((domain) => domain.trim().length > 0)
    .slice(0, 2);
  if (named.length === 0) {
    return "";
  }
  if (named.length === 1) {
    return ` on ${named[0] ?? ""}`;
  }
  return ` on ${named[0] ?? ""} and ${named[1] ?? ""}`;
}

function ensureStop(text: string): string {
  return /[.!?…]$/.test(text) ? text : `${text}.`;
}
