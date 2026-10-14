import type { QConversationMessage } from "@capital-q/q-runtime";

const words = (text: string): string =>
  text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();

/**
 * A pronoun-only public-research follow-up can retain the target the person
 * explicitly named and the immediately preceding answer actually sourced.
 * A page title supplies no new authority: it must quote the person's exact
 * words. Ambiguous titles, a different named target or a changed company
 * focus leave the ordinary research path alone.
 */
export function publicResearchFollowUp(input: {
  readonly history: readonly QConversationMessage[];
  readonly question: string;
  readonly aboutNamedOther: boolean;
  readonly selectedCompany: boolean;
}): {
  readonly query: string;
  readonly entityName: string;
  readonly target: "GENERAL";
} | null {
  if (
    input.aboutNamedOther ||
    input.selectedCompany ||
    !/\b(?:they|them|their|those|that company|that business)\b/iu.test(
      input.question,
    )
  )
    return null;
  const previous = input.history.at(-1);
  if (previous?.role !== "Q") return null;
  const asked = input.history.at(-2);
  if (asked?.role !== "USER" || asked.runId !== previous.runId) return null;
  const userWords = ` ${words(asked.content)} `;
  const candidates = new Map<string, string>();
  for (const block of previous.blocks ?? []) {
    if (block.kind !== "PUBLIC_SOURCE" || block.title === null) continue;
    // Common source-title suffixes are presentation, never target identity.
    const title = block.title.split(/\s*[|:]\s*/u)[0]?.trim() ?? "";
    const key = words(title);
    if (title.length < 3 || title.length > 120 || key.split(" ").length < 2)
      continue;
    if (userWords.includes(` ${key} `)) candidates.set(key, title);
  }
  if (candidates.size !== 1) return null;
  const entityName = candidates.values().next().value;
  if (entityName === undefined) return null;
  // Keep the comparative purpose only when the person actually asked it.
  const competitors = /\bcompetitors\b/iu.test(asked.content)
    ? "competitors "
    : "";
  return {
    target: "GENERAL",
    entityName,
    query: `${entityName} ${competitors}${input.question.trim()}`.slice(0, 200),
  };
}
