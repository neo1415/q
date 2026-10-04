import type { AnyAppAction } from "./define.js";
import { OWN_READ_KINDS, type OwnReadKind } from "./reads.js";
import type { ReferenceKind } from "./references.js";

/**
 * The parity eval's cases (ADR 0040 §3), generated from the registry: for
 * every declared action, its two phrasings with a real record's name and
 * one with that name misheard; for every read kind, two questions. The
 * runner (scripts/evals/q-parity) sends each as the eval account and checks
 * the right tool acted or the right read was answered. Pure: no calls.
 */

export type ParityExpectation =
  | {
      readonly kind: "ACTION";
      readonly action: string;
      readonly tool: string;
      readonly orSays?: string | undefined;
    }
  | {
      readonly kind: "READ";
      readonly read: OwnReadKind;
      readonly mentions: string;
    };

export type ParityCase = {
  readonly id: string;
  readonly say: string;
  readonly variant: "PHRASING_1" | "PHRASING_2" | "MISHEARD";
  readonly expect: ParityExpectation;
};

/**
 * A deterministic mishearing: one letter dropped from the longest word of
 * the name proper. A parenthetical ("(fictional)") is never the word
 * misheard: misspelling it would not test the matcher (lead 2026-10-03).
 */
export function misheard(name: string): string {
  const words = name.split(/\s+/);
  const proper = (word: string) => !/^\(.*\)?$/.test(word);
  let longest = words.findIndex(proper);
  if (longest === -1) longest = 0;
  words.forEach((word, index) => {
    if (proper(word) && word.length > (words[longest]?.length ?? 0)) {
      longest = index;
    }
  });
  const word = words[longest] ?? name;
  if (word.length < 4) return `${name}e`;
  const at = Math.floor(word.length / 2);
  words[longest] = `${word.slice(0, at)}${word.slice(at + 1)}`;
  return words.join(" ");
}

const READ_QUESTIONS: Readonly<Record<OwnReadKind, readonly [string, string]>> =
  {
    media: ["What pitch videos do I have?", "Can investors play my pitch?"],
    documents: ["What documents have you made for me?", "List my documents."],
    rehearsals: ["How did my rehearsals go?", "Have I rehearsed with anyone?"],
    // "What's in my Discover feed?" reads as "open Discover" (parity eval
    // 2026-10-02), which is a fair reading; these ask for the names.
    feed: [
      "Which companies are in my Discover feed?",
      "Name the companies in my feed right now.",
    ],
    calls: [
      "What did we agree on my last call?",
      "What follow-ups came out of my call?",
    ],
    uploads: ["Which files have I uploaded?", "Have I uploaded my deck?"],
    capital: ["How much have I raised?", "What's left in my current round?"],
    diligence: [
      "What documents have they asked for in diligence?",
      "Which diligence requests are still open?",
    ],
  };

export function parityCases(
  actions: readonly AnyAppAction[],
  /** One real record name per kind on the eval account. */
  names: Partial<Readonly<Record<ReferenceKind, string>>>,
  reads: Partial<Readonly<Record<OwnReadKind, string>>> = {},
): readonly ParityCase[] {
  const cases: ParityCase[] = [];
  for (const action of actions) {
    const tool = action.tool;
    // An action Q still does through its hand-written tool is not yet the
    // registry's to evaluate (its eval comes with the tool's migration).
    if (tool === undefined) continue;
    const kind = tool.eval.names;
    const name = kind === undefined ? undefined : names[kind];
    if (kind !== undefined && name === undefined) continue;
    const fill = (template: string, value: string | undefined) =>
      value === undefined ? template : template.replaceAll("{name}", value);
    const expect: ParityExpectation = {
      kind: "ACTION",
      action: action.name,
      tool: tool.name,
      ...(tool.eval.orSays === undefined ? {} : { orSays: tool.eval.orSays }),
    };
    const [first, second] = tool.eval.say;
    cases.push(
      {
        id: `${action.name}#1`,
        say: fill(first, name),
        variant: "PHRASING_1",
        expect,
      },
      {
        id: `${action.name}#2`,
        say: fill(second, name),
        variant: "PHRASING_2",
        expect,
      },
    );
    if (name !== undefined) {
      cases.push({
        id: `${action.name}#misheard`,
        say: fill(first, misheard(name)),
        variant: "MISHEARD",
        expect,
      });
    }
  }
  for (const read of OWN_READ_KINDS) {
    const mentions = reads[read];
    if (mentions === undefined) continue;
    const [first, second] = READ_QUESTIONS[read];
    cases.push(
      {
        id: `read_my.${read}#1`,
        say: first,
        variant: "PHRASING_1",
        expect: { kind: "READ", read, mentions },
      },
      {
        id: `read_my.${read}#2`,
        say: second,
        variant: "PHRASING_2",
        expect: { kind: "READ", read, mentions },
      },
    );
  }
  return cases;
}

/** Model calls per case: the turn reader and the answer (own-standing reads are tools, not models). */
export const MODEL_CALLS_PER_CASE = 2;
