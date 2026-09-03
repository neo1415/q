/**
 * Deterministic company slug from the canonical name.
 *
 * Lowercase ASCII letters, digits and single hyphens; bounded to the
 * database's 80-character rule; never empty. Diacritics are folded; other
 * non-ASCII is dropped rather than transliterated by guesswork.
 *
 * Routing/presentation identity only. The UUID is canonical, and a later
 * name change does not move the slug.
 */
export const COMPANY_SLUG_MAX_LENGTH = 80;
export const COMPANY_SLUG_FALLBACK = "company";
/** base, base-2 … base-N are tried before giving up. */
export const COMPANY_SLUG_MAX_SUFFIX = 20;

export function companySlugFromName(canonicalName: string): string {
  const folded = canonicalName
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

  const bounded = folded.slice(0, COMPANY_SLUG_MAX_LENGTH).replace(/-+$/g, "");

  return bounded.length === 0 ? COMPANY_SLUG_FALLBACK : bounded;
}

/**
 * The bounded candidate sequence for one base slug: `base`, `base-2`, …,
 * `base-20`, each trimmed so the suffix never pushes past the length rule.
 */
export function companySlugCandidates(base: string): readonly string[] {
  const candidates = [base];
  for (let n = 2; n <= COMPANY_SLUG_MAX_SUFFIX; n += 1) {
    const suffix = `-${String(n)}`;
    const stem = base
      .slice(0, COMPANY_SLUG_MAX_LENGTH - suffix.length)
      .replace(/-+$/g, "");
    candidates.push(`${stem}${suffix}`);
  }
  return candidates;
}
