import { QATAR_FIVE } from "@capital-q/q-core/names";
import type {
  KnownEntityStore,
  PreparedEntityUpsert,
} from "@capital-q/q-research";
import { z } from "zod";

/**
 * The versioned seed file (scripts/seed/research/qatar-five.v1.json) and
 * its loader into the research store (W5; the store is W2's).
 *
 * The file carries the verification results. This module refuses anything
 * the research rules forbid (an Arabic name nobody sourced, a pronunciation,
 * a portrait of a real person, an image hotlinked from a profile page, a
 * fact without a verification result) and maps each entity onto the store's
 * `PreparedEntityUpsert`: global, network-visible public research data with
 * provenance, research_status PREPARED_PUBLIC_SEED and requires_refresh.
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
  })
  .passthrough();

const SeedEntity = z
  .object({
    demo_id: z.string().min(1),
    name: z.string().min(1),
    entity_kind: z.enum(["PERSON", "ORGANIZATION", "GOVERNMENT_AGENCY"]),
    primary_linkedin: z.string().url().nullable(),
    aliases: z.array(z.string()),
    arabic_names: z.array(
      z.object({ text: z.string(), sourceId: z.string(), basis: z.string() }),
    ),
    // Always empty: a pronunciation is never generated for a real name.
    pronunciation: z.array(z.never()),
    associated_organization: z.string().nullable(),
    one_line: z.string().min(1),
    role: z.string().nullable(),
    location: z.string().nullable(),
    identity_read: z.enum(["STRONG", "PLAUSIBLE", "WEAK"]),
    facts: z.array(
      z.object({
        claim: z.string(),
        source_ids: z.array(z.string()).min(1),
        evidence_class: z.string(),
        verification: Verification,
      }),
    ),
    rehearsal_topics: z.array(z.string()),
    rehearsal_question_examples: z.array(z.string()),
    short_public_quotes: z.array(
      z.object({
        quote: z.string(),
        source_id: z.string(),
        verification: Verification,
      }),
    ),
    image: Image,
    research_status: z.literal("PREPARED_PUBLIC_SEED"),
    last_researched_utc: z.string(),
    requires_refresh: z.boolean(),
  })
  .passthrough();

export const PreparedSeedSchema = z
  .object({
    seed_version: z.string().min(1),
    verified_at: z.string(),
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
  const sourced = new Set(Object.keys(seed.sources));
  for (const entity of seed.entities) {
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
    if (entity.entity_kind !== "PERSON" && entity.role !== null) {
      throw new Error(`${entity.demo_id}: an institution has no personal role`);
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

/** W3's recognition aliases (Latin script only), by the seed's demo id. */
const NAME_MODULE_ID: Readonly<Record<string, string>> = {
  "qa-demo-shadi-qishta": "seed:shadi-qishta",
  "qa-demo-qinvest": "seed:qinvest",
  "qa-demo-muhannad-taslaq": "seed:muhannad-taslaq",
  "qa-demo-invest-qatar": "seed:invest-qatar",
  "qa-demo-alrayan": "seed:alrayan-investment",
};
const recognitionAliases = (demoId: string): readonly string[] =>
  QATAR_FIVE.find((one) => one.id === NAME_MODULE_ID[demoId])?.aliases ?? [];

const clip = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`;

export type SeedMapOptions = {
  /** Where `apps/web/public` is served; an attached logo is `<origin>/research-entities/...`. */
  readonly webOrigin: string;
};

/**
 * One seed entity as the store takes it. Pure and deterministic, so a
 * second load of the same file writes the same rows.
 */
export function toPreparedUpsert(
  seed: PreparedSeed,
  entity: PreparedSeedEntity,
  options: SeedMapOptions,
): PreparedEntityUpsert {
  const cited = new Set(entity.facts.flatMap((fact) => fact.source_ids));
  const primary = Object.entries(seed.sources).find(
    ([, source]) => source.url === entity.primary_linkedin,
  );
  if (primary !== undefined) cited.add(primary[0]);
  const sources = [...cited].sort().map((sourceId) => {
    const source = seed.sources[sourceId];
    if (source === undefined) throw new Error(`unknown source ${sourceId}`);
    return {
      sourceId,
      url: source.url,
      description: clip(source.description, 300),
      publishedAt: null,
      evidenceClass: clip(
        source.access === "FETCHED"
          ? `fetched ${source.fetchedAt ?? seed.verified_at}`
          : source.note,
        120,
      ),
    };
  });
  const image =
    entity.image.status === "ATTACHED" && entity.image.url !== null
      ? {
          status: "ATTACHED" as const,
          assetUrl: new URL(
            entity.image.url,
            options.webOrigin.replace(/\/?$/u, "/"),
          ).toString(),
          attribution: clip(entity.image.attribution ?? "", 300),
          licenseNote:
            "The organisation's own published logo, used only to identify it",
        }
      : {
          status: "NOT_ATTACHED" as const,
          assetUrl: null,
          attribution: null,
          licenseNote: null,
        };
  return {
    profileKey: entity.demo_id,
    entityKind: entity.entity_kind,
    researchStatus: "PREPARED_PUBLIC_SEED",
    requiresRefresh: entity.requires_refresh,
    displayName: entity.name,
    aliases: [
      ...new Set([
        ...entity.aliases,
        ...recognitionAliases(entity.demo_id),
        ...entity.arabic_names.map((name) => name.text),
      ]),
    ].filter((alias) => alias !== entity.name),
    profileUrl: entity.primary_linkedin,
    role: entity.entity_kind === "PERSON" ? entity.role : null,
    organization:
      entity.entity_kind === "PERSON" ? entity.associated_organization : null,
    location: entity.location,
    confidence: entity.identity_read,
    facts: entity.facts.map((fact) => ({
      claim: clip(fact.claim, 600),
      sourceIds: fact.source_ids,
      // The status is part of the class, so no reader sees a claim without it.
      evidenceClass: clip(
        `${fact.verification.status}: ${fact.evidence_class}`,
        120,
      ),
    })),
    sources,
    // A quote is stored as a quote only when it was checked verbatim. The
    // seed's quotes sit on login-gated pages, so they stay in `profile`
    // as unverified leads and are never shown as the person's words.
    quotes: [],
    image,
    profile: {
      seedVersion: seed.seed_version,
      verifiedAt: seed.verified_at,
      oneLine: entity.one_line,
      rehearsalTopics: entity.rehearsal_topics,
      rehearsalQuestions: entity.rehearsal_question_examples,
      verification: entity.facts.map((fact, ordinal) => ({
        ordinal,
        status: fact.verification.status,
        checkedAt: fact.verification.checkedAt,
        basis: clip(fact.verification.basis, 400),
        note: fact.verification.note,
      })),
      unverifiedQuotes: entity.short_public_quotes.map((quote) => ({
        text: quote.quote,
        sourceId: quote.source_id,
        status: quote.verification.status,
      })),
      arabicNames: entity.arabic_names.map((name) => ({
        text: name.text,
        sourceId: name.sourceId,
      })),
    },
    lastResearchedAt: `${entity.last_researched_utc.slice(0, 10)}T00:00:00.000Z`,
  };
}

/**
 * Loads (or reloads) the seed into the store. Idempotent: the store keys a
 * prepared entity by its profile key, so a second run changes nothing and
 * returns the same ids. Hosted apply is the same call against hosted.
 */
export async function loadPreparedSeed(
  store: Pick<KnownEntityStore, "upsertPrepared">,
  seed: PreparedSeed,
  options: SeedMapOptions,
): Promise<readonly { demoId: string; externalPersonId: string }[]> {
  const loaded: { demoId: string; externalPersonId: string }[] = [];
  for (const entity of seed.entities) {
    const { externalPersonId } = await store.upsertPrepared(
      toPreparedUpsert(seed, entity, options),
    );
    loaded.push({ demoId: entity.demo_id, externalPersonId });
  }
  return loaded;
}
