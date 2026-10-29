import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { QSituationDossierSchema } from "@capital-q/contracts";
import { z } from "zod";

import { CapitalQRecordSchema } from "../../src/composition/workforce/deep-research.js";

/**
 * A golden case of the research acceptance gate (owner 2026-10-29).
 *
 * The person is ours (a fictional account); their situation is a full
 * situation dossier, the same shape situation-first planning reads
 * (QSituationDossierSchema): profile, mandate, pipeline, messages, board,
 * documents, history. The market and the companies researched are REAL
 * (Nigerian B2B payments, Kenyan agri-fintech, Moniepoint) so a recording
 * holds real public pages; no real company is ever an account here.
 *
 * Every expectation is asserted by code (expectations.ts). None is judged
 * by a model.
 */

/** Report sections a case may require; the patterns live in expectations.ts. */
export const REPORT_SECTIONS = [
  "DEVELOPMENTS",
  "REGULATORY",
  "COMPETITIVE",
  "OPPORTUNITIES",
  "THESIS",
  "PIPELINE",
  "CONTRADICTIONS",
  "CANNOT_ESTABLISH",
  "GAPS_NEXT",
] as const;
export type ReportSection = (typeof REPORT_SECTIONS)[number];

const Iso2 = z.string().regex(/^[A-Z]{2}$/u);

export const AcceptanceCaseSchema = z
  .object({
    id: z.string().regex(/^[A-Z]-[a-z0-9-]+$/u),
    /** The live failure (or the gap) this case guards. */
    why: z.string().min(1),
    actor: z.enum(["founder", "investor"]),
    /** The person's words. */
    request: z.string().min(1),
    /** Their earlier turns in the conversation, oldest first. */
    earlierTurns: z.array(z.string()),
    /** The RESEARCH step's goal as the approved plan states it. */
    stepGoal: z.string().min(1),
    /**
     * The public-safe fields of their situation (what a dossier's
     * publicTopics are derived from): their company's name, country and
     * declared sectors; an investor's declared geographies, sectors and
     * stages, and the names of public companies in their pipeline.
     */
    public: z
      .object({
        company: z
          .object({
            name: z.string().min(1),
            country: Iso2,
            sectors: z.array(z.string()),
            description: z.string().nullable(),
          })
          .strict()
          .optional(),
        mandate: z
          .object({
            geographies: z.array(Iso2),
            sectors: z.array(z.string()),
            stages: z.array(z.string()),
          })
          .strict()
          .optional(),
        pipelineNames: z.array(z.string()).optional(),
      })
      .strict(),
    situation: QSituationDossierSchema,
    /** Synthetic Capital Q companies the person may see. */
    capitalQRecords: z.array(CapitalQRecordSchema),
    expect: z
      .object({
        /** ISO codes the research must stay in; empty: global. */
        places: z.array(Iso2),
        /** Region words that also scope a query ("west africa", "lagos"). */
        regionTerms: z.array(z.string()),
        /** Domains (or suffixes) that are the named places' primary publishers. */
        primaryDomains: z.array(z.string()),
        /** Private words and figures that must never leave in a query. */
        privateMarkers: z.array(z.string()),
        sections: z.array(z.enum(REPORT_SECTIONS)),
        /** The thesis section quotes at least one of these (the declared mandate). */
        mandateTerms: z.array(z.string()),
        /** Pipeline companies the report must consider. */
        pipelineCompanies: z.array(z.string()),
        /** No place: the research stays global and the report says so. */
        statesGlobal: z.boolean(),
        /** The research brief written from the dossier before planning. */
        brief: z
          .object({
            required: z.boolean(),
            /** Dossier facts (F-refs) the brief must select. */
            select: z.array(z.string().regex(/^F\d+$/u)),
            /** Dossier facts it must leave out. */
            exclude: z.array(z.string().regex(/^F\d+$/u)),
          })
          .strict(),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const refs = new Set(
      value.situation.sections.flatMap((section) =>
        section.facts.map((fact) => fact.ref),
      ),
    );
    for (const ref of [
      ...value.expect.brief.select,
      ...value.expect.brief.exclude,
    ]) {
      if (!refs.has(ref))
        ctx.addIssue({
          code: "custom",
          message: `${ref} is not a fact of the case's dossier`,
          path: ["expect", "brief"],
        });
    }
    const side = value.actor === "founder" ? "FOUNDER" : "INVESTOR";
    if (value.situation.side !== side)
      ctx.addIssue({
        code: "custom",
        message: "the dossier's side is the actor's",
        path: ["situation", "side"],
      });
  });
export type AcceptanceCase = z.infer<typeof AcceptanceCaseSchema>;

export const ACCEPTANCE_DIR = fileURLToPath(new URL(".", import.meta.url));
export const CASES_DIR = fileURLToPath(new URL("./cases/", import.meta.url));
export const FIXTURES_DIR = fileURLToPath(
  new URL("./fixtures/", import.meta.url),
);

export function loadCases(): readonly AcceptanceCase[] {
  return readdirSync(CASES_DIR)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => {
      const parsed = AcceptanceCaseSchema.safeParse(
        JSON.parse(readFileSync(`${CASES_DIR}${name}`, "utf8")),
      );
      if (!parsed.success)
        throw new Error(
          `research acceptance case ${name} is invalid: ${parsed.error.message}`,
        );
      if (`${parsed.data.id}.json` !== name)
        throw new Error(`case ${name} must be named after its id`);
      return parsed.data;
    });
}

/** Where a case's recordings live. */
export function fixturePaths(id: string) {
  return {
    web: `${FIXTURES_DIR}${id}.web.json`,
    models: `${FIXTURES_DIR}${id}.models.json`,
  };
}
