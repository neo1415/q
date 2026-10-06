import { z } from "zod";

import type { MediaAsset } from "@capital-q/media";
import type { ActorContext } from "@capital-q/security";

import { capitalItems } from "./actions/capital-read.js";
import { teamItems } from "./actions/team.js";
import { sharingOf } from "./actions/pitch.js";
import type { AppActionPorts } from "./ports.js";

/**
 * The person's own records, as the pages already show them (ADR 0040 §2):
 * one Q tool, read_my(kind, filter), and a compact "what exists" index
 * read every turn, so Q never answers "no record" about something on
 * their own screen. Each kind reads through the page's own service with
 * the same authorization; nothing here reads a table.
 */

export const OWN_READ_KINDS = [
  "media",
  "documents",
  "rehearsals",
  "feed",
  // 2026-10-02: their recent calls with Q's notes, so "how did it go?",
  // the follow-ups and what was proposed to Q in the call can be acted on.
  "calls",
  // 2026-10-02: the files they uploaded (deck, financials, …), as their
  // documents page lists them; "documents" is Q's own drafts for them.
  "uploads",
  // Diligence (2026-10-02): requests, answers and shared documents.
  "diligence",
  // 2026-10-04: rounds, what each raised, and every commitment's step, so
  // "how much have I raised" reads the Capital page's own numbers.
  "capital",
  // G1/G2: the people in their company or firm, each one's role, and the
  // invitations waiting (admins), as Settings → Team shows them.
  "team",
] as const;
export const OwnReadKindSchema = z.enum(OWN_READ_KINDS);
export type OwnReadKind = z.infer<typeof OwnReadKindSchema>;

/** One record as its page shows it: a title, a state in words, a few facts. */
export const OwnReadItemSchema = z
  .object({
    id: z.string(),
    title: z.string().max(200),
    status: z.string().max(120),
    at: z.string().max(40).nullable(),
    facts: z.record(
      z.string(),
      z.union([z.string().max(200), z.number(), z.boolean(), z.null()]),
    ),
  })
  .strict();
export type OwnReadItem = z.infer<typeof OwnReadItemSchema>;

export type OwnReadPorts = AppActionPorts & {
  /** Their own documents, as /documents lists them. */
  readonly documents?:
    ((actor: ActorContext) => Promise<readonly OwnReadItem[]>) | undefined;
  /** Their own rehearsals, as /rehearsals lists them. */
  readonly rehearsals?:
    ((actor: ActorContext) => Promise<readonly OwnReadItem[]>) | undefined;
  /**
   * The companies in their Discover feed now, as the feed shows them
   * (investors; null for anyone else). Parity eval 2026-10-02: with only
   * Saved and Passed in the facts, "Pass on Ajopot" was refused as "not in
   * your Discover record" while Ajopot led their feed.
   */
  readonly feed?:
    | ((actor: ActorContext) => Promise<readonly OwnReadItem[] | null>)
    | undefined;
  /**
   * Their recent calls with Q's notes, as the meeting page shows them to
   * them: what was agreed (both sides), and only their own Q follow-ups
   * and, for the organiser, what was proposed to Q in the call.
   */
  readonly calls?:
    ((actor: ActorContext) => Promise<readonly OwnReadItem[]>) | undefined;
  /**
   * The files their organisation uploaded (pitch deck, financials, …), as
   * the documents page lists them, read through the evidence service with
   * its own authorization. Parity eval 2026-10-02: "Make our deck …" was
   * matched against Q's drafts, never the uploaded deck.
   */
  readonly uploads?:
    ((actor: ActorContext) => Promise<readonly OwnReadItem[]>) | undefined;
  /** Their relationships' diligence areas, as the relationship page shows them. */
  readonly diligenceAreas?:
    ((actor: ActorContext) => Promise<readonly OwnReadItem[]>) | undefined;
  /** Their own company's name, to name an untitled pitch video by. */
  readonly ownCompanyName?:
    ((actor: ActorContext) => Promise<string | null>) | undefined;
};

/**
 * What an untitled pitch is called everywhere Q names it (read_my, the
 * index, name matching). Parity eval 2026-10-02: an untitled pitch read as
 * "Pitch", and "Make Pitch visible to everyone on Capital Q" was taken as
 * their company's visibility.
 */
export function untitledPitchName(companyName: string | null): string {
  return companyName === null ? "Pitch video" : `${companyName} pitch video`;
}

const MEDIA_STATUS: Readonly<Record<string, string>> = {
  CREATED: "waiting for the file",
  UPLOAD_PENDING: "waiting for the file",
  UPLOADING: "uploading",
  PROCESSING: "processing",
  FAILED: "needs a new file",
};

/** A pitch as the pitch page states it: live, private, in review, … */
export function pitchItem(
  asset: MediaAsset,
  companyName: string | null = null,
): OwnReadItem {
  const sharing = sharingOf(asset);
  const playable =
    asset.status === "READY" &&
    asset.moderationStatus === "ALLOWED" &&
    asset.playbackPolicy !== "PRIVATE" &&
    asset.supersededAt === null;
  const status =
    asset.supersededAt !== null
      ? "replaced by a newer video"
      : asset.status !== "READY"
        ? (MEDIA_STATUS[asset.status] ?? asset.status.toLowerCase())
        : asset.playbackPolicy === "PRIVATE"
          ? "private: only their organisation can play it"
          : asset.moderationStatus === "ALLOWED"
            ? "live"
            : asset.moderationStatus === "BLOCKED"
              ? "held by Capital Q review"
              : "waiting for Capital Q review";
  return {
    id: asset.id,
    title: asset.title ?? untitledPitchName(companyName),
    status,
    at: asset.readyAt ?? asset.createdAt,
    facts: {
      whoCanWatch:
        sharing === "ORGANISATION"
          ? "only their organisation"
          : sharing === "INVESTORS"
            ? "investors who can find their company"
            : "everyone on Capital Q",
      playableByInvestors: playable,
      durationSeconds: asset.durationSeconds,
    },
  };
}

export async function readOwn(
  ports: OwnReadPorts,
  actor: ActorContext,
  kind: OwnReadKind,
): Promise<readonly OwnReadItem[] | null> {
  switch (kind) {
    case "media": {
      if (ports.media === undefined || ports.ownCompanyId === undefined) {
        return null;
      }
      const companyId = await ports.ownCompanyId(actor);
      if (companyId === null) return [];
      const [assets, companyName] = await Promise.all([
        ports.media.listCompanyMedia({ actor, companyId }),
        ports.ownCompanyName?.(actor).catch(() => null) ?? null,
      ]);
      return assets
        .filter(
          (asset) =>
            asset.purpose === "FOUNDER_PITCH" &&
            asset.status !== "DELETED" &&
            asset.supersededAt === null,
        )
        .map((asset) => pitchItem(asset, companyName));
    }
    case "documents":
      return ports.documents === undefined ? null : ports.documents(actor);
    case "rehearsals":
      return ports.rehearsals === undefined ? null : ports.rehearsals(actor);
    case "feed":
      return ports.feed === undefined ? null : ports.feed(actor);
    case "calls":
      return ports.calls === undefined ? null : ports.calls(actor);
    case "uploads":
      return ports.uploads === undefined ? null : ports.uploads(actor);
    case "diligence":
      return ports.diligenceAreas === undefined
        ? null
        : ports.diligenceAreas(actor);
    case "capital":
      return capitalItems(ports, actor);
    case "team":
      return teamItems(ports, actor);
  }
}

const KIND_LABELS: Readonly<Record<OwnReadKind, string>> = {
  media: "Pitch videos",
  documents: "Documents",
  rehearsals: "Rehearsals",
  feed: "Companies in their Discover feed now",
  calls: "Recent calls with Q's notes",
  uploads: "Files they uploaded",
  diligence: "Diligence requests and shared documents",
  capital: "Rounds, money raised and commitments",
  team: "Their team: people, roles and invitations",
};

/** One kind in the "what exists" index: a count and a few titles with state. */
export type OwnIndexEntry = {
  readonly kind: OwnReadKind;
  readonly label: string;
  readonly total: number;
  readonly titles: readonly string[];
};

const INDEX_TITLES = 3;

/**
 * The compact "what exists" index, read every turn: per kind, a count and
 * up to three titles with their state. A kind that cannot be read here is
 * left out (never reported as none).
 */
export async function ownIndex(
  ports: OwnReadPorts,
  actor: ActorContext,
): Promise<readonly OwnIndexEntry[]> {
  const entries = await Promise.all(
    OWN_READ_KINDS.map(async (kind) => {
      const items = await readOwn(ports, actor, kind).catch(() => null);
      if (items === null) return null;
      return {
        kind,
        label: KIND_LABELS[kind],
        total: items.length,
        // The state and, where the page shows it, who can watch: "live"
        // alone read as "not established that investors can play it"
        // (parity eval 2026-10-02).
        titles: items
          .slice(0, INDEX_TITLES)
          .map((item) =>
            typeof item.facts["whoCanWatch"] === "string"
              ? `${item.title} (${item.status}; ${item.facts["whoCanWatch"]} can watch)`
              : `${item.title} (${item.status})`,
          ),
      };
    }),
  );
  return entries.filter((entry) => entry !== null);
}
