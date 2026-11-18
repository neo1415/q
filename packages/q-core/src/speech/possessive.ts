/**
 * Owner live 18 Nov 2026 (conversation b0719e94, 11:19:27): "Opening
 * Kazikit's pitch deck's pitch deck". A record's spoken label can already
 * be the owned thing ("Kazikit's pitch deck", from the record resolver),
 * and a line that adds "'s pitch deck" again doubles the noun. Every
 * code-written "X's Y" for a record goes through this one function: when
 * the owner already names that thing, it is said as it is.
 */
export function possessive(owner: string, thing: string): string {
  const said = owner.trim();
  const noun = thing.trim();
  if (said.length === 0) return `the ${noun}`;
  const lower = said.toLowerCase();
  const wanted = noun.toLowerCase();
  // "Kazikit's pitch deck" (or "the pitch deck") already is the thing, and
  // so is "Kazikit's deck" for "pitch deck": never a second noun.
  const last = wanted.split(/\s+/u).at(-1) ?? wanted;
  if (
    lower === wanted ||
    lower === `the ${wanted}` ||
    (/['’]s\s/u.test(lower) && lower.endsWith(` ${last}`))
  ) {
    return said;
  }
  return `${said}'s ${noun}`;
}
