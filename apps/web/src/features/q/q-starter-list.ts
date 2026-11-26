/**
 * The empty Q home's starters as data (client 2026-11-05, "like ChatGPT"):
 * at most three rows under the composer, each a small icon and a line. A
 * row asks Q something or goes somewhere real; nothing here answers or
 * simulates. No React and no icons here, so the Q pane's server-rendered
 * placeholder can lay the rows out without loading the conversation's code.
 */
export type QStarter = {
  readonly id: string;
  readonly label: string;
  readonly icon: "ask" | "setup" | "verify" | "persona";
} & (
  | { readonly kind: "ASK"; readonly prompt: string }
  | { readonly kind: "GO"; readonly href: string }
);

/** The most a home shows: the composer is the point, not a menu. */
export const MAX_STARTERS = 3;

/** The empty home's line over the composer when the server gave none. */
export const DEFAULT_GREETING = "What's on your mind today?";

/**
 * Starters first (what genuinely waits on the person), then the surface's
 * suggested questions, to three in all.
 */
export function startersOf(
  given: readonly QStarter[],
  suggestions: readonly string[],
): readonly QStarter[] {
  const asks: QStarter[] = suggestions.map((suggestion) => ({
    id: `ask:${suggestion}`,
    label: suggestion,
    icon: "ask",
    kind: "ASK",
    prompt: suggestion,
  }));
  return [...given, ...asks].slice(0, MAX_STARTERS);
}
