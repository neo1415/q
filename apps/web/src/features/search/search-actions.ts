"use server";

import { z } from "zod";

import { discoverInvestors, listNetworkPitches } from "@capital-q/api-client";
import { HANDLE_PATTERN, type QCardSubjectType } from "@capital-q/contracts";

import {
  cardDescriptor,
  cardFieldValue,
  cardTagline,
  fieldsForAudience,
  websiteLabel,
} from "@/features/q-card/card-content";
import { loadPublicCard } from "@/features/q-card/public-card-data";
import { apiSession, resolveOwnContext } from "@/features/q/context";
import { ownRelationships } from "@/features/relationships/relationship-data";

import { nameMatches, type NameMatch } from "./name-matches";

/**
 * The search palette's one read (app prototype "search", option 2), server
 * side so the session never reaches the browser. The rules are Search's
 * (founder direction 2026-09-29; demo audit 2026-10-03): a name is matched
 * only among people this person already sees (their relationships and,
 * for a founder, Discover's investors); anyone else is found by their
 * whole @handle, which has a live card or does not; and videos are only
 * those founders opened to everyone on Capital Q that disclosure already
 * shows this viewer. Nothing lists or suggests strangers.
 */

export type PaletteVideo = {
  readonly companyId: string;
  readonly mediaAssetId: string;
  readonly company: string;
  readonly title: string | null;
  readonly durationSeconds: number | null;
};

export type PaletteCard = {
  readonly handle: string;
  readonly name: string;
  readonly subjectType: QCardSubjectType;
  /** "Venture fund · Kenya": only from the fields the card shows. */
  readonly descriptor: string | null;
  readonly tagline: string | null;
  readonly place: string | null;
  readonly website: { readonly url: string; readonly label: string } | null;
  /** A claim Capital Q verified, said exactly; demo attestations excluded. */
  readonly verified: readonly string[];
  /**
   * Where connecting happens for this viewer, when the card is someone
   * their own pages already show (an investor in their Discover, a company
   * among their relationships); null otherwise.
   */
  readonly connectHref: string | null;
};

export type PaletteResult =
  | { readonly kind: "EMPTY" }
  | {
      readonly kind: "NAMES";
      readonly query: string;
      readonly people: readonly NameMatch[];
      readonly videos: readonly PaletteVideo[];
    }
  | { readonly kind: "CARD"; readonly card: PaletteCard }
  | { readonly kind: "NO_CARD"; readonly handle: string }
  | { readonly kind: "ERROR" };

const Query = z.string().max(200);
const VIDEOS_SHOWN = 3;

const VERIFIED_WORDS: Readonly<Record<string, string>> = {
  ORGANISATION_VERIFIED: "Organisation verified by Capital Q",
  FOUNDER_IDENTITY_VERIFIED: "Founder identity verified by Capital Q",
};

export async function searchPaletteAction(raw: string): Promise<PaletteResult> {
  const parsed = Query.safeParse(raw);
  if (!parsed.success) return { kind: "ERROR" };
  const text = parsed.data.trim().slice(0, 80);
  if (text.length === 0) return { kind: "EMPTY" };
  try {
    if (text.startsWith("@")) return await byHandle(text.slice(1));
    if (text.length < 2) return { kind: "EMPTY" };
    const session = await apiSession();
    const [people, pitches] = await Promise.all([
      nameMatches(text).catch(() => []),
      session === null
        ? Promise.resolve(null)
        : listNetworkPitches(session, { text, limit: VIDEOS_SHOWN }).catch(
            () => null,
          ),
    ]);
    return {
      kind: "NAMES",
      query: text,
      people,
      videos: (pitches?.items ?? []).slice(0, VIDEOS_SHOWN).map((item) => ({
        companyId: item.companyId,
        mediaAssetId: item.pitch.mediaAssetId,
        company: item.canonicalName,
        title: item.pitch.title ?? null,
        durationSeconds: item.pitch.durationSeconds,
      })),
    };
  } catch {
    return { kind: "ERROR" };
  }
}

async function byHandle(raw: string): Promise<PaletteResult> {
  const handle = raw.toLowerCase();
  if (!HANDLE_PATTERN.test(handle)) return { kind: "NO_CARD", handle };
  const found = await loadPublicCard(handle).catch(() => null);
  if (found === null || found.kind !== "CARD") {
    return { kind: "NO_CARD", handle };
  }
  // The API's audience projection, re-filtered: the second layer.
  const fields = fieldsForAudience(found);
  const read = (key: (typeof fields)[number]["key"]) => {
    const field = fields.find((candidate) => candidate.key === key);
    return field === undefined ? null : cardFieldValue(field);
  };
  const website = fields.find((field) => field.key === "websiteUrl")?.value;
  const place =
    found.subjectType === "COMPANY"
      ? [read("headquartersCity"), read("headquartersCountry")]
          .filter((part): part is string => part !== null)
          .join(", ") || null
      : found.subjectType === "PERSON"
        ? read("countryCode")
        : read("hqCountry");
  return {
    kind: "CARD",
    card: {
      handle: found.handle,
      name: found.name,
      subjectType: found.subjectType,
      descriptor: cardDescriptor(found.subjectType, fields),
      tagline: cardTagline(found.subjectType, fields),
      place,
      website:
        website === undefined || !/^https?:\/\//iu.test(website)
          ? null
          : { url: website, label: websiteLabel(website) },
      verified: found.verified
        .filter((label) => !found.demoAttested.includes(label))
        .map((label) => VERIFIED_WORDS[label] ?? label),
      connectHref: await connectHrefFor(found.subjectType, found.name),
    },
  };
}

/**
 * Where "Connect on Capital Q" goes: only when exactly one entity this
 * viewer's own pages already show carries the card's name (a founder's
 * Discover investor, or a relationship's counterpart). A card names
 * nobody by id, so nothing here widens what the viewer may reach; with no
 * single such match the card just opens in full.
 */
async function connectHrefFor(
  subjectType: QCardSubjectType,
  name: string,
): Promise<string | null> {
  const context = await resolveOwnContext();
  const same = (other: string) =>
    other.trim().toLowerCase() === name.trim().toLowerCase();
  if (context.kind === "FOUNDER" && subjectType === "INVESTOR_ORGANISATION") {
    const session = await apiSession();
    if (session === null) return null;
    const slate = await discoverInvestors(session).catch(() => null);
    const hits = (slate?.items ?? []).filter((item) => same(item.displayName));
    const only = hits.length === 1 ? hits[0] : undefined;
    return only === undefined
      ? null
      : `/investors/${encodeURIComponent(only.investorOrganisationId)}`;
  }
  if (context.kind === "INVESTOR" && subjectType === "COMPANY") {
    const relationships = (await ownRelationships(context)) ?? [];
    const hits = relationships.filter(
      (item) =>
        item.counterpart.kind === "COMPANY" && same(item.counterpart.name),
    );
    const only = hits.length === 1 ? hits[0] : undefined;
    return only === undefined
      ? null
      : `/company/${encodeURIComponent(only.counterpart.id)}`;
  }
  return null;
}
