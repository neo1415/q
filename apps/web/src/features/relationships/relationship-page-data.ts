import "server-only";

import {
  getChatThread,
  getCompanyNetworkPreview,
  getCompanyProfile,
  getDiscoveredInvestor,
  getOwnInterest,
  getRelationshipWithCompany,
  getRelationshipWithInvestor,
  listCompanyRelationships,
  listIncomingInterest,
} from "@capital-q/api-client";
import {
  isMatchedRelationshipState,
  type ChatThreadDto,
  type CompanyInterestStatusDto,
  type IncomingInterestDto,
  type PitchSummaryDto,
  type RelationshipStatusDto,
} from "@capital-q/contracts";

import { countryLabel, stageLabel } from "@/features/company/declared-labels";
import { investorTypeLabel } from "@/features/investors/investor-labels";
import { apiSession, resolveOwnContext } from "@/features/q/context";

/**
 * What a relationship's pages (overview and conversation) read, once, as
 * the person (founder design 2026-09-28). Each side reads only through its
 * own authorised endpoints: an investor sees the company's network
 * projection; a founder sees the investor as Discover would show them, and
 * the name the relationship already carries. Nothing is read that the
 * pages before this redesign did not already read, except the thread's
 * first page for the messages preview.
 */

export type CounterpartProfile = {
  readonly photoUrl: string | null;
  readonly about: string | null;
  readonly location: string | null;
  readonly websiteUrl: string | null;
  readonly chips: readonly string[];
  /** Their own page in Capital Q, when this side has one to open. */
  readonly profileHref: string | null;
};

const NO_PROFILE: CounterpartProfile = {
  photoUrl: null,
  about: null,
  location: null,
  websiteUrl: null,
  chips: [],
  profileHref: null,
};

type Loaded<Extra> =
  | { readonly kind: "UNAVAILABLE"; readonly sentence: string }
  | ({
      readonly kind: "OK";
      readonly counterpart: string;
      readonly relationship: RelationshipStatusDto | null;
      readonly profile: CounterpartProfile;
      /** The first page of messages; null when not open or unreadable. */
      readonly thread: ChatThreadDto | null;
      /** Said when nothing is on record that this side can see. */
      readonly absentSentence: string;
    } & Extra);

async function threadFor(
  session: NonNullable<Awaited<ReturnType<typeof apiSession>>>,
  relationship: RelationshipStatusDto | null,
): Promise<ChatThreadDto | null> {
  if (
    relationship === null ||
    !isMatchedRelationshipState(relationship.state)
  ) {
    return null;
  }
  return getChatThread(session, relationship.relationshipId).catch(() => null);
}

/** An investor organisation's relationship with one company. */
export async function loadInvestorSideRelationship(companyId: string): Promise<
  Loaded<{
    readonly companyId: string;
    readonly own: CompanyInterestStatusDto | null;
    /** The company's pitch, when the server lets this reader play it. */
    readonly pitch: {
      readonly companyId: string;
      readonly canonicalName: string;
      readonly shortDescription: string | null;
      readonly currentStageCode: string | null;
      readonly headquartersCountry: string | null;
      readonly pitch: PitchSummaryDto;
    } | null;
  }>
> {
  const [context, session] = await Promise.all([
    resolveOwnContext(),
    apiSession(),
  ]);
  if (context.kind !== "INVESTOR" || session === null) {
    return {
      kind: "UNAVAILABLE",
      sentence:
        "Relationships with companies belong to an investor organisation. This one is not yours to see.",
    };
  }
  const company = await getCompanyNetworkPreview(session, companyId).catch(
    () => null,
  );
  if (company === null) {
    return {
      kind: "UNAVAILABLE",
      sentence:
        "This company isn't available to you. It may not be discoverable, or it may no longer exist.",
    };
  }
  const [status, own, profile] = await Promise.all([
    getRelationshipWithCompany(session, company.companyId).catch(() => null),
    getOwnInterest(session, company.companyId).catch(() => null),
    // The profile's videos are already asked of the player's own rule, so
    // this page offers exactly the pitch the profile counts and playback
    // admits -- never one that then fails to load.
    getCompanyProfile(session, company.companyId).catch(() => null),
  ]);
  const playable = profile?.videos[0] ?? null;
  const relationship = status?.relationship ?? null;
  const location = [
    company.headquartersCity,
    countryLabel(company.headquartersCountry),
  ]
    .filter((part): part is string => part !== null && part.length > 0)
    .join(", ");
  return {
    kind: "OK",
    companyId: company.companyId,
    counterpart: company.canonicalName,
    relationship,
    own,
    // The same playable pitch the company page lists (live 2026-10-02: a
    // connected investor saw none here; 2026-10-03: one was offered here
    // that playback then refused).
    pitch:
      playable === null
        ? null
        : {
            companyId: company.companyId,
            canonicalName: company.canonicalName,
            shortDescription: company.shortDescription,
            currentStageCode: company.currentStageCode,
            headquartersCountry: company.headquartersCountry,
            pitch: playable,
          },
    thread: await threadFor(session, relationship),
    profile: {
      ...NO_PROFILE,
      about: company.shortDescription ?? company.primaryDescription,
      location: location.length === 0 ? null : location,
      websiteUrl: company.websiteUrl,
      chips: [stageLabel(company.currentStageCode)].filter(
        (chip): chip is string => chip !== null,
      ),
    },
    absentSentence:
      status === null
        ? "Where you stand couldn't load just now. Nothing has changed; try again in a moment."
        : `Nothing is on record yet between your organisation and ${company.canonicalName}.`,
  };
}

/** A company's relationship with one investor organisation. */
export async function loadCompanySideRelationship(
  investorOrganisationId: string,
): Promise<
  Loaded<{
    /** The pending interest this company may answer, if any. */
    readonly pending: IncomingInterestDto | null;
  }>
> {
  const [context, session] = await Promise.all([
    resolveOwnContext(),
    apiSession(),
  ]);
  if (context.kind !== "FOUNDER" || session === null) {
    return {
      kind: "UNAVAILABLE",
      sentence:
        "Relationships with investors belong to a company. This one is not yours to see.",
    };
  }
  const [incoming, status, listed, investor] = await Promise.all([
    listIncomingInterest(session, context.companyId).catch(() => null),
    getRelationshipWithInvestor(session, investorOrganisationId).catch(
      () => null,
    ),
    listCompanyRelationships(session, context.companyId).catch(() => null),
    getDiscoveredInvestor(session, investorOrganisationId).catch(() => null),
  ]);
  // Newest first: after a decline an organisation may express interest
  // again, and the pending one is the one to answer.
  const fromThisInvestor = (incoming?.items ?? [])
    .filter((item) => item.investorOrganisationId === investorOrganisationId)
    .toSorted((a, b) => b.expressedAt.localeCompare(a.expressedAt));
  // The name the company may know them by: from their interest, from the
  // company's own relationship list (a request the founder sent, ADR 0023),
  // or as Discover shows them. Never guessed.
  const counterpart =
    fromThisInvestor[0]?.investorName ??
    listed?.items.find((item) => item.counterpart.id === investorOrganisationId)
      ?.counterpart.name ??
    investor?.displayName;
  if (counterpart === undefined) {
    return {
      kind: "UNAVAILABLE",
      sentence:
        incoming === null || status === null
          ? "This relationship couldn't load just now. Nothing has changed; try again in a moment."
          : "Nothing is on record between your company and this investor organisation.",
    };
  }
  const relationship = status?.relationship ?? null;
  return {
    kind: "OK",
    counterpart,
    relationship,
    pending:
      fromThisInvestor.find((item) => item.response === "PENDING") ?? null,
    thread: await threadFor(session, relationship),
    profile:
      investor === null
        ? NO_PROFILE
        : {
            photoUrl: investor.photoUrl ?? null,
            about: investor.publicDescription,
            location: countryLabel(investor.hqCountry),
            websiteUrl: investor.websiteUrl,
            chips: [investorTypeLabel(investor.investorType)],
            profileHref: `/investors/${investorOrganisationId}`,
          },
    absentSentence:
      "Where you stand couldn't load just now. Nothing has changed; try again in a moment.",
  };
}
