import type { AuthorisedFact } from "@capital-q/q-core";

/**
 * Who the person is to Capital Q, read for them on every turn (founder
 * report 2026-10-01: on Discover an investor asked "am I interested in
 * this company?" and Q said it did not know -- they had saved it and then
 * passed on it a minute earlier, and nothing had read their own record).
 *
 * Built from list_my_relationships output: their relationships by state
 * with names, and (investor) the companies they saved or passed on. When
 * the turn is about one counterparty, its line comes first and says
 * plainly what is and is not on record, so "no interest expressed" is
 * never the whole answer when a save or a pass is. Bounded: names are
 * capped per bucket so a large pipeline never floods the prompt.
 */

type Decision = { readonly companyId?: unknown; readonly name?: unknown };
type Relationship = {
  readonly counterpart?: { readonly id?: unknown; readonly name?: unknown };
  readonly state?: unknown;
};
type MyRelationshipsRead = {
  readonly yourSide?: unknown;
  readonly relationships?: readonly Relationship[];
  readonly saved?: readonly Decision[];
  readonly passed?: readonly Decision[];
};

const NAMES_PER_BUCKET = 8;

/**
 * Each state said from the viewer's own side, with who is waiting for
 * whom (live 2026-10-02: Zino was told two companies "have expressed
 * interest and are awaiting your response" when it was his own interest,
 * waiting for them). An investor expresses interest in a company; a
 * company answers it.
 */
const INVESTOR_BUCKETS: Readonly<Record<string, string>> = {
  INTEREST_EXPRESSED:
    "you expressed interest; waiting for them to accept (nothing for you to answer)",
  CONNECTED: "connected (both sides agreed)",
  DECLINED: "you expressed interest; they did not take it forward",
  DISCOVERED: "discovered, no interest expressed",
};
const COMPANY_BUCKETS: Readonly<Record<string, string>> = {
  INTEREST_EXPRESSED:
    "they expressed interest in your company; waiting for YOU to accept or decline",
  CONNECTED: "connected (both sides agreed)",
  DECLINED: "they expressed interest; you did not take it forward",
  DISCOVERED: "discovered",
};
const INVESTOR_FOCUS: Readonly<Record<string, string>> = {
  INTEREST_EXPRESSED:
    "you expressed interest in them and are waiting for them to accept; there is no request from them for you to accept",
  CONNECTED: "you are connected -- both sides agreed",
  DECLINED: "you expressed interest but they did not take it forward",
  DISCOVERED: "discovered only; no interest expressed",
};
const COMPANY_FOCUS: Readonly<Record<string, string>> = {
  INTEREST_EXPRESSED:
    "they expressed interest in your company and are waiting for you to accept or decline",
  CONNECTED: "you are connected -- both sides agreed",
  DECLINED: "they expressed interest and you did not take it forward",
  DISCOVERED: "discovered only",
};

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

function names(list: readonly (string | null)[]): string {
  const kept = list.filter((name): name is string => name !== null);
  const shown = kept.slice(0, NAMES_PER_BUCKET).join(", ");
  const more = kept.length - NAMES_PER_BUCKET;
  return more > 0 ? `${shown} and ${String(more)} more` : shown;
}

/**
 * @param focusId the company or investor organisation the turn is about
 *   (the one on screen or asked about), when there is one.
 */
export function ownStandingFact(
  data: unknown,
  focusId: string | null,
): AuthorisedFact | null {
  if (typeof data !== "object" || data === null) return null;
  const read = data as MyRelationshipsRead;
  const relationships = read.relationships ?? [];
  const saved = read.saved ?? [];
  const passed = read.passed ?? [];
  const investor = read.yourSide === "INVESTOR";
  const company = read.yourSide === "COMPANY";
  if (!investor && !company) return null;

  const parts: string[] = [];
  if (focusId !== null) {
    const related = relationships.find((r) => r.counterpart?.id === focusId);
    const wasSaved = saved.find((d) => d.companyId === focusId);
    const wasPassed = passed.find((d) => d.companyId === focusId);
    const name =
      text(related?.counterpart?.name) ??
      text(wasSaved?.name) ??
      text(wasPassed?.name) ??
      "the one this turn is about";
    const said: string[] = [];
    const state =
      typeof related?.state === "string"
        ? (investor ? INVESTOR_FOCUS : COMPANY_FOCUS)[related.state]
        : undefined;
    said.push(
      state ??
        (investor
          ? "no interest expressed and no relationship yet"
          : "this investor has not expressed interest in their company"),
    );
    if (investor) {
      if (wasSaved !== undefined)
        said.push("saved in Discover (a save is not interest)");
      if (wasPassed !== undefined) said.push("passed on in Discover");
      if (wasSaved === undefined && wasPassed === undefined) {
        said.push("neither saved nor passed in Discover");
      }
    }
    parts.push(`About ${name}: ${said.join("; ")}.`);
  }

  const byState = new Map<string, (string | null)[]>();
  for (const r of relationships) {
    if (
      typeof r.state !== "string" ||
      (investor ? INVESTOR_BUCKETS : COMPANY_BUCKETS)[r.state] === undefined
    )
      continue;
    byState.set(r.state, [
      ...(byState.get(r.state) ?? []),
      text(r.counterpart?.name),
    ]);
  }
  const counterpart = investor ? "companies" : "investors";
  if (byState.size === 0) {
    parts.push(
      investor
        ? "They have not expressed interest in any company yet."
        : "No investor has expressed interest in their company yet.",
    );
  } else {
    parts.push(
      `Their relationships with ${counterpart}: ${[...byState.entries()]
        .map(
          ([state, list]) =>
            `${(investor ? INVESTOR_BUCKETS : COMPANY_BUCKETS)[state] ?? state}: ${names(list)}`,
        )
        .join("; ")}.`,
    );
  }
  // What waits for THEM to answer, from the current state only: for an
  // investor nothing does (their interest waits for the company).
  const forYou = company
    ? relationships
        .filter((r) => r.state === "INTEREST_EXPRESSED")
        .map((r) => text(r.counterpart?.name))
    : [];
  parts.push(
    forYou.length === 0
      ? "Requests waiting for them to answer: none."
      : `Requests waiting for them to answer: ${names(forYou)}.`,
  );
  if (investor) {
    parts.push(
      saved.length === 0
        ? "Saved in Discover: none."
        : `Saved in Discover: ${names(saved.map((d) => text(d.name)))}.`,
    );
    parts.push(
      passed.length === 0
        ? "Passed on in Discover: none."
        : `Passed on in Discover: ${names(passed.map((d) => text(d.name)))}.`,
    );
  }
  return {
    scope: "RELATIONSHIP_CONTEXT",
    statement:
      `The person's own standing on Capital Q (their own record, read for them this turn). ${parts.join(" ")}`.slice(
        0,
        2_000,
      ),
    truthClass: "VERIFIED",
    evidenceStatus: "PLATFORM_VERIFIED",
    source: "Capital Q relationship history",
  };
}
