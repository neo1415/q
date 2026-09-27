/**
 * Compare from Saved (doc 10 §9, §15.1 step 6): an investor picks 2 to 5
 * saved companies and Q compares them. Q builds the comparison from what
 * it may read; missing values stay missing (doc 10 §15). This module only
 * words the question the person sends, as a draft they can edit.
 */
export const COMPARE_MIN = 2;
export const COMPARE_MAX = 5;

export function canCompare(count: number): boolean {
  return count >= COMPARE_MIN && count <= COMPARE_MAX;
}

function listed(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;
}

/** "Compare Acme and Beta against my mandate." — never more than five. */
export function compareQuestion(names: readonly string[]): string {
  const chosen = names.slice(0, COMPARE_MAX);
  return `Compare ${listed(chosen)} against my mandate. Keep anything not on record as not stated.`;
}

/** Selection with a ceiling: a sixth pick is refused, not silently swapped. */
export function toggleSelection(
  selected: readonly string[],
  id: string,
): readonly string[] {
  if (selected.includes(id)) return selected.filter((item) => item !== id);
  if (selected.length >= COMPARE_MAX) return selected;
  return [...selected, id];
}
