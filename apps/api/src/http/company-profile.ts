import type { FastifyInstance, FastifyRequest } from "fastify";

import {
  CompanyIdSchema,
  CompanyNotFoundError,
  declaredFactsForNetwork,
  projectCompanyForNetwork,
  type CompanyId,
  type CompanyProfileFacts,
  type CompanyService,
} from "@capital-q/companies";
import {
  COMPANIES_PATH,
  COMPANY_PROFILE_DECK_DOWNLOAD_SEGMENT,
  COMPANY_PROFILE_PHOTO_SEGMENT,
  COMPANY_PROFILE_SEGMENT,
  CompanyProfilePhotoDtoSchema,
  CompanyProfileDeckDownloadDtoSchema,
  CompanyProfileDtoSchema,
  parseContract,
  type CompanyProfileTeamMember,
  type CompanyProfileViewer,
  type Money,
  type PitchSummaryDto,
} from "@capital-q/contracts";
import { DocumentNotFoundError } from "@capital-q/evidence";
import {
  pitchSummary,
  type DiscoverablePitchQueryPort,
} from "@capital-q/media";
import type { ActorContext } from "@capital-q/security";

import {
  getActorContext,
  requireActorContextHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";
import type { CompanyNetworkViewPort } from "./companies.js";

/**
 * A company's profile from Discover (founder request 2026-10-02).
 *
 *   GET  /v1/companies/:companyId/profile                  the profile, for this reader
 *   GET  /v1/companies/:companyId/profile/photo            the photo alone (Discover's avatar)
 *   GET  /v1/companies/:companyId/profile/deck/download    a signed read of the deck
 *
 * Nothing here is a new disclosure rule. Each part is read through the
 * rule that already governs it, and the route only composes them:
 *
 *   the company        the owner's read, else the network-visible read the
 *                      network preview uses (disclosure: network/public);
 *   the overview       the network projection's declared fields only, so
 *                      nothing founder-private can be in it;
 *   the raise          the disclosure evaluator for THIS reader (founder-
 *                      private until shared with a named relationship);
 *   the photo          the company's Q Card `photo` scope, for signed-in
 *                      participants;
 *   the videos         the media service's own playback rule, per video;
 *   the deck           a pitch deck the company opened to investors who
 *                      can find it (ADR 0041: the deck's own audience, for
 *                      an investor the pitch rule admits), else one it
 *                      shared with the reader in their relationship chat
 *                      (R34), opened through the chat's own attachment read;
 *   the team           ADR 0041's allow-listed projection, for an investor
 *                      the pitch rule admits (and the owner).
 *
 * The role decides the shape, server-side. A founder viewing another
 * company receives identity and network videos only; the overview, the
 * raise and the deck are never computed for them, and the deck download
 * answers not-found exactly as it does for a deck that was never shared.
 */

/** A deck the company shared with the reader, as the chat recorded it. */
export type SharedCompanyDeck = {
  readonly relationshipId: string;
  readonly messageId: string;
  readonly title: string;
  readonly sharedAt: string;
};

/** A deck the company opened to investors who can find it (ADR 0041). */
export type AudienceCompanyDeck = {
  readonly documentId: string;
  readonly documentVersionId: string;
  readonly title: string;
  readonly sharedAt: string;
  /** False: never virus-scanned (ADR 0042). Absent: scanned. */
  readonly scanned?: boolean | undefined;
};

type ResolvedDeck =
  | ({ readonly kind: "AUDIENCE" } & AudienceCompanyDeck)
  | ({ readonly kind: "CHAT" } & SharedCompanyDeck);

export type CompanyProfilePorts = {
  /** The actor holds an investor organisation (watches as an investor). */
  readonly viewerIsInvestor: (actor: ActorContext) => Promise<boolean>;
  /** The media service's playback rule, as a yes or no. */
  readonly mayPlay: (
    actor: ActorContext,
    companyId: string,
    mediaAssetId: string,
  ) => Promise<boolean>;
  /** The Q Card photo for signed-in participants, or null. */
  readonly photo: (company: CompanyProfileFacts) => Promise<string | null>;
  /** The current raise, only where disclosure lets this actor view it. */
  readonly disclosedRaise: (
    actor: ActorContext,
    companyId: string,
  ) => Promise<Money | null>;
  readonly organisationVerified: (companyId: string) => Promise<boolean>;
  readonly sectorNodeIds: (companyId: string) => Promise<readonly string[]>;
  /** The newest pitch deck the company shared with the actor, or null. */
  readonly sharedDeck: (
    actor: ActorContext,
    company: CompanyProfileFacts,
  ) => Promise<SharedCompanyDeck | null>;
  /** The chat's own attachment read of exactly that message. */
  readonly downloadDeck: (
    actor: ActorContext,
    deck: SharedCompanyDeck,
  ) => Promise<{ readonly url: string; readonly expiresAt: string }>;
  /**
   * ADR 0041: the company is viewable to this investor under the pitch
   * rule (media's resolveViewableCompany: their own investor organisation,
   * its ACTIVE mandate, the company eligible now). Gates the audience
   * deck and the team.
   */
  readonly investorMayFind: (
    actor: ActorContext,
    companyId: string,
  ) => Promise<boolean>;
  /** The deck the company opened to investors, or null (Evidence). */
  readonly audienceDeck: (
    company: CompanyProfileFacts,
  ) => Promise<AudienceCompanyDeck | null>;
  /** A short-lived signed read of exactly that version. */
  readonly downloadAudienceDeck: (
    company: CompanyProfileFacts,
    deck: AudienceCompanyDeck,
  ) => Promise<{
    readonly url: string;
    readonly expiresAt: string;
    readonly scanned?: boolean | undefined;
  }>;
  /** The allow-listed team projection (companies context). */
  readonly team: (
    company: CompanyProfileFacts,
  ) => Promise<readonly CompanyProfileTeamMember[]>;
};

export type CompanyProfileRoutesDependencies = ActorContextDependencies & {
  readonly companies: CompanyService;
  readonly pitches?: DiscoverablePitchQueryPort | undefined;
  readonly networkView?: CompanyNetworkViewPort | undefined;
  readonly profile: CompanyProfilePorts;
};

const MAX_VIDEOS = 30;

function companyIdParam(request: FastifyRequest): CompanyId {
  return parseContract(
    CompanyIdSchema,
    (request.params as { readonly companyId?: unknown }).companyId,
    "The company identifier is not valid.",
  );
}

/** Quietly empty: an optional part that cannot be read is not shown. */
const quietly = <T>(promise: Promise<T>, fallback: T): Promise<T> =>
  promise.catch(() => fallback);

export function registerCompanyProfileRoutes(
  app: FastifyInstance,
  dependencies: CompanyProfileRoutesDependencies,
): void {
  const withContext = requireActorContextHook(dependencies);
  const { profile } = dependencies;
  const base = `${COMPANIES_PATH}/:companyId`;

  /** The company as this actor may see it, or one not-found. */
  const companyFor = async (
    actor: ActorContext,
    companyId: CompanyId,
  ): Promise<CompanyProfileFacts> =>
    dependencies.companies
      .getCompany({ actor, companyId })
      .catch(async (error: unknown) => {
        if (
          !(error instanceof CompanyNotFoundError) ||
          dependencies.networkView === undefined
        ) {
          throw error;
        }
        const visible = await dependencies.networkView.findNetworkVisible(
          actor,
          companyId,
        );
        if (visible === null) throw error;
        return visible;
      });

  const viewerOf = async (
    actor: ActorContext,
    company: CompanyProfileFacts,
  ): Promise<CompanyProfileViewer> => {
    if (company.organisationId === actor.organisationId) return "OWNER";
    return (await quietly(profile.viewerIsInvestor(actor), false))
      ? "INVESTOR"
      : "FOUNDER";
  };

  const videosFor = async (
    actor: ActorContext,
    companyId: string,
    viewer: CompanyProfileViewer,
  ): Promise<PitchSummaryDto[]> => {
    if (dependencies.pitches === undefined) return [];
    const set = (
      await quietly(
        dependencies.pitches.findDiscoverablePitches([companyId]),
        new Map(),
      )
    ).get(companyId);
    if (set === undefined) return [];
    // A founder is offered only what owners opened to the network (ADR
    // 0021); then every candidate is asked of the player's own rule, so
    // the tab never lists a video the reader would be refused.
    const offered = [set, ...set.more]
      .filter((pitch) => viewer !== "FOUNDER" || pitch.audience === "NETWORK")
      .slice(0, MAX_VIDEOS);
    const playable = await Promise.all(
      offered.map((pitch) =>
        quietly(profile.mayPlay(actor, companyId, pitch.mediaAssetId), false),
      ),
    );
    return offered
      .filter((_, index) => playable[index] === true)
      .map(pitchSummary);
  };

  /**
   * The deck an investor may download, re-resolved from the server's own
   * records on every call (the client never names a document, relationship
   * or message): the audience deck where the pitch rule admits them, else
   * one the company sent them in chat. Never for anyone but an investor.
   */
  const deckFor = async (
    actor: ActorContext,
    company: CompanyProfileFacts,
    findable: boolean,
  ): Promise<ResolvedDeck | null> => {
    if (findable) {
      const audience = await quietly(profile.audienceDeck(company), null);
      if (audience !== null) return { kind: "AUDIENCE", ...audience };
    }
    const shared = await quietly(profile.sharedDeck(actor, company), null);
    return shared === null ? null : { kind: "CHAT", ...shared };
  };

  app.get(
    `${base}${COMPANY_PROFILE_SEGMENT}`,
    { onRequest: withContext },
    async (request, reply) => {
      const actor = getActorContext(request);
      const company = await companyFor(actor, companyIdParam(request));
      const viewer = await viewerOf(actor, company);
      const projection = projectCompanyForNetwork(company);
      const full = viewer !== "FOUNDER";
      const findable =
        viewer === "INVESTOR" &&
        (await quietly(profile.investorMayFind(actor, company.id), false));

      const [photoUrl, videos, raise, verified, sectors, deck, team] =
        await Promise.all([
          quietly(profile.photo(company), null),
          videosFor(actor, company.id, viewer),
          // Not computed at all for a founder viewer: not hidden, absent.
          full
            ? quietly(profile.disclosedRaise(actor, company.id), null)
            : null,
          full
            ? quietly(profile.organisationVerified(company.id), false)
            : false,
          full
            ? quietly(profile.sectorNodeIds(company.id), [] as const)
            : ([] as const),
          viewer === "INVESTOR" ? deckFor(actor, company, findable) : null,
          // ADR 0041: the team for an investor the pitch rule admits, and
          // the owner previewing; never computed for anyone else.
          viewer === "OWNER" || findable
            ? quietly(profile.team(company), [] as const)
            : ([] as const),
        ]);

      void reply.header("Cache-Control", "no-store");
      return CompanyProfileDtoSchema.parse({
        viewer,
        companyId: projection.companyId,
        canonicalName: projection.canonicalName,
        shortDescription: projection.shortDescription,
        currentStageCode: projection.currentStageCode,
        headquartersCountry: projection.headquartersCountry,
        headquartersCity: projection.headquartersCity,
        photoUrl,
        overview: full
          ? {
              legalName: projection.legalName,
              websiteUrl: projection.websiteUrl,
              foundedDate: projection.foundedDate,
              primaryDescription: projection.primaryDescription,
              sectorNodeIds: [...sectors].slice(0, 32),
              raise,
              organisationVerified: verified,
              facts: declaredFactsForNetwork(projection),
              deck:
                deck === null
                  ? null
                  : {
                      title: deck.title,
                      sharedAt: deck.sharedAt,
                      scanned:
                        deck.kind !== "AUDIENCE" || deck.scanned !== false,
                    },
              team: [...team],
            }
          : null,
        videos,
      });
    },
  );

  // The avatar over a Discover pitch: the same visibility and Q Card scope
  // as the profile, and nothing else is read, so it stays cheap.
  app.get(
    `${base}${COMPANY_PROFILE_PHOTO_SEGMENT}`,
    { onRequest: withContext },
    async (request, reply) => {
      const actor = getActorContext(request);
      const company = await companyFor(actor, companyIdParam(request));
      const photoUrl = await quietly(profile.photo(company), null);
      void reply.header("Cache-Control", "no-store");
      return CompanyProfilePhotoDtoSchema.parse({ photoUrl });
    },
  );

  // A read: each call mints a fresh short-lived signed URL, never cached.
  app.get(
    `${base}${COMPANY_PROFILE_DECK_DOWNLOAD_SEGMENT}`,
    { onRequest: withContext },
    async (request, reply) => {
      const actor = getActorContext(request);
      const company = await companyFor(actor, companyIdParam(request));
      // Only an investor is ever handed a deck here. A founder, the owner
      // (whose documents are on their own page) and an investor with no
      // shared deck all receive the same not-found.
      if ((await viewerOf(actor, company)) !== "INVESTOR") {
        throw new DocumentNotFoundError();
      }
      const findable = await quietly(
        profile.investorMayFind(actor, company.id),
        false,
      );
      const deck = await deckFor(actor, company, findable);
      if (deck === null) throw new DocumentNotFoundError();
      const link =
        deck.kind === "AUDIENCE"
          ? await profile.downloadAudienceDeck(company, deck)
          : await profile.downloadDeck(actor, deck);
      void reply.header("Cache-Control", "no-store");
      return CompanyProfileDeckDownloadDtoSchema.parse(link);
    },
  );
}
