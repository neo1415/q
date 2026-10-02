import { z } from "zod";

import type { MediaAsset } from "@capital-q/media";
import type { ActorContext } from "@capital-q/security";

import { sharingOf } from "./actions/pitch.js";
import type { AppActionPorts } from "./ports.js";

/**
 * The person's own records, as the pages already show them (ADR 0040 §2):
 * one Q tool, read_my(kind, filter), and a compact "what exists" index
 * read every turn, so Q never answers "no record" about something on
 * their own screen. Each kind reads through the page's own service with
 * the same authorization; nothing here reads a table.
 */

export const OWN_READ_KINDS = ["media", "documents", "rehearsals"] as const;
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
};

const MEDIA_STATUS: Readonly<Record<string, string>> = {
  CREATED: "waiting for the file",
  UPLOAD_PENDING: "waiting for the file",
  UPLOADING: "uploading",
  PROCESSING: "processing",
  FAILED: "needs a new file",
};

/** A pitch as the pitch page states it: live, private, in review, … */
export function pitchItem(asset: MediaAsset): OwnReadItem {
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
    title: asset.title ?? "Pitch",
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
      const assets = await ports.media.listCompanyMedia({ actor, companyId });
      return assets
        .filter(
          (asset) =>
            asset.purpose === "FOUNDER_PITCH" &&
            asset.status !== "DELETED" &&
            asset.supersededAt === null,
        )
        .map(pitchItem);
    }
    case "documents":
      return ports.documents === undefined ? null : ports.documents(actor);
    case "rehearsals":
      return ports.rehearsals === undefined ? null : ports.rehearsals(actor);
  }
}

const KIND_LABELS: Readonly<Record<OwnReadKind, string>> = {
  media: "Pitch videos",
  documents: "Documents",
  rehearsals: "Rehearsals",
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
