import { exploreProfileHref } from "@capital-q/contracts";
import { CompanyIdSchema, type CompanyQueryPort } from "@capital-q/companies";
import type { DatabaseExecutor } from "@capital-q/database";
import {
  createExploreService,
  createPostgresCompanySectorsPort,
  relatedPitches,
  type ExplorePitch,
  type ExploreNetworkRow,
} from "@capital-q/discovery";
import { createPostgresNetworkPitchQueryPort } from "@capital-q/media";
import {
  actorPrincipal,
  type DisclosureAccessService,
} from "@capital-q/permissions";
import type { ExploreToolPitch, ExploreToolPort } from "@capital-q/q-tools";

/**
 * Explore for Q (ADR 0055): the same Explore service the HTTP API uses,
 * composed over the same reads, so Q's "pitches like X" and "search the
 * network" can only return what the person's own Explore would show.
 * A company enters only when disclosure answers NETWORK_VISIBLE or
 * PUBLIC_EXTERNAL for this actor; a failed check excludes.
 */

type Row = ExploreNetworkRow & { readonly title: string | null };

function toolPitch(
  pitch: ExplorePitch<Row>,
  related: readonly ExploreToolPitch["related"][number][] = [],
): ExploreToolPitch {
  return {
    companyId: pitch.companyId,
    companyName: pitch.company.canonicalName.slice(0, 200),
    pitchId: pitch.mediaAssetId,
    title: pitch.row.title,
    stageCode: pitch.company.currentStageCode,
    headquartersCountry: pitch.company.headquartersCountry,
    reason: null,
    related: [...related],
    profileHref: exploreProfileHref("company", pitch.companyId),
  };
}

export function createExploreToolPort(options: {
  readonly sql: DatabaseExecutor;
  readonly companies: Pick<CompanyQueryPort, "findCanonicalCompanyProfile">;
  readonly disclosure: Pick<DisclosureAccessService, "canDisclose">;
}): ExploreToolPort {
  const sectors = createPostgresCompanySectorsPort({ sql: options.sql });
  const explore = createExploreService<Row>({
    findNetworkPitches: createPostgresNetworkPitchQueryPort({
      sql: options.sql,
    }).findNetworkPitches,
    company: async (actor, companyId) => {
      const id = CompanyIdSchema.safeParse(companyId);
      if (!id.success) return null;
      const decision = await options.disclosure.canDisclose({
        principal: actorPrincipal(actor),
        resource: { type: "company", id: companyId },
        requestedAccess: "view",
      });
      if (
        decision.outcome !== "ALLOW" ||
        (decision.reasonCode !== "NETWORK_VISIBLE" &&
          decision.reasonCode !== "PUBLIC_EXTERNAL")
      ) {
        return null;
      }
      const company = await options.companies.findCanonicalCompanyProfile(
        id.data,
      );
      return company === null
        ? null
        : {
            canonicalName: company.canonicalName,
            shortDescription: company.shortDescription,
            headquartersCountry: company.headquartersCountry,
            currentStageCode: company.currentStageCode,
            companyStatus: company.companyStatus,
          };
    },
    sectors: async (_actor, companyIds) =>
      sectors.sectors === undefined
        ? new Map<string, readonly string[]>()
        : sectors.sectors(companyIds),
  });

  return {
    pitchesLike: async (actor, query) => {
      const pool = await explore.pool(actor);
      const name = query.companyName?.trim().toLowerCase();
      const anchor = pool.find((p) =>
        query.companyId !== undefined
          ? p.companyId === query.companyId
          : name !== undefined &&
            p.company.canonicalName.toLowerCase().includes(name),
      );
      if (anchor === undefined) return null;
      return {
        anchor: toolPitch(anchor),
        items: relatedPitches(anchor, pool, query.limit).map((r) =>
          toolPitch(r.item, r.related),
        ),
      };
    },
    searchNetwork: async (actor, query) => {
      const pitches = await explore.search(actor, { text: query.text });
      const companies = new Map<string, ExplorePitch<Row>>();
      for (const p of pitches) {
        if (!companies.has(p.companyId)) companies.set(p.companyId, p);
      }
      return {
        companies: [...companies.values()].slice(0, query.limit).map((p) => ({
          companyId: p.companyId,
          companyName: p.company.canonicalName.slice(0, 200),
          shortDescription: p.company.shortDescription?.slice(0, 600) ?? null,
          stageCode: p.company.currentStageCode,
          headquartersCountry: p.company.headquartersCountry,
          profileHref: exploreProfileHref("company", p.companyId),
        })),
        pitches: pitches.slice(0, query.limit).map((p) => toolPitch(p)),
      };
    },
  };
}
