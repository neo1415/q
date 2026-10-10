import { z } from "zod";

import type { PreparedEntity, PreparedEntitySet } from "./prepared-entities.js";

/**
 * The versioned seed file (scripts/seed/research/qatar-five.v1.json) as the
 * loader and the hot cache read it. The file carries the verification
 * results; this module turns them into the compact `PreparedEntity` and
 * refuses anything the research rules forbid (a portrait of a real person
 * hotlinked from a profile page, an Arabic name or pronunciation nobody
 * sourced, a fact without a verification result).
 */

const Verification = z.object({
  status: z.enum(["VERIFIED", "UNVERIFIED", "CONTRADICTED"]),
  checkedAt: z.string(),
  basis: z.string(),
  note: z.string().nullable(),
});

const Image = z
  .object({
    status: z.enum(["NOT_ATTACHED", "ATTACHED"]),
    url: z.string().nullable(),
    attribution: z.string().nullable(),
    note: z.string().optional(),
    kind: z.literal("ORG_LOGO").optional(),
    sourceUrl: z.string().optional(),
    path: z.string().optional(),
  })
  .passthrough();

const SeedEntity = z
  .object({
    demo_id: z.string().min(1),
    name: z.string().min(1),
    entity_kind: z.enum(["PERSON", "ORGANIZATION", "GOVERNMENT_AGENCY"]),
    aliases: z.array(z.string()),
    arabic_names: z.array(
      z.object({ text: z.string(), sourceId: z.string(), basis: z.string() }),
    ),
    pronunciation: z.array(z.never()),
    associated_organization: z.string().nullable(),
    one_line: z.string().min(1),
    facts: z.array(
      z.object({
        claim: z.string(),
        source_ids: z.array(z.string()).min(1),
        evidence_class: z.string(),
        verification: Verification,
      }),
    ),
    rehearsal_topics: z.array(z.string()),
    image: Image,
    research_status: z.literal("PREPARED_PUBLIC_SEED"),
    requires_refresh: z.boolean(),
  })
  .passthrough();

export const PreparedSeedSchema = z
  .object({
    seed_version: z.string().min(1),
    entities: z.array(SeedEntity).min(1),
    sources: z.record(
      z.string(),
      z.object({
        url: z.string().url(),
        description: z.string(),
        access: z.enum(["FETCHED", "UNVERIFIED"]),
        note: z.string(),
        fetchedAt: z.string().nullable(),
      }),
    ),
  })
  .passthrough();
export type PreparedSeed = z.infer<typeof PreparedSeedSchema>;
export type PreparedSeedEntity = PreparedSeed["entities"][number];

const hasArabic = (text: string): boolean => /\p{Script=Arabic}/u.test(text);

export function parsePreparedSeed(raw: unknown): PreparedSeed {
  const seed = PreparedSeedSchema.parse(raw);
  for (const entity of seed.entities) {
    const sourced = new Set(Object.keys(seed.sources));
    for (const fact of entity.facts) {
      for (const id of fact.source_ids) {
        if (!sourced.has(id)) {
          throw new Error(`${entity.demo_id}: fact cites unknown source ${id}`);
        }
      }
    }
    // Arabic script is held only where a source printed it; a Latin alias
    // never hides a generated Arabic spelling.
    for (const alias of entity.aliases) {
      if (hasArabic(alias)) {
        throw new Error(`${entity.demo_id}: unsourced Arabic alias`);
      }
    }
    for (const name of entity.arabic_names) {
      if (!sourced.has(name.sourceId)) {
        throw new Error(`${entity.demo_id}: Arabic name without a source`);
      }
    }
    if (entity.image.status === "ATTACHED") {
      const url = entity.image.url ?? "";
      if (entity.entity_kind === "PERSON") {
        throw new Error(`${entity.demo_id}: no portrait without a licence`);
      }
      if (/linkedin\.com|licdn\.com/iu.test(url)) {
        throw new Error(`${entity.demo_id}: image hotlinked from LinkedIn`);
      }
      if (entity.image.attribution === null) {
        throw new Error(`${entity.demo_id}: image without attribution`);
      }
    }
  }
  return seed;
}

/** Stable across loads of the same seed content; changes when it changes. */
export function preparedSeedVersion(seed: PreparedSeed): string {
  return seed.seed_version;
}

export function toPreparedEntity(entity: PreparedSeedEntity): PreparedEntity {
  return {
    id: entity.demo_id,
    kind: entity.entity_kind,
    displayName: entity.name,
    aliases: entity.aliases,
    arabicNames: entity.arabic_names.map((name) => name.text),
    organisation: entity.associated_organization,
    oneLine: entity.one_line,
    facts: entity.facts.map((fact) => ({
      claim: fact.claim,
      status: fact.verification.status,
      sourceIds: fact.source_ids,
      note: fact.verification.note,
    })),
    rehearsalTopics: entity.rehearsal_topics,
    imageUrl: entity.image.status === "ATTACHED" ? entity.image.url : null,
    researchStatus: entity.research_status,
    requiresRefresh: entity.requires_refresh,
  };
}

export function preparedEntitySetFromSeed(
  seed: PreparedSeed,
): PreparedEntitySet {
  return {
    version: preparedSeedVersion(seed),
    entities: seed.entities.map(toPreparedEntity),
  };
}
