import type { QConversationMessage } from "@capital-q/q-runtime";

const words = (text: string): string =>
  text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();

const PRONOUN =
  /\b(?:they|them|their|theirs|those|it|its|that company|that business)\b/iu;

/** The company on screen (the conversation's subject), as the plan admits it. */
export type SelectedCompany = {
  readonly companyId: string;
  /** Its canonical name when read this turn; null when unknown. */
  readonly name: string | null;
  /** The person's own company (a founder on their own record). */
  readonly own: boolean;
};

type Turn = {
  readonly asked: QConversationMessage;
  readonly answer: QConversationMessage;
};

/** The immediately preceding exchange, when it is one run's ask and answer. */
function lastTurn(history: readonly QConversationMessage[]): Turn | null {
  const answer = history.at(-1);
  if (answer?.role !== "Q") return null;
  const asked = history.at(-2);
  if (asked?.role !== "USER" || asked.runId !== answer.runId) return null;
  return { asked, answer };
}

/**
 * The one public target the person named in that turn and its answer
 * actually sourced. A page title supplies no new authority: it must quote
 * the person's exact words; two candidates are ambiguous.
 */
function namedTarget(turn: Turn): string | null {
  const userWords = ` ${words(turn.asked.content)} `;
  const candidates = new Map<string, string>();
  for (const block of turn.answer.blocks ?? []) {
    if (block.kind !== "PUBLIC_SOURCE" || block.title === null) continue;
    // Common source-title suffixes are presentation, never target identity.
    const title = block.title.split(/\s*[|:]\s*/u)[0]?.trim() ?? "";
    const key = words(title);
    if (title.length < 3 || title.length > 120 || key.split(" ").length < 2)
      continue;
    if (userWords.includes(` ${key} `)) candidates.set(key, title);
  }
  if (candidates.size !== 1) return null;
  return candidates.values().next().value ?? null;
}

/** That turn was about this company: Q referenced it, or the person named it. */
function turnIsAbout(turn: Turn | null, company: SelectedCompany): boolean {
  if (turn === null) return false;
  const referenced = (turn.answer.blocks ?? []).some(
    (block) =>
      block.kind === "COMPANY_REFERENCE" &&
      block.companyId === company.companyId,
  );
  if (referenced) return true;
  if (company.name === null) return false;
  const key = words(company.name);
  return (
    key.length > 0 && ` ${words(turn.asked.content)} `.includes(` ${key} `)
  );
}

/**
 * Who "they" is in a public-research follow-up (lead decision 2026-10-15):
 *
 * 1. When the person's last turn named a different public company (sourced
 *    by its answer, see namedTarget), "they" is that company -- even with
 *    another company selected. Research is GENERAL: nothing attaches to
 *    the selected company or its Evidence.
 * 2. Otherwise "they" is the selected company: null, the ordinary path,
 *    which researches the conversation's subject.
 * 3. Never their own company unless it is the subject of the last turn: a
 *    founder on their own record whose last turn was not about it gets
 *    GENERAL research on their words, attributed to no one.
 *
 * A turn the reader read as naming someone else, or words with no
 * pronoun, are the ordinary path's.
 */
export function publicResearchFollowUp(input: {
  readonly history: readonly QConversationMessage[];
  readonly question: string;
  readonly aboutNamedOther: boolean;
  readonly selected: SelectedCompany | null;
}): {
  readonly query: string;
  readonly entityName?: string;
  readonly target: "GENERAL";
} | null {
  if (input.aboutNamedOther || !PRONOUN.test(input.question)) return null;
  const question = input.question.trim();
  const turn = lastTurn(input.history);
  const named = turn === null ? null : namedTarget(turn);
  const selected = input.selected;
  const sameAsSelected =
    named !== null &&
    selected !== null &&
    selected.name !== null &&
    words(selected.name) === words(named);
  if (turn !== null && named !== null && !sameAsSelected) {
    // Keep the comparative purpose only when the person actually asked it.
    const competitors = /\bcompetitors\b/iu.test(turn.asked.content)
      ? "competitors "
      : "";
    return {
      target: "GENERAL",
      entityName: named,
      query: `${named} ${competitors}${question}`.slice(0, 200),
    };
  }
  if (selected !== null && selected.own && !turnIsAbout(turn, selected)) {
    return { target: "GENERAL", query: question.slice(0, 200) };
  }
  return null;
}

/**
 * A pronoun question straight after an answer drawn from public sources
 * ("what did those sources say about their funding?"): a follow-up on what
 * was just found, answered from what this person already read rather than
 * by a fresh search started ahead of the model (owner 2026-10-23).
 */
export function followsUpPublicSources(input: {
  readonly history: readonly QConversationMessage[];
  readonly question: string;
  readonly aboutNamedOther: boolean;
}): boolean {
  if (input.aboutNamedOther || !PRONOUN.test(input.question)) return false;
  const turn = lastTurn(input.history);
  return (
    turn !== null &&
    (turn.answer.blocks ?? []).some((block) => block.kind === "PUBLIC_SOURCE")
  );
}

/**
 * Whether every word of a name was said in this conversation, by the person
 * or by Q to them. A public search may carry only those words or an
 * authorised public identity (CQ-Q-RESEARCH-001 §9), so a name the reader
 * gave that nobody said is never looked up; one they pointed at ("the top
 * one", after Q's list) is.
 */
export function namedInTheirWords(
  name: string,
  theirWords: readonly string[],
): boolean {
  const tokens = (text: string) =>
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((token) => token.length > 0);
  const said = new Set(theirWords.flatMap(tokens));
  const wanted = tokens(name);
  return wanted.length > 0 && wanted.every((token) => said.has(token));
}
