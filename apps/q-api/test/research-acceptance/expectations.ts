import { EVIDENCE_STATUSES, LIFECYCLE_STATUSES } from "@capital-q/contracts";
import {
  COUNTRIES,
  mentionedCountries,
  RESEARCH_VOCABULARY,
} from "@capital-q/q-research";
import type { RecordedResearchFixture } from "@capital-q/q-research/providers/recorded";

import type { AcceptanceCase, ReportSection } from "./case.js";
import type { CaseRun } from "./pipeline.js";
import type { SeenModelCall } from "./recorded-gateway.js";

/**
 * The gate's expectations, every one asserted by CODE (CLAUDE.md: never
 * ask a model to judge an invariant code can assert). Each check returns
 * a named verdict with the evidence that failed it, so a red run says
 * what broke ("query 'payments regulation' has no place term"), not
 * merely that something did.
 *
 * Every check a case expects ALWAYS reports (2026-10-29: a degraded live
 * recording passed "17/17" because PRIMARY_FROM_PLACE and the brief and
 * report checks dropped out of the list when their evidence was missing).
 * Missing evidence -- no brief, no report, no dossier, no fact -- is a
 * FAIL saying what is missing, never an omitted check.
 */

export type CheckVerdict = {
  readonly id: string;
  readonly ok: boolean;
  readonly detail: string;
};

export type GateInput = {
  readonly case: AcceptanceCase;
  readonly run: CaseRun;
  /** Every query that left, in order. */
  readonly queries: readonly string[];
  /** The web recording: page text and hits, for the source checks. */
  readonly web: RecordedResearchFixture;
  /** Every model call made, with what it was shown and what it answered. */
  readonly modelCalls: readonly SeenModelCall[];
};

const SECTION_PATTERNS: Readonly<Record<ReportSection, RegExp>> = {
  DEVELOPMENTS: /develop|news|what changed|recent|trend/iu,
  REGULATORY: /regulat|licen[cs]|compliance/iu,
  COMPETITIVE: /compet|landscape|players|rivals/iu,
  OPPORTUNITIES: /opportunit/iu,
  THESIS: /thesis|mandate|implication/iu,
  PIPELINE: /pipeline|portfolio/iu,
  CONTRADICTIONS: /^contradictions/iu,
  CANNOT_ESTABLISH: /cannot establish/iu,
  GAPS_NEXT: /gap|next|action|recommend|not known/iu,
};

const lower = (text: string) => text.toLowerCase();
const hasWord = (text: string, word: string) =>
  new RegExp(
    `(^|[^\\p{L}\\p{N}])${word.toLowerCase().replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}($|[^\\p{L}\\p{N}])`,
    "u",
  ).test(lower(text));

/** The words that name a case's places: names, demonyms, cities, regions. */
export function placeTerms(one: AcceptanceCase): readonly string[] {
  const codes = new Set(one.expect.places);
  return [
    ...COUNTRIES.filter((entry) => codes.has(entry.code)).flatMap((entry) => [
      entry.name,
      ...entry.aliases,
    ]),
    ...one.expect.regionTerms,
  ];
}

/** The country a government domain belongs to, if it is one. */
export function governmentCountry(domain: string): string | null {
  const parts = lower(domain)
    .split(".")
    .filter((part) => part.length > 0);
  const last = parts.at(-1) ?? "";
  const second = parts.at(-2) ?? "";
  if (last === "gov" || last === "mil") return "US";
  if (
    last.length === 2 &&
    ["gov", "go", "gouv", "gob", "govt", "gv", "gc"].includes(second)
  )
    return last === "uk" ? "GB" : last.toUpperCase();
  return null;
}

const matchesDomain = (domain: string, wanted: readonly string[]) =>
  wanted.some((one) =>
    one.startsWith(".")
      ? lower(domain).endsWith(lower(one))
      : lower(domain) === lower(one) ||
        lower(domain).endsWith(`.${lower(one)}`),
  );

const domainOf = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
};

/** Numbers as written in a statement: "1,600", "9%", "3.5". */
function numbersIn(text: string): readonly string[] {
  return [...text.matchAll(/\d+(?:[.,]\d+)*/gu)].map((match) =>
    match[0].replace(/,(?=\d{3}\b)/gu, ""),
  );
}

const normalisedNumbers = (text: string) =>
  text.replace(/(\d),(?=\d{3}\b)/gu, "$1");

function reportText(run: CaseRun): string {
  if (run.content === null) return "";
  return [
    run.draft?.summary ?? "",
    ...run.content.sections.map(
      (section) => `${section.heading}\n${section.body}`,
    ),
    ...run.content.gaps,
    ...(run.draft?.topRecommendations ?? []),
  ].join("\n");
}

function sentences(text: string): readonly string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/u)
    .filter((one) => one.trim().length > 0);
}

const CITATION = /\[S\d{1,3}(?:\s*[,;]\s*S?\d{1,3})*\]/gu;

function citedIndices(text: string): readonly number[] {
  return [...text.matchAll(CITATION)].flatMap((match) =>
    [...match[0].matchAll(/\d{1,3}/gu)].map((one) => Number(one[0])),
  );
}

/**
 * The fewest queries an investigation sends (2026-10-29: a plan that fell
 * back to the request's own sentence sent ONE and passed). The planner is
 * asked for up to 12 lines of enquiry and the job's search budget (40)
 * runs every one in round one, so a planned investigation sends 12 or
 * more; 8 leaves room for a line egress refuses or the deadline skips,
 * and no fallback reaches it.
 */
export const MIN_INVESTIGATION_QUERIES = 8;

/**
 * Report sections that need a line of enquiry of their own on the web;
 * the rest (thesis, contradictions, limits, gaps) are written from them.
 */
const EVIDENCE_SECTIONS: ReadonlySet<ReportSection> = new Set([
  "DEVELOPMENTS",
  "REGULATORY",
  "COMPETITIVE",
  "OPPORTUNITIES",
  "PIPELINE",
]);

function verdict(id: string, failures: readonly string[], passed: string) {
  return {
    id,
    ok: failures.length === 0,
    detail: failures.length === 0 ? passed : failures.slice(0, 6).join("; "),
  };
}

const BRIEF_SCHEMA = /brief/iu;
const PLAN_SCHEMA = "ResearchPlanResult";
const PUBLIC_LABELS = new Set(["network_visible", "public_external"]);
const VERIFIED_BY_SOMEONE: ReadonlySet<string> = new Set([
  "EXTERNALLY_VERIFIED",
  "PLATFORM_VERIFIED",
]);

function dossierFacts(one: AcceptanceCase) {
  return one.situation.sections.flatMap((section) => section.facts);
}

/** Refs a brief's answer selects: every F-ref it names. */
function refsIn(value: unknown): ReadonlySet<string> {
  return new Set(
    [...JSON.stringify(value ?? null).matchAll(/\bF\d{1,3}\b/gu)].map(
      (match) => match[0],
    ),
  );
}

export function checkCase(input: GateInput): readonly CheckVerdict[] {
  const one = input.case;
  const expect = one.expect;
  const checks: CheckVerdict[] = [];
  const places = placeTerms(one);
  const queries = input.queries;
  const dossier = input.run.dossier;
  const text = reportText(input.run);

  const missing = (id: string, why: string) => verdict(id, [why], "");
  checks.push(
    verdict(
      "QUERIES_SENT",
      queries.length < MIN_INVESTIGATION_QUERIES
        ? [
            `${String(queries.length)} ${queries.length === 1 ? "query" : "queries"} left Capital Q; an investigation sends at least ${String(MIN_INVESTIGATION_QUERIES)}`,
          ]
        : [],
      `${String(queries.length)} queries`,
    ),
  );
  // The plan ran: no fallback to a single generic search.
  checks.push(
    dossier === null
      ? missing(
          "INVESTIGATION_PLANNED",
          "no dossier: the research did not finish",
        )
      : verdict(
          "INVESTIGATION_PLANNED",
          dossier.investigation?.reduced === undefined
            ? []
            : [dossier.investigation.reduced],
          "the investigation ran as planned",
        ),
  );
  // A line of enquiry for every section that needs the web.
  const evidenceSections = expect.sections.filter((section) =>
    EVIDENCE_SECTIONS.has(section),
  );
  const linesRun = new Set(
    (dossier?.lanes ?? [])
      .filter((lane) => lane.status === "OK")
      .map((lane) => lane.lane),
  );
  checks.push(
    dossier === null
      ? missing("LINES_OF_ENQUIRY", "no dossier: the research did not finish")
      : verdict(
          "LINES_OF_ENQUIRY",
          linesRun.size < Math.max(1, evidenceSections.length)
            ? [
                `${String(linesRun.size)} lines of enquiry ran (${[...linesRun].join(", ") || "none"}); the report's ${evidenceSections.join(", ")} sections need at least ${String(Math.max(1, evidenceSections.length))}`,
              ]
            : [],
          `${String(linesRun.size)} lines of enquiry ran`,
        ),
  );

  // 1. The place: every query carries it, or none names one.
  if (expect.places.length > 0) {
    checks.push(
      verdict(
        "PLACE_IN_EVERY_QUERY",
        queries
          .filter((query) => !places.some((term) => hasWord(query, term)))
          .map((query) => `"${query}" has no place term`),
        "every query is scoped to the place",
      ),
    );
  }
  if (expect.statesGlobal) {
    const named = queries.filter(
      (query) => mentionedCountries(query).length > 0,
    );
    checks.push(
      verdict(
        "STAYS_GLOBAL",
        [
          ...named.map((query) => `"${query}" names a country`),
          ...(/\b(global(ly)?|worldwide|no (single |specific )?(country|market|region|geograph\w*))\b/iu.test(
            text,
          )
            ? []
            : ["the report does not say its scope is global"]),
        ],
        "global, and the report says so",
      ),
    );
  }

  // 2. Nothing private leaves.
  const privateFigures = dossierFacts(one)
    .filter((fact) => !PUBLIC_LABELS.has(fact.label))
    .flatMap((fact) => numbersIn(fact.statement))
    .filter((figure) => figure.replace(/\D/gu, "").length >= 3)
    .filter((figure) => !/^(19|20)\d{2}$/u.test(figure));
  checks.push(
    verdict(
      "NO_PRIVATE_IN_QUERIES",
      queries.flatMap((query) => [
        ...expect.privateMarkers
          .filter((marker) => lower(query).includes(lower(marker)))
          .map((marker) => `"${query}" carries private "${marker}"`),
        ...privateFigures
          .filter((figure) => numbersIn(query).includes(figure))
          .map((figure) => `"${query}" carries private figure ${figure}`),
      ]),
      "no private word or figure in any query",
    ),
  );
  checks.push(
    verdict(
      "CAPITAL_Q_RECORDS_NOT_SENT",
      queries.flatMap((query) =>
        one.capitalQRecords
          .filter((record) => lower(query).includes(lower(record.name)))
          .map((record) => `"${query}" names Capital Q record ${record.name}`),
      ),
      "Capital Q records never left",
    ),
  );

  // 3. Every query term traces to the person's words, a public-safe
  // fact of their situation, or a page already read.
  const traceable = new Set<string>();
  const addWords = (raw: string) => {
    for (const word of lower(raw).match(/[\p{L}\p{N}]+/gu) ?? [])
      traceable.add(word);
  };
  [one.request, ...one.earlierTurns].forEach(addWords);
  const pub = one.public;
  if (pub.company !== undefined) {
    addWords(
      [
        pub.company.name,
        ...pub.company.sectors,
        pub.company.description ?? "",
      ].join(" "),
    );
  }
  if (pub.mandate !== undefined)
    addWords([...pub.mandate.sectors, ...pub.mandate.stages].join(" "));
  addWords((pub.pipelineNames ?? []).join(" "));
  const contextCountries = new Set([
    ...expect.places,
    ...(pub.company === undefined ? [] : [pub.company.country]),
    ...(pub.mandate?.geographies ?? []),
  ]);
  for (const entry of COUNTRIES)
    if (contextCountries.has(entry.code))
      addWords([entry.name, ...entry.aliases].join(" "));
  addWords(expect.regionTerms.join(" "));
  dossierFacts(one)
    .filter((fact) => PUBLIC_LABELS.has(fact.label))
    .forEach((fact) => addWords(fact.statement));
  for (const search of input.web.searches)
    for (const hit of search.hits)
      addWords(`${hit.title ?? ""} ${hit.snippet}`);
  for (const page of input.web.pages)
    addWords(`${page.title ?? ""} ${page.text}`);
  for (const word of RESEARCH_VOCABULARY) traceable.add(lower(word));
  checks.push(
    verdict(
      "QUERY_TERMS_TRACE",
      queries.flatMap((query) =>
        (lower(query).match(/[\p{L}\p{N}]+/gu) ?? [])
          .filter((word) => word.length >= 3)
          .filter((word) => !/^(19|20)\d{2}$/u.test(word))
          .filter((word) => !traceable.has(word))
          .map((word) => `"${word}" in "${query}" traces to nothing`),
      ),
      "every query term traces to their words, public context or a page read",
    ),
  );

  // 4. The research brief, from the situation dossier.
  if (expect.brief.required) {
    const briefs = input.modelCalls.filter(
      (call) => call.schemaName !== null && BRIEF_SCHEMA.test(call.schemaName),
    );
    const brief = briefs.at(-1);
    if (brief === undefined || brief.output === null) {
      for (const id of [
        "BRIEF_WRITTEN",
        "BRIEF_MARKET",
        "BRIEF_SELECTS",
        "PLANNER_SEES_SELECTED_ONLY",
      ])
        checks.push(missing(id, "no research brief was written"));
    } else {
      const said = JSON.stringify(brief.output);
      const selected = refsIn(brief.output);
      checks.push(verdict("BRIEF_WRITTEN", [], "a brief was written"));
      checks.push(
        verdict(
          "BRIEF_MARKET",
          expect.places.length > 0
            ? places.some((term) => hasWord(said, term))
              ? []
              : ["the brief does not name the market's place"]
            : mentionedCountries(said).length > 0
              ? ["the brief names a country no context gave"]
              : [],
          "the brief names the right market",
        ),
      );
      checks.push(
        verdict(
          "BRIEF_SELECTS",
          [
            ...expect.brief.select
              .filter((ref) => !selected.has(ref))
              .map((ref) => `the brief does not select ${ref}`),
            ...expect.brief.exclude
              .filter((ref) => selected.has(ref))
              .map((ref) => `the brief selects irrelevant ${ref}`),
          ],
          "the brief selects the relevant facts and leaves the rest",
        ),
      );
      const unselected = dossierFacts(one).filter(
        (fact) => !selected.has(fact.ref),
      );
      const planners = input.modelCalls.filter(
        (call) => call.schemaName === PLAN_SCHEMA,
      );
      checks.push(
        verdict(
          "PLANNER_SEES_SELECTED_ONLY",
          planners.flatMap((call) => [
            ...unselected
              .filter((fact) => call.text.includes(fact.statement.slice(0, 60)))
              .map((fact) => `the planner was shown unselected ${fact.ref}`),
            ...expect.privateMarkers
              .filter((marker) => lower(call.text).includes(lower(marker)))
              .map((marker) => `the planner was shown private "${marker}"`),
          ]),
          "the planner saw only the brief's selected facts",
        ),
      );
    }
  }

  // 5. Sources: the place's primary publishers, and no foreign state as one.
  const sources = dossier?.sources ?? [];
  if (expect.primaryDomains.length > 0) {
    const recorded = [
      ...input.web.searches.flatMap((search) =>
        search.hits.map((hit) => hit.url),
      ),
      ...input.web.pages.map((page) => page.url),
    ].some((url) => matchesDomain(domainOf(url), expect.primaryDomains));
    checks.push(
      verdict(
        "PRIMARY_FROM_PLACE",
        sources.some(
          (source) =>
            source.tier === "PRIMARY" &&
            matchesDomain(source.domain, expect.primaryDomains),
        )
          ? []
          : [
              recorded
                ? "the recording holds the place's primary publisher, but no source from it is PRIMARY"
                : "no source from the place's primary publishers: the searches never reached one",
            ],
        "a primary source from the named place",
      ),
    );
  }
  if (expect.places.length > 0)
    checks.push(
      verdict(
        "FOREIGN_GOVERNMENT_NOT_PRIMARY",
        sources
          .filter((source) => source.tier === "PRIMARY")
          .filter((source) => {
            const country = governmentCountry(source.domain);
            return country !== null && !expect.places.includes(country);
          })
          .map(
            (source) =>
              `${source.domain} is PRIMARY but another country's government`,
          ),
        "no other country's government is primary",
      ),
    );

  // 6. The report.
  const content = input.run.content;
  checks.push(
    verdict(
      "REPORT_WRITTEN",
      content === null ? ["no report was written"] : [],
      "a report was written",
    ),
  );
  if (content !== null) {
    const headings = content.sections.map((section) => section.heading);
    checks.push(
      verdict(
        "REPORT_SECTIONS",
        expect.sections
          .filter((section) => {
            if (section === "GAPS_NEXT")
              return !(
                content.gaps.length > 0 &&
                ((input.run.draft?.topRecommendations.length ?? 0) > 0 ||
                  headings.some((heading) =>
                    SECTION_PATTERNS.GAPS_NEXT.test(heading),
                  ))
              );
            return !headings.some((heading) =>
              SECTION_PATTERNS[section].test(heading),
            );
          })
          .map((section) => `missing ${section}`),
        "every required section",
      ),
    );
    const indices = new Set(sources.map((source) => source.index));
    checks.push(
      verdict(
        "CITATIONS_RESOLVE",
        [...new Set(citedIndices(text))]
          .filter((index) => !indices.has(index))
          .map((index) => `[S${String(index)}] names no source`),
        "every [S n] resolves",
      ),
    );
    checks.push(
      verdict(
        "CAPITAL_Q_RECORDS_APART",
        one.capitalQRecords.flatMap((record) =>
          // The clause naming the record (a ";" part or a table cell)
          // carries no [S n] unless it is marked as the record.
          sentences(text)
            .flatMap((sentence) => sentence.split(/;\s+|\s\|\s/u))
            .filter((clause) => lower(clause).includes(lower(record.name)))
            .filter((clause) => !/\(capital q record\)/u.test(lower(clause)))
            .filter((clause) => citedIndices(clause).length > 0)
            .map(() => `${record.name} is cited as a web source`),
        ),
        "Capital Q records never cited as web sources",
      ),
    );
    if (expect.mandateTerms.length > 0) {
      const thesis = content.sections
        .filter((section) => SECTION_PATTERNS.THESIS.test(section.heading))
        .map((section) => section.body)
        .join("\n");
      checks.push(
        verdict(
          "THESIS_QUOTES_MANDATE",
          expect.mandateTerms.some((term) =>
            lower(thesis).includes(lower(term)),
          )
            ? []
            : ["the thesis section names nothing of the declared mandate"],
          "the thesis section uses the declared mandate",
        ),
      );
    }
    if (expect.pipelineCompanies.length > 0)
      checks.push(
        verdict(
          "PIPELINE_CONSIDERED",
          expect.pipelineCompanies
            .filter((name) => !lower(text).includes(lower(name)))
            .map((name) => `${name} is not considered`),
          "every pipeline company considered",
        ),
      );
  } else {
    for (const id of [
      "REPORT_SECTIONS",
      "CITATIONS_RESOLVE",
      "CAPITAL_Q_RECORDS_APART",
      ...(expect.mandateTerms.length > 0 ? ["THESIS_QUOTES_MANDATE"] : []),
      ...(expect.pipelineCompanies.length > 0 ? ["PIPELINE_CONSIDERED"] : []),
    ])
      checks.push(missing(id, "no report was written"));
  }

  // 7. Facts: every number on its page, labels per ADR-001.
  const pageText = new Map(
    input.web.pages.map(
      (page) => [page.url, normalisedNumbers(page.text)] as const,
    ),
  );
  const facts = dossier?.facts ?? [];
  if (facts.length === 0) {
    for (const id of ["FACT_NUMBERS_ON_PAGE", "EVIDENCE_LABELS_ADR001"])
      checks.push(
        missing(
          id,
          dossier === null
            ? "no dossier: the research did not finish"
            : "no sourced fact was admitted",
        ),
      );
    return checks;
  }
  checks.push(
    verdict(
      "FACT_NUMBERS_ON_PAGE",
      facts.flatMap((fact) => {
        const page = pageText.get(fact.url);
        if (page === undefined)
          return [`${fact.id}: its page ${fact.url} is not in the recording`];
        return numbersIn(fact.statement)
          .filter((figure) => !page.includes(figure))
          .map((figure) => `${fact.id}: ${figure} is not on its page`);
      }),
      "every number in a fact is on its cited page",
    ),
  );
  const evidence = new Set<string>(EVIDENCE_STATUSES);
  const lifecycle = new Set<string>(LIFECYCLE_STATUSES);
  checks.push(
    verdict(
      "EVIDENCE_LABELS_ADR001",
      facts.flatMap((fact) => [
        ...(fact.evidenceStatus === undefined ||
        !evidence.has(fact.evidenceStatus)
          ? [`${fact.id}: evidence status ${String(fact.evidenceStatus)}`]
          : []),
        ...(fact.lifecycleStatus === undefined ||
        !lifecycle.has(fact.lifecycleStatus)
          ? [`${fact.id}: lifecycle status ${String(fact.lifecycleStatus)}`]
          : []),
        ...(fact.evidenceStatus === "MULTI_SOURCE_SUPPORTED" &&
        (fact.corroboratedBy ?? []).length === 0
          ? [`${fact.id}: multi-source with no corroboration`]
          : []),
        ...((fact.contradicts ?? []).length > 0 &&
        fact.lifecycleStatus !== "CONTRADICTORY"
          ? [`${fact.id}: contradicted but ${String(fact.lifecycleStatus)}`]
          : []),
        // A web page states; it never verifies (the dossier's own schema
        // narrows this today; the gate holds if that ever widens).
        ...(VERIFIED_BY_SOMEONE.has(fact.evidenceStatus ?? "")
          ? [`${fact.id}: a web fact claims verification`]
          : []),
      ]),
      "evidence and lifecycle labels per ADR-001",
    ),
  );
  return checks;
}
