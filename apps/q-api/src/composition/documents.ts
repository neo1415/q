import type { QArtifactContent, QMessage } from "@capital-q/contracts";
import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";
import {
  ArtifactNotFoundError,
  BrandKitAuthorityError,
  createBrandKitService,
  type ArtifactService,
  type BrandKitService,
} from "@capital-q/q-artifacts";
import {
  auditDocument,
  brandDeck,
  illustrateWithGenerated,
  type OwnDeckFacts,
  type OwnDeckFigure,
} from "@capital-q/q-specialists";
import type { DocumentStudioPort } from "@capital-q/q-tools";
import type { ActorContext } from "@capital-q/security";

import type { QDocumentRoutesDependencies } from "../http/q-documents.js";
import { suggestBrandFromWebsite } from "./brand-from-website.js";
import type { VettedHttp } from "./vetted-http.js";
import type { DocumentImages } from "./document-images.js";

/**
 * The document studio's server side (DOCS): the brand kit service and what
 * the routes and Q tools need around it.
 */

export type OwnCompany = {
  readonly companyId: string;
  readonly websiteUrl: string | null;
  readonly sectorCodes: readonly string[];
};

/**
 * The actor's own company: the one their active organisation owns, in
 * their tenant. Never a company named in a request.
 */
export async function ownCompanyOf(
  sql: DatabaseExecutor,
  actor: ActorContext,
): Promise<OwnCompany | null> {
  if (actor.organisationId === undefined) return null;
  const rows = await sql<
    { id: string; website_url: string | null; sectors: string[] | null }[]
  >`
    select c.id, c.website_url,
           array(
             select n.canonical_code
               from taxonomy.entity_assignments a
               join taxonomy.nodes n on n.id = a.node_id
              where a.entity_type = 'COMPANY'
                and a.entity_id = c.id
                and a.tenant_id = c.tenant_id
                and a.status = 'ACTIVE'
              limit 12) as sectors
      from core.companies c
     where c.tenant_id = ${actor.tenantId}
       and c.organisation_id = ${actor.organisationId}
     order by c.created_at
     limit 1`;
  const row = rows[0];
  if (row === undefined) return null;
  return {
    companyId: row.id,
    websiteUrl: row.website_url,
    sectorCodes: row.sectors ?? [],
  };
}

/**
 * Deck wave 8: the founder's own current round (or active raise objective)
 * and current team, for their own deck. Read server-side for the company
 * `ownCompanyOf` resolved for this actor, tenant-matched; names and
 * business titles only (no email, no user id, no private summary).
 */
export async function ownDeckFactsOf(
  sql: DatabaseExecutor,
  actor: ActorContext,
  companyId: string,
): Promise<OwnDeckFacts> {
  const rounds = await sql<
    {
      amount: string;
      currency: string;
      instrument: string | null;
      name: string | null;
      use_of_funds: string | null;
    }[]
  >`
    with objective as (
      select o.target_amount::text as amount, o.currency_code as currency,
             o.instrument_code as instrument, o.use_of_funds_summary
        from core.capital_objectives o
       where o.tenant_id = ${actor.tenantId}
         and o.company_id = ${companyId}
         and o.status = 'ACTIVE'
       order by o.started_at desc
       limit 1),
    round as (
      select r.target_amount::text as amount, r.currency_code as currency,
             r.instrument, r.name
        from core.capital_rounds r
       where r.tenant_id = ${actor.tenantId}
         and r.company_id = ${companyId}
         and r.status <> 'CLOSED'
       order by r.is_current desc, r.created_at desc
       limit 1)
    select amount, currency, instrument, name, use_of_funds from (
      select 1 as priority, amount, currency, instrument, name,
             (select use_of_funds_summary from objective) as use_of_funds
        from round
      union all
      select 2, amount, currency, instrument, null, use_of_funds_summary
        from objective) candidates
     order by priority
     limit 1`;
  const team = await sql<
    {
      display_name: string | null;
      given_name: string | null;
      family_name: string | null;
      business_title: string | null;
      is_founder: boolean;
    }[]
  >`
    select p.display_name, p.given_name, p.family_name,
           m.business_title, m.is_founder
      from core.company_members m
      join identity.user_profiles p on p.id = m.user_id
     where m.tenant_id = ${actor.tenantId}
       and m.company_id = ${companyId}
       and m.is_current
       and m.relationship_type = 'team_member'
     order by m.is_founder desc, m.started_at asc, m.id asc
     limit 5`;
  const round = rounds[0];
  // Deck quality (2026-10-08): the round's terms, the team's size, the
  // company's own website and the confirmed reading of the founder's own
  // deck, each read on its own so one missing table never costs the rest.
  const terms = await sql<
    {
      target_close: string | null;
      cap_amount: string | null;
      cap_currency: string | null;
    }[]
  >`
    select coalesce(
             (select r.target_close_on::text from core.capital_rounds r
               where r.tenant_id = ${actor.tenantId} and r.company_id = ${companyId}
                 and r.status <> 'CLOSED'
               order by r.is_current desc, r.created_at desc limit 1),
             (select o.target_close_date::text from core.capital_objectives o
               where o.tenant_id = ${actor.tenantId} and o.company_id = ${companyId}
                 and o.status = 'ACTIVE'
               order by o.started_at desc limit 1)) as target_close,
           (select r.valuation_cap_amount::text from core.capital_rounds r
             where r.tenant_id = ${actor.tenantId} and r.company_id = ${companyId}
               and r.status <> 'CLOSED'
             order by r.is_current desc, r.created_at desc limit 1) as cap_amount,
           (select r.currency_code from core.capital_rounds r
             where r.tenant_id = ${actor.tenantId} and r.company_id = ${companyId}
               and r.status <> 'CLOSED'
             order by r.is_current desc, r.created_at desc limit 1) as cap_currency`.catch(
    () => [],
  );
  const sizes = await sql<
    {
      team_size: number | null;
      founder_count: number | null;
      website: string | null;
    }[]
  >`
    select (select f.team_size from core.company_team_facts f
             where f.tenant_id = ${actor.tenantId} and f.company_id = ${companyId}
             order by f.updated_at desc limit 1) as team_size,
           (select f.founder_count from core.company_team_facts f
             where f.tenant_id = ${actor.tenantId} and f.company_id = ${companyId}
             order by f.updated_at desc limit 1) as founder_count,
           (select c.website_url from core.companies c
             where c.tenant_id = ${actor.tenantId} and c.id = ${companyId}) as website`.catch(
    () => [],
  );
  // Only a reading the founder confirmed: a Q-extracted figure becomes
  // something their deck states only after they said it was right.
  const readings = await sql<{ sections: unknown }[]>`
    select e.sections
      from evidence.deck_extractions e
     where e.tenant_id = ${actor.tenantId}
       and e.company_id = ${companyId}
       and exists (select 1 from evidence.deck_extraction_confirmations c
                    where c.extraction_id = e.id and c.tenant_id = e.tenant_id)
     order by e.created_at desc
     limit 1`.catch(() => []);
  const term = terms[0];
  const size = sizes[0];
  return {
    round:
      round === undefined
        ? null
        : {
            amount: round.amount,
            currency: round.currency,
            instrument: round.instrument,
            name: round.name,
            useOfFunds: round.use_of_funds,
            targetClose: term?.target_close ?? null,
            valuationCap:
              term?.cap_amount === null ||
              term?.cap_amount === undefined ||
              term.cap_currency === null
                ? null
                : { amount: term.cap_amount, currency: term.cap_currency },
          },
    teamSize: size?.team_size ?? null,
    founderCount: size?.founder_count ?? null,
    website: size?.website ?? null,
    figures: deckFigures(readings[0]?.sections),
    team: team.flatMap((row) => {
      const name =
        row.display_name ??
        [row.given_name, row.family_name]
          .filter((part): part is string => part !== null)
          .join(" ");
      return name.trim().length === 0
        ? []
        : [
            {
              name: name.trim().slice(0, 80),
              role: row.business_title,
              founder: row.is_founder,
            },
          ];
    }),
  };
}

/**
 * The labelled figures of a deck reading, validated at this boundary
 * (stored JSON is `unknown` until it is checked). At most 80.
 */
function deckFigures(sections: unknown): OwnDeckFigure[] {
  if (!Array.isArray(sections)) return [];
  const figures: OwnDeckFigure[] = [];
  for (const section of sections as unknown[]) {
    if (typeof section !== "object" || section === null) continue;
    const code = (section as { section?: unknown }).section;
    const facts = (section as { facts?: unknown }).facts;
    if (typeof code !== "string" || !Array.isArray(facts)) continue;
    for (const fact of facts as unknown[]) {
      if (typeof fact !== "object" || fact === null) continue;
      const { kind, label, value, asOf } = fact as Record<string, unknown>;
      if (kind !== "FIGURE" || typeof label !== "string") continue;
      figures.push({
        section: code.slice(0, 40),
        label: label.slice(0, 120),
        value: typeof value === "string" ? value.slice(0, 160) : null,
        asOf: typeof asOf === "string" ? asOf.slice(0, 80) : null,
      });
      if (figures.length >= 80) return figures;
    }
  }
  return figures;
}

export type DocumentsModule = Omit<
  QDocumentRoutesDependencies,
  "authenticator" | "resolver" | "identity" | "artifacts"
> & {
  readonly brandKit: BrandKitService;
  /** DOCS: generated images; absent where none are composed. */
  readonly images?: DocumentImages | undefined;
};

export function createDocumentsModule(dependencies: {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
  readonly runMessages: (
    actor: ActorContext,
    runId: string,
  ) => Promise<readonly QMessage[]>;
  readonly http?: VettedHttp | undefined;
  readonly images?: DocumentImages | undefined;
}): DocumentsModule {
  const brandKit = createBrandKitService({
    sql: dependencies.sql,
    transactions: dependencies.transactions,
  });
  return {
    brandKit,
    images: dependencies.images,
    runMessages: dependencies.runMessages,
    suggestFromWebsite: async (actor) => {
      const company = await ownCompanyOf(dependencies.sql, actor);
      if (company === null || company.websiteUrl === null) {
        return { status: "NO_WEBSITE" };
      }
      const suggestion = await suggestBrandFromWebsite({
        websiteUrl: company.websiteUrl,
        sectorCodes: company.sectorCodes,
        http: dependencies.http,
      });
      return suggestion === null
        ? { status: "UNREADABLE" }
        : { status: "FOUND", companyId: company.companyId, suggestion };
    },
  };
}

/**
 * The document studio's Q tools port (DOCS spec §6): every call as the
 * actor, through the same services the routes use.
 */
export function createDocumentStudioPort(dependencies: {
  readonly studio: DocumentsModule;
  readonly artifacts: ArtifactService;
}): DocumentStudioPort {
  const { studio, artifacts } = dependencies;
  /** A new version of the actor's own document, re-audited. */
  const appendVersion = async (input: {
    readonly actor: ActorContext;
    readonly plan: Parameters<DocumentStudioPort["applyBrand"]>[0]["plan"];
    readonly runId: string;
    readonly artifactId: string;
    readonly instruction: string;
    readonly current: NonNullable<
      Awaited<ReturnType<ArtifactService["read"]>>["current"]
    >;
    readonly content: QArtifactContent;
  }) => {
    const grounding = input.current.content.sections.flatMap((section) => [
      section.heading,
      section.body,
      ...section.findings.map((finding) => finding.statement),
    ]);
    const content =
      input.content.deck === undefined
        ? input.content
        : { ...input.content, audit: auditDocument(input.content, grounding) };
    const detail = await artifacts.reviseArtifact({
      actorContext: input.actor,
      permittedContextPlan: input.plan,
      qRunId: input.runId,
      artifactId: input.artifactId,
      instruction: input.instruction,
      content: {
        title: input.current.title,
        summary: input.current.summary,
        content,
      },
    });
    return {
      status: "APPLIED" as const,
      artifactId: detail.artifact.artifactId,
      type: detail.artifact.type,
      artifactStatus: detail.artifact.status,
      title: detail.artifact.title,
      currentVersion: detail.artifact.currentVersion,
    };
  };

  return {
    illustrate: async ({ actor, plan, runId, artifactId, slides }) => {
      const port = studio.images?.illustrationsFor({ actor, runId });
      if (port === undefined) return { status: "IMAGES_OFF" };
      let current;
      try {
        current = (await artifacts.read(actor, artifactId)).current;
      } catch (error) {
        if (error instanceof ArtifactNotFoundError) {
          return { status: "NOT_FOUND" };
        }
        throw error;
      }
      if (current === undefined) return { status: "NOT_FOUND" };
      if (current.content.deck === undefined) return { status: "NOT_A_DECK" };
      const illustrated = await illustrateWithGenerated(current.content, port, {
        slides,
      });
      if (illustrated === current.content) return { status: "NO_PICTURE" };
      try {
        return await appendVersion({
          actor,
          plan,
          runId,
          artifactId,
          instruction: "Add illustrations",
          current,
          content: illustrated,
        });
      } catch (error) {
        if (error instanceof ArtifactNotFoundError) {
          return { status: "NOT_FOUND" };
        }
        return { status: "FAILED" };
      }
    },
    brandState: async (actor) => {
      try {
        return await studio.brandKit.state(actor);
      } catch (error) {
        if (error instanceof BrandKitAuthorityError) return {};
        throw error;
      }
    },
    suggestBrand: async (actor) => {
      if (actor.organisationId === undefined) {
        return { status: "NO_ORGANISATION" };
      }
      const found = await studio.suggestFromWebsite(actor);
      if (found.status !== "FOUND") return { status: found.status };
      const kit = await studio.brandKit.suggest(actor, {
        source: "WEBSITE",
        sourceUrl: found.suggestion.sourceUrl,
        companyId: found.companyId,
        palette: found.suggestion.palette,
        pairing: found.suggestion.pairing,
        logo: found.suggestion.logo,
      });
      return { status: "SUGGESTED", kit };
    },
    audit: async (actor, artifactId) => {
      try {
        const detail = await artifacts.read(actor, artifactId);
        const current = detail.current;
        if (current === undefined) return { status: "NOT_FOUND" };
        return {
          status: "FOUND",
          title: current.title,
          version: current.version,
          audit: current.content.audit,
        };
      } catch (error) {
        if (error instanceof ArtifactNotFoundError) {
          return { status: "NOT_FOUND" };
        }
        throw error;
      }
    },
    applyBrand: async ({ actor, plan, runId, artifactId }) => {
      let current;
      try {
        current = (await artifacts.read(actor, artifactId)).current;
      } catch (error) {
        if (error instanceof ArtifactNotFoundError) {
          return { status: "NOT_FOUND" };
        }
        throw error;
      }
      if (current === undefined) return { status: "NOT_REVISABLE" };
      const effective = await studio.brandKit
        .effective(actor)
        .catch(() => null);
      if (effective === null) return { status: "NO_BRAND" };
      const branded = brandDeck(current.content, {
        kitVersion: effective.kitVersion,
        palette: effective.palette,
        pairing: effective.pairing,
      });
      // The audit describes the new version; nothing new is said in it,
      // so what it rests on is what the document already carries.
      const grounding = current.content.sections.flatMap((section) => [
        section.heading,
        section.body,
        ...section.findings.map((finding) => finding.statement),
      ]);
      const content =
        branded.deck === undefined
          ? branded
          : { ...branded, audit: auditDocument(branded, grounding) };
      try {
        const detail = await artifacts.reviseArtifact({
          actorContext: actor,
          permittedContextPlan: plan,
          qRunId: runId,
          artifactId,
          instruction: "Apply my brand",
          content: { title: current.title, summary: current.summary, content },
        });
        return {
          status: "APPLIED",
          artifactId: detail.artifact.artifactId,
          type: detail.artifact.type,
          artifactStatus: detail.artifact.status,
          title: detail.artifact.title,
          currentVersion: detail.artifact.currentVersion,
        };
      } catch (error) {
        if (error instanceof ArtifactNotFoundError) {
          return { status: "NOT_FOUND" };
        }
        return { status: "FAILED" };
      }
    },
  };
}
