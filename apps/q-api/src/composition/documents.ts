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
          },
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
