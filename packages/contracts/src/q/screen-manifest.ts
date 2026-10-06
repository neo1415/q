import { z } from "zod";

import { UuidSchema } from "../common/ids.js";

/**
 * Q room R1: what the whole page shows, as references (q.screen.v2).
 *
 * Every page publishes a typed manifest of what it shows: its sections
 * (the whole page, not only what is scrolled into view), the tab, the
 * filters, the open dialogs and what is in focus. The browser sends ids
 * and closed kinds only. Labels, values and page text never travel: the
 * Q API reads each record back through the same read services and
 * authorisation the page used, as the asker, and a record that does not
 * resolve for them is dropped silently. So a tampered client can only
 * name ids, and naming an id grants nothing.
 */

/** The record kinds a page can show, each read back by its own service. */
export const Q_MANIFEST_REF_KINDS = [
  "COMPANY",
  "INVESTOR_ORGANISATION",
  /** A document Q made for them (an artifact). */
  "ARTIFACT",
  /** A file their company uploaded (data room, certificate, deck file). */
  "UPLOADED_DOCUMENT",
  "MEETING",
  "REMINDER",
  /** A change waiting for their approval. */
  "APPROVAL",
  /** Q's work for them (a delegation / standing instruction). */
  "Q_WORK",
  "CAPITAL_ROUND",
  "GATEQ_APPLICATION",
  "MEDIA",
] as const;
export const QManifestRefKindSchema = z.enum(Q_MANIFEST_REF_KINDS);
export type QManifestRefKind = z.infer<typeof QManifestRefKindSchema>;

export const QManifestRefSchema = z
  .object({ kind: QManifestRefKindSchema, id: UuidSchema })
  .strict();
export type QManifestRef = z.infer<typeof QManifestRefSchema>;

/** What a section of a page is; a closed list, never free text. */
export const Q_MANIFEST_SECTION_KINDS = [
  "COMPANY_FEED",
  "COMPANY_LIST",
  "INVESTOR_LIST",
  "RELATIONSHIP_LIST",
  "CHAT",
  "COMPANY_PROFILE",
  "ELEVATOR",
  "DATA_ROOM",
  "DECK",
  "TEAM",
  "DOCUMENT_LIST",
  "UPLOAD_LIST",
  "WORK_LIST",
  "APPROVAL_LIST",
  "CAPITAL_ROUNDS",
  "GATEQ_INBOX",
  "GATEQ_APPLICATION",
  "SCHEDULE",
  "SETTINGS",
  "DAILY",
  "PITCH",
  "Q_ROOM_CARD",
  "OTHER",
] as const;
export const QManifestSectionKindSchema = z.enum(Q_MANIFEST_SECTION_KINDS);
export type QManifestSectionKind = z.infer<typeof QManifestSectionKindSchema>;

/** What an open dialog or sheet is; a closed list. */
export const Q_MANIFEST_DIALOG_KINDS = [
  "COMPANY_PREVIEW",
  "PROFILE",
  "DOCUMENT_VIEWER",
  "BOOK_CALL",
  "REMINDER",
  "FILTERS",
  "SHARE",
  "APPLICATION",
  "CONFIRM",
  "OTHER",
] as const;
export const QManifestDialogKindSchema = z.enum(Q_MANIFEST_DIALOG_KINDS);
export type QManifestDialogKind = z.infer<typeof QManifestDialogKindSchema>;

/** The tabs a page can be on; a closed list the pages share. */
export const Q_MANIFEST_TABS = [
  "overview",
  "elevator",
  "dataroom",
  "deck",
  "team",
  "messages",
  "calls",
  "diligence",
  "inbox",
  "gate",
  "find",
  "claim",
  "applications",
  "yours",
  "saved",
  "passed",
] as const;
export const QManifestTabSchema = z.enum(Q_MANIFEST_TABS);
export type QManifestTab = z.infer<typeof QManifestTabSchema>;

/** Filter keys a page can report; values are codes, never prose. */
export const Q_MANIFEST_FILTER_KEYS = [
  "sector",
  "stage",
  "country",
  "raise",
  "verified",
  "pitch",
  "view",
] as const;
export const QManifestFilterKeySchema = z.enum(Q_MANIFEST_FILTER_KEYS);

/** A slug the page uses for a section or dialog; an id, not content. */
const SlugSchema = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/);

/**
 * Bounds that keep the manifest a few kilobytes: it rides on every run
 * request and in the voice line's sealed token.
 */
export const Q_MANIFEST_SECTIONS_MAX = 12;
export const Q_MANIFEST_SECTION_REFS_MAX = 12;
export const Q_MANIFEST_DIALOGS_MAX = 3;
export const Q_MANIFEST_DIALOG_REFS_MAX = 4;

export const QManifestSectionSchema = z
  .object({
    id: SlugSchema,
    kind: QManifestSectionKindSchema,
    refs: z.array(QManifestRefSchema).max(Q_MANIFEST_SECTION_REFS_MAX),
    /** How many items the section holds in all (refs may be the first few). */
    total: z.number().int().min(0).max(10_000),
  })
  .strict();
export type QManifestSection = z.infer<typeof QManifestSectionSchema>;

export const QManifestDialogSchema = z
  .object({
    id: SlugSchema,
    kind: QManifestDialogKindSchema,
    refs: z.array(QManifestRefSchema).max(Q_MANIFEST_DIALOG_REFS_MAX),
  })
  .strict();
export type QManifestDialog = z.infer<typeof QManifestDialogSchema>;

export const QPageManifestSchema = z
  .object({
    v: z.literal(2),
    /** Increases with every change on this tab; a server keeps the newest. */
    seq: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    tab: QManifestTabSchema.optional(),
    filters: z
      .partialRecord(
        QManifestFilterKeySchema,
        z.string().regex(/^[A-Za-z0-9_.,:-]{1,64}$/),
      )
      .optional(),
    /** Section ids scrolled into view now. */
    inView: z.array(SlugSchema).max(Q_MANIFEST_SECTIONS_MAX),
    sections: z.array(QManifestSectionSchema).max(Q_MANIFEST_SECTIONS_MAX),
    /** The modal stack, top last. */
    dialogs: z.array(QManifestDialogSchema).max(Q_MANIFEST_DIALOGS_MAX),
    /** The one record in focus: the Discover card, the open card. */
    focus: QManifestRefSchema.optional(),
  })
  .strict();
export type QPageManifest = z.infer<typeof QPageManifestSchema>;

/** Every distinct ref a manifest names, focus and top dialog first. */
export function manifestRefs(manifest: QPageManifest): readonly QManifestRef[] {
  const seen = new Set<string>();
  const out: QManifestRef[] = [];
  const add = (ref: QManifestRef) => {
    const key = `${ref.kind}:${ref.id.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ kind: ref.kind, id: ref.id.toLowerCase() });
  };
  if (manifest.focus !== undefined) add(manifest.focus);
  for (const dialog of [...manifest.dialogs].reverse()) {
    for (const ref of dialog.refs) add(ref);
  }
  const inView = new Set(manifest.inView);
  const ordered = [
    ...manifest.sections.filter((section) => inView.has(section.id)),
    ...manifest.sections.filter((section) => !inView.has(section.id)),
  ];
  for (const section of ordered) for (const ref of section.refs) add(ref);
  return out;
}
