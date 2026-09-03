/**
 * Deterministic initial slug from a display name.
 *
 * Lowercase ASCII letters, digits and single hyphens; bounded to the
 * database's 80-character rule; never empty. Diacritics are folded
 * (Société → societe); anything else non-ASCII is dropped rather than
 * transliterated by guesswork.
 *
 * The slug is route/display identity only. The UUID remains the canonical
 * identifier, and a later display-name change does not move the slug.
 */
export const SLUG_MAX_LENGTH = 80;
export const SLUG_FALLBACK = "organisation";

export function organisationSlugFromDisplayName(displayName: string): string {
  const folded = displayName
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

  const bounded = folded.slice(0, SLUG_MAX_LENGTH).replace(/-+$/g, "");

  return bounded.length === 0 ? SLUG_FALLBACK : bounded;
}
