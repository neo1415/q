import type { QSituationDossier, QSituationFact } from "@capital-q/contracts";
import {
  countryForms,
  countryName,
  isConnective,
  placeCountries,
  RESEARCH_VOCABULARY,
  tokenise,
} from "@capital-q/q-research";
import { z } from "zod";

import type { ResearchBriefOutput } from "./models.js";
import { situationText } from "./plan-job.js";

/**
 * The research brief (owner 2026-10-29): before anything is planned, Q
 * decides from everything it knows about the person -- the situation
 * dossier planning reads, as them -- what THIS question needs. A model
 * proposes the brief; code grounds it here:
 *
 *   - a fact is selected only by a ref the dossier holds;
 *   - the planner reads the brief and the selected facts, never the whole
 *     dossier;
 *   - what may LEAVE in a query is exactly what was judged relevant and is
 *     public: the brief's places, sectors, stage and subjects whose every
 *     word is public-safe vocabulary (the dossier's own public topics -- a
 *     founder's public profile, an investor's declared mandate geographies
 *     and sectors -- or the person's own words, or a country form of a
 *     place among those), and the words of selected facts labelled
 *     public_external. A private figure, a pipeline company's name, a
 *     document's content is never public-safe vocabulary, so it cannot
 *     leave however the model words the brief.
 *
 * Unknown stays unknown: a brief that could not be written is null, and the
 * research plans from the request alone.
 */

const TERM_MAX = 80;

/** Words an official body's name carries (as source-tier.ts reads them). */
const OFFICIAL =
  /\b(?:authority|commission|central bank|bank of|reserve bank|regulator[a-z]*|registry|registrar|ministry|securities and exchange|stock exchange|corporate affairs|monetary|supervisory|bureau|statistics)\b/iu;
const SMALL_WORDS = new Set(["of", "and", "the", "for", "de", "du", "la"]);

export const GroundedBriefSchema = z
  .object({
    question: z.string().max(600),
    /** For the person, plain words and no refs ("What I'm looking into"). */
    summary: z.string().max(600),
    places: z.array(z.string().max(TERM_MAX)).max(8),
    sectors: z.array(z.string().max(TERM_MAX)).max(6),
    stage: z.string().max(TERM_MAX).nullable(),
    subjects: z.array(z.string().max(TERM_MAX)).max(6),
    angles: z.array(z.string().max(200)).max(8),
    irrelevant: z.array(z.string().max(200)).max(8),
    unknowns: z
      .array(
        z
          .object({
            what: z.string().max(200),
            establish: z.enum(["RESEARCH", "PERSON"]),
          })
          .strict(),
      )
      .max(8),
    /** Refs the dossier holds, in the brief's order. */
    selected: z.array(z.string().regex(/^F\d{1,3}$/u)).max(12),
    /** What may leave beside their words and the pages read. */
    terms: z.array(z.string().max(120)).max(40),
    /** What the planner reads. */
    planner: z.string().max(8_000),
    /** What the writer reads. */
    writer: z.string().max(12_000),
    /** The market covered, for the report (code's words). */
    scope: z.string().max(400),
  })
  .strict();
export type GroundedBrief = z.infer<typeof GroundedBriefSchema>;

const REF = /\s*\(?\bF\d{1,3}\b\)?/gu;
const plainOf = (text: string) =>
  text.replace(REF, "").replace(/\s+/gu, " ").trim();

function factLine(fact: QSituationFact): string {
  const asOf = fact.asOf === null ? "" : `, as of ${fact.asOf}`;
  return `${fact.ref} (${fact.truthClass}${asOf}) ${fact.statement.replace(/\s+/gu, " ")}`;
}

/** The situation as the brief reads it (every section, with refs). */
export function briefSituation(dossier: QSituationDossier): string {
  return situationText(dossier);
}

export function groundBrief(input: {
  readonly raw: ResearchBriefOutput;
  readonly dossier: QSituationDossier;
  /** The person's request and earlier messages: their own words. */
  readonly words: readonly string[];
}): GroundedBrief {
  const { raw, dossier } = input;
  const facts = new Map<string, QSituationFact>();
  const sectionOf = new Map<string, QSituationDossier["sections"][number]>();
  for (const section of dossier.sections) {
    for (const fact of section.facts) {
      facts.set(fact.ref, fact);
      sectionOf.set(fact.ref, section);
    }
  }
  const selected = [
    ...new Set(
      raw.relevant.map((one) => one.ref).filter((ref) => facts.has(ref)),
    ),
  ].slice(0, 12);
  const why = new Map(raw.relevant.map((one) => [one.ref, one.why]));

  // Public-safe vocabulary: the dossier's public topics, the person's own
  // words, and the public forms of a country either names.
  const topics = dossier.publicTopics.join(" \n ");
  const said = input.words.join(" \n ");
  const vocabulary = new Set<string>([...tokenise(topics), ...tokenise(said)]);
  for (const code of placeCountries(`${topics}\n${said}`)) {
    for (const form of countryForms(code)) {
      for (const token of tokenise(form)) vocabulary.add(token);
    }
  }
  const publicFacts = selected
    .map((ref) => facts.get(ref))
    .filter(
      (fact): fact is QSituationFact =>
        fact !== undefined && fact.label === "public_external",
    );
  for (const fact of publicFacts)
    for (const token of tokenise(fact.statement)) vocabulary.add(token);
  // The generic words of research and joining words describe a kind of
  // page, never anyone: public too, though never informative on their own.
  const generic = (word: string) =>
    RESEARCH_VOCABULARY.has(word) || isConnective(word);
  const isPublic = (term: string) => {
    const words = tokenise(term);
    return (
      words.some((word) => vocabulary.has(word)) &&
      words.every((word) => vocabulary.has(word) || generic(word))
    );
  };

  const names = (items: readonly { readonly name: string }[]) =>
    items
      .map((item) => plainOf(item.name).slice(0, TERM_MAX))
      .filter((name) => name.length > 0);
  const places = names(raw.market.places);
  const sectors = names(raw.market.sectors);
  const stage =
    raw.market.stage === null
      ? null
      : plainOf(raw.market.stage.name).slice(0, TERM_MAX) || null;
  const subjects = names(raw.market.subjects);

  const terms = new Set<string>();
  for (const term of [
    ...places,
    ...sectors,
    ...(stage === null ? [] : [stage]),
    ...subjects,
  ]) {
    if (!isPublic(term)) continue;
    terms.add(term);
  }
  // An official body the brief names in full, in public words, may also
  // travel by its initials ("Central Bank of Nigeria" -> "CBN"): the same
  // public name, as search and the press write it.
  for (const subject of subjects) {
    if (!isPublic(subject) || !OFFICIAL.test(subject)) continue;
    const initials = subject
      .split(/[^\p{L}]+/u)
      .filter((word) => word.length > 0 && !SMALL_WORDS.has(word.toLowerCase()))
      .map((word) => word[0] ?? "")
      .join("");
    if (initials.length >= 2) terms.add(initials.toUpperCase());
  }
  for (const place of places) {
    if (!isPublic(place)) continue;
    for (const code of placeCountries(place))
      for (const form of countryForms(code)) terms.add(form);
  }
  for (const fact of publicFacts) terms.add(fact.statement.slice(0, 120));

  const from = (
    items: readonly { readonly name: string; readonly from: string }[],
  ) => items.map((item) => `${item.name} (${item.from})`).join("; ");
  const scope =
    places.length === 0
      ? "Scope: global. No place was named in the request, earlier in the conversation or in what Q holds about them, so no country was assumed."
      : `Scope: ${places.join(", ")} (from ${raw.market.places.map((one) => one.from).join("; ")}).`;
  const countries = [
    ...new Set(places.flatMap((place) => placeCountries(place))),
  ];
  const market = [
    places.length === 0
      ? "MARKET: no place in the request or their situation: research globally, never an assumed country."
      : `MARKET: places: ${from(raw.market.places)}${countries.length > 0 ? ` [countries: ${countries.map((code) => countryName(code) ?? code).join(", ")}]` : ""}`,
    ...(raw.market.sectors.length === 0
      ? []
      : [`sectors: ${from(raw.market.sectors)}`]),
    ...(raw.market.stage === null
      ? []
      : [`stage: ${raw.market.stage.name} (${raw.market.stage.from})`]),
    ...(raw.market.subjects.length === 0
      ? []
      : [`about: ${from(raw.market.subjects)}`]),
  ];
  const list = (title: string, items: readonly string[]) =>
    items.length === 0 ? [] : [title, ...items.map((item) => `- ${item}`)];
  const unknowns = raw.unknowns.map((one) => ({
    what: one.what.slice(0, 200),
    establish: one.establish,
  }));
  const head = [
    `QUESTION: ${raw.question}`,
    ...market,
    ...list("ANGLES", raw.angles),
    ...list(
      "NOT KNOWN",
      unknowns.map(
        (one) =>
          `${one.what} (${one.establish === "RESEARCH" ? "research can establish it" : "only they can say"})`,
      ),
    ),
    ...list("MUST NOT DRIVE THE RESEARCH", raw.irrelevant),
  ];
  const selectedLines = selected.flatMap((ref) => {
    const fact = facts.get(ref);
    if (fact === undefined) return [];
    const reason = why.get(ref);
    return [
      `${factLine(fact)}${reason === undefined ? "" : ` -- why: ${reason}`}`,
    ];
  });
  const planner = [
    ...head,
    "SELECTED FACTS",
    ...(selectedLines.length === 0 ? ["(none)"] : selectedLines),
  ]
    .join("\n")
    .slice(0, 8_000);
  // The writer also reads the whole sections the brief drew on (the
  // mandate for a thesis, their own record for their exposure).
  const drawnOn = [
    ...new Set(
      selected
        .map((ref) => sectionOf.get(ref))
        .filter((section) => section !== undefined),
    ),
  ];
  const writer = [
    planner,
    ...(drawnOn.length === 0
      ? []
      : [
          "FROM THEIR SITUATION (the sections the brief draws on, read as them)",
          ...drawnOn.flatMap((section) => [
            `[${section.source}]`,
            ...section.facts.map(factLine),
          ]),
        ]),
  ]
    .join("\n")
    .slice(0, 12_000);
  return GroundedBriefSchema.parse({
    question: raw.question.slice(0, 600),
    summary: plainOf(raw.summary).slice(0, 600),
    places,
    sectors,
    stage,
    subjects,
    angles: raw.angles.map((one) => one.slice(0, 200)).slice(0, 8),
    irrelevant: raw.irrelevant.map((one) => one.slice(0, 200)).slice(0, 8),
    unknowns,
    selected,
    terms: [...terms].map((term) => term.slice(0, 120)).slice(0, 40),
    planner,
    writer,
    scope: scope.slice(0, 400),
  });
}
