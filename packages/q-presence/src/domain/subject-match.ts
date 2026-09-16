/**
 * Is this page actually about the subject?
 *
 * A public search for an uncommon company returns strangers. Reading
 * "The Vaultlyne" brought back an apartment building called The Vault in
 * Lynn, Massachusetts, and a model asked to report what the pages said
 * reported, accurately, what those pages said — about somebody else. Left
 * there, Capital Q would hold "provides residential apartments" as an
 * understanding about a Nigerian insurtech company.
 *
 * So the check is here and it is deterministic. A page is about the
 * subject when it mentions something distinctive about them: a word from
 * their name that is theirs rather than everybody's, or the label of their
 * own domain. No model opinion, no similarity score, no threshold to tune.
 *
 * It is deliberately strict. A page that genuinely concerns the subject
 * without ever naming them is lost, and that is the right trade: a missing
 * understanding is a gap, a wrong one is a lie with a citation.
 */

/**
 * Words that identify nobody. A name reduced to these has nothing
 * distinctive in it, and a search on it can only return strangers.
 */
const GENERIC = new Set([
  "the",
  "and",
  "for",
  "inc",
  "llc",
  "ltd",
  "limited",
  "plc",
  "corp",
  "corporation",
  "company",
  "companies",
  "group",
  "holdings",
  "ventures",
  "venture",
  "capital",
  "partners",
  "fund",
  "funds",
  "labs",
  "technologies",
  "technology",
  "tech",
  "solutions",
  "services",
  "systems",
  "global",
  "international",
  "africa",
  "digital",
  "online",
  "app",
  "apps",
  "software",
  "platform",
  "studio",
  "studios",
  "agency",
  "consulting",
  "media",
  "network",
  "networks",
]);

/** Short words match too much: "ace" is inside "place". */
const MIN_DISTINCTIVE_LENGTH = 4;

function normalise(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ");
}

/** The label of a host: "https://www.thevaultlyne.com/x" → "thevaultlyne". */
export function domainLabel(websiteUrl: string | null): string | null {
  if (websiteUrl === null || websiteUrl.trim().length === 0) return null;
  const withScheme = /^[a-z]+:\/\//i.test(websiteUrl)
    ? websiteUrl
    : `https://${websiteUrl}`;
  let host: string;
  try {
    host = new URL(withScheme).hostname.toLowerCase();
  } catch {
    return null;
  }
  const parts = host.replace(/^www\./, "").split(".");
  const label = parts[0];
  return label === undefined || label.length < MIN_DISTINCTIVE_LENGTH
    ? null
    : label;
}

/**
 * The words that make this subject findable: name words that are not
 * everybody's, plus their own domain label. Empty means there is nothing
 * to recognise them by, and a read cannot be trusted at all.
 */
export function distinctiveTerms(identity: {
  readonly name: string;
  readonly websiteUrl: string | null;
}): readonly string[] {
  const terms = new Set<string>();
  for (const word of normalise(identity.name).split(" ")) {
    if (word.length >= MIN_DISTINCTIVE_LENGTH && !GENERIC.has(word)) {
      terms.add(word);
    }
  }
  const label = domainLabel(identity.websiteUrl);
  if (label !== null) {
    terms.add(label);
  }
  return [...terms];
}

/** Whether one page names the subject anywhere a reader would see. */
export function pageNamesSubject(
  terms: readonly string[],
  page: {
    readonly url: string;
    readonly title: string | null;
    readonly excerpt: string;
  },
): boolean {
  if (terms.length === 0) return false;
  const haystack = normalise(
    `${page.url} ${page.title ?? ""} ${page.excerpt}`,
  ).replace(/ /g, "");
  return terms.some((term) => haystack.includes(term));
}
