import type { QToolCallOutcome } from "@capital-q/q-runtime";

/**
 * Person identity on the public web (live 2026-11-06, production
 * 6c8d108cf). Asked "what did the first one do before?" about Ledgerfold's
 * founder, Q added a real, unrelated Adaeze Nwachukwu's career (Access
 * Bank, UBA Group, …) from a public profile that never mentions Ledgerfold.
 * Hedged, it was still a stranger's career in an investor's answer.
 *
 * The rule, shared by every place Q attaches public pages to a person it
 * holds against a record (the answer's research, web discovery's founders):
 * a page may speak about that person only when it TIES them to the record
 * -- it names the person AND the company (or is on the company's own
 * site). A bare name match is never enough. Text matching over public page
 * text, never over anyone's words.
 */

/** One form for comparing names with page text. */
export function normalForm(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’ʼ`]/gu, "'")
    .replace(/[‐-―]/gu, "-")
    .replace(/\s+/gu, " ")
    .trim();
}

/** The name, as written, is in the text (not inside a longer word). */
export function namedIn(name: string, text: string): boolean {
  const needle = normalForm(name);
  if (needle.length < 2) return false;
  const hay = normalForm(text);
  let at = hay.indexOf(needle);
  while (at >= 0) {
    const before = at === 0 ? "" : hay.charAt(at - 1);
    const after = hay.charAt(at + needle.length);
    if (!/[\p{L}\p{N}]/u.test(before) && !/[\p{L}\p{N}]/u.test(after)) {
      return true;
    }
    at = hay.indexOf(needle, at + 1);
  }
  return false;
}

/** A person Capital Q holds against a record: who, and of which company. */
export type PersonAnchor = {
  readonly person: string;
  readonly company: string;
};

const letters = (text: string): string =>
  text.toLowerCase().replace(/[^a-z0-9]/gu, "");

/** The page is on the company's own site (its name is the site's name). */
export function onCompanySite(domain: string, company: string): boolean {
  const site = letters(
    domain
      .toLowerCase()
      .replace(/^www\./u, "")
      .split(".")[0] ?? "",
  );
  return site.length >= 3 && site === letters(company);
}

/**
 * The page ties the person to the record: it names them and the company,
 * or names them on the company's own site.
 */
export function pageTiesPerson(
  page: { readonly text: string; readonly domain?: string | null | undefined },
  anchor: PersonAnchor,
): boolean {
  if (!namedIn(anchor.person, page.text)) return false;
  return (
    namedIn(anchor.company, page.text) ||
    (page.domain !== undefined &&
      page.domain !== null &&
      onCompanySite(page.domain, anchor.company))
  );
}

/** The trusted line said beside a search that found no page tying them. */
export function untiedPersonNote(anchor: PersonAnchor): string {
  return `No public page found here ties ${anchor.person} to ${anchor.company}: pages that only share the name may be about someone else and were left out. Say nothing from the public web about ${anchor.person}. You may offer to look for public profiles of ${anchor.person} that mention ${anchor.company}.`;
}

const str = (value: unknown): string =>
  typeof value === "string" ? value : "";

/**
 * A public-web research outcome about an anchored person, with every page
 * that does not tie them to the record left out (and Capital Q's notes on
 * those pages with them). A search not about the person is unchanged.
 */
export function tiedToRecordPerson(
  proposal: { readonly name: string; readonly arguments: unknown },
  outcome: QToolCallOutcome,
  anchor: PersonAnchor,
): { readonly outcome: QToolCallOutcome; readonly dropped: number } {
  if (!outcome.result.ok) return { outcome, dropped: 0 };
  const args = (proposal.arguments ?? {}) as {
    readonly entityName?: unknown;
    readonly query?: unknown;
    readonly alsoSearch?: unknown;
  };
  const asked = [
    str(args.entityName),
    str(args.query),
    ...(Array.isArray(args.alsoSearch) ? args.alsoSearch.map(str) : []),
  ].join(" \n ");
  if (!namedIn(anchor.person, asked)) return { outcome, dropped: 0 };
  const data = outcome.result.data as {
    readonly sources?: readonly Record<string, unknown>[];
    readonly comparison?: readonly Record<string, unknown>[];
    readonly guidance?: unknown;
  };
  const sources = data.sources ?? [];
  const kept = sources.filter((source) =>
    pageTiesPerson(
      {
        text: `${str(source["title"])}\n${str(source["excerpt"])}\n${str(source["url"])}`,
        domain: str(source["domain"]),
      },
      anchor,
    ),
  );
  if (kept.length === sources.length && kept.length > 0) {
    return { outcome, dropped: 0 };
  }
  const keptIndexes = new Set(kept.map((source) => source["index"]));
  const comparison = (data.comparison ?? []).filter((note) =>
    keptIndexes.has(note["sourceIndex"]),
  );
  const guidance =
    kept.length === 0
      ? `${untiedPersonNote(anchor)} ${str(data.guidance)}`
          .trim()
          .slice(0, 2_000)
      : data.guidance;
  return {
    outcome: {
      ...outcome,
      result: {
        ok: true,
        data: {
          ...data,
          sources: kept,
          comparison,
          ...(guidance === undefined ? {} : { guidance }),
        },
      },
    },
    dropped: sources.length - kept.length,
  };
}
