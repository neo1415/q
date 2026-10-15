import { z } from "zod";

import { UuidSchema } from "../common/ids.js";
import { QManifestControlSchema, Q_MANIFEST_CONTROLS_MAX } from "./ui-act.js";

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
/** Lane W: the records of one section actually visible now, at most. */
export const Q_MANIFEST_VISIBLE_REFS_MAX = 6;
/** Lane W: error, empty, loading and toast notices on the page, at most. */
export const Q_MANIFEST_NOTICES_MAX = 6;

export const QManifestSectionSchema = z
  .object({
    id: SlugSchema,
    kind: QManifestSectionKindSchema,
    refs: z.array(QManifestRefSchema).max(Q_MANIFEST_SECTION_REFS_MAX),
    /** How many items the section holds in all (refs may be the first few). */
    total: z.number().int().min(0).max(10_000),
    /**
     * Lane W (2026-10-15): the records of this section visible in the
     * viewport now, in screen order (a shared IntersectionObserver, read
     * when a turn is sent). Optional: an older web omits it. Each is read
     * back as the person like any ref; naming one grants nothing.
     */
    visible: z
      .array(QManifestRefSchema)
      .max(Q_MANIFEST_VISIBLE_REFS_MAX)
      .optional(),
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

/**
 * Lane A (2026-10-15): the result-block kinds a browser reports as drawn
 * on the Q stage. A closed list of its own, so this module needs nothing
 * from the result-block contract.
 */
export const Q_MANIFEST_DRAWN_KINDS = [
  "ANSWER_CARDS",
  "COMPARISON",
  "COMPARISON_CARDS",
  "TABLE",
  "CHART",
  "MAP",
  "TIMELINE",
  "ARTIFACT_REFERENCE",
  "CLARIFICATION_REQUEST",
] as const;
export const QManifestDrawnKindSchema = z.enum(Q_MANIFEST_DRAWN_KINDS);
export type QManifestDrawnKind = z.infer<typeof QManifestDrawnKindSchema>;

/**
 * What Q showed that this browser actually drew, after its code loaded
 * and committed: the run it came from and its block kinds. A report, not
 * authority -- it only lets Q refer to an object the person can see (a
 * tampered report can at most make Q mention an object on its own
 * screen); it grants no read.
 */
export const QManifestDrawnSchema = z
  .object({
    run: UuidSchema,
    kinds: z.array(QManifestDrawnKindSchema).min(1).max(8),
  })
  .strict();
export type QManifestDrawn = z.infer<typeof QManifestDrawnSchema>;

/**
 * Lane W: what a page shows instead of (or over) its records: an error, an
 * empty list, a loading frame, a toast. Closed kinds and codes; the
 * message text never travels.
 */
export const Q_MANIFEST_NOTICE_KINDS = [
  "ERROR",
  "EMPTY",
  "LOADING",
  "TOAST",
] as const;
export const QManifestNoticeKindSchema = z.enum(Q_MANIFEST_NOTICE_KINDS);
export type QManifestNoticeKind = z.infer<typeof QManifestNoticeKindSchema>;

export const Q_MANIFEST_NOTICE_CODES = [
  /** The whole page failed to render (the error boundary). */
  "PAGE_FAILED",
  /** The page or record is not there, or not theirs to see. */
  "NOT_FOUND",
  "OFFLINE",
  "PLAYBACK_FAILED",
  /** A toast saying something they did worked. */
  "DONE",
  /** A toast saying something they did failed. */
  "FAILED",
] as const;
export const QManifestNoticeCodeSchema = z.enum(Q_MANIFEST_NOTICE_CODES);
export type QManifestNoticeCode = z.infer<typeof QManifestNoticeCodeSchema>;

export const QManifestNoticeSchema = z
  .object({
    kind: QManifestNoticeKindSchema,
    code: QManifestNoticeCodeSchema.optional(),
    /** The section it shows in, when it is inside one. */
    section: SlugSchema.optional(),
  })
  .strict();
export type QManifestNotice = z.infer<typeof QManifestNoticeSchema>;

/** Lane W: the one pitch video on screen, as ids and closed states. */
export const Q_MANIFEST_MEDIA_STATES = [
  "PLAYING",
  "PAUSED",
  "BUFFERING",
  "ENDED",
  "FAILED",
] as const;
export const QManifestMediaStateSchema = z.enum(Q_MANIFEST_MEDIA_STATES);
export type QManifestMediaState = z.infer<typeof QManifestMediaStateSchema>;

/** Coarse position: never a timestamp the page could be fingerprinted by. */
export const Q_MANIFEST_MEDIA_POSITIONS = [
  "START",
  "EARLY",
  "MIDDLE",
  "LATE",
  "END",
] as const;
export const QManifestMediaPositionSchema = z.enum(Q_MANIFEST_MEDIA_POSITIONS);
export type QManifestMediaPosition = z.infer<
  typeof QManifestMediaPositionSchema
>;

export const QManifestMediaSchema = z
  .object({
    kind: z.literal("PITCH"),
    /** The company whose pitch it is; read back with get_company. */
    companyId: UuidSchema.optional(),
    /** The media asset; read back with read_my only for their own pitch. */
    mediaAssetId: UuidSchema.optional(),
    state: QManifestMediaStateSchema,
    position: QManifestMediaPositionSchema.optional(),
    muted: z.boolean().optional(),
  })
  .strict();
export type QManifestMedia = z.infer<typeof QManifestMediaSchema>;

/**
 * The page manifest (q.screen.v2). New fields are optional, so an older
 * web keeps working against a newer Q API and the reverse; `v` moves only
 * on a breaking change.
 *
 * Privacy line (lane W, deliberate): unsaved input -- what a person is
 * typing in a field and has not saved or sent -- is never part of the
 * manifest, not even as a "has typed" flag. Q answers "I can't see what
 * you're typing until you save or send it". No screenshots, no DOM text.
 */
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
    /**
     * RECOVERY-2026-10: the controls Q may operate on this page now, by
     * semantic id and kind (ui-act.ts). Ids only; never labels or values.
     */
    controls: z
      .array(QManifestControlSchema)
      .max(Q_MANIFEST_CONTROLS_MAX)
      .optional(),
    /** Lane A: the Q object drawn on this tab now, if any. */
    drawn: QManifestDrawnSchema.optional(),
    /** Lane W: errors, empty lists, loading frames and toasts showing. */
    notices: z
      .array(QManifestNoticeSchema)
      .max(Q_MANIFEST_NOTICES_MAX)
      .optional(),
    /** Lane W: the pitch video on screen, if any. */
    media: QManifestMediaSchema.optional(),
  })
  .strict();
export type QPageManifest = z.infer<typeof QPageManifestSchema>;

/**
 * Every distinct ref a manifest names: focus, top dialog, the playing
 * pitch's company, then visible records, then the rest.
 */
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
  if (manifest.media?.companyId !== undefined) {
    add({ kind: "COMPANY", id: manifest.media.companyId });
  }
  if (manifest.media?.mediaAssetId !== undefined) {
    add({ kind: "MEDIA", id: manifest.media.mediaAssetId });
  }
  for (const dialog of [...manifest.dialogs].reverse()) {
    for (const ref of dialog.refs) add(ref);
  }
  const inView = new Set(manifest.inView);
  const ordered = [
    ...manifest.sections.filter((section) => inView.has(section.id)),
    ...manifest.sections.filter((section) => !inView.has(section.id)),
  ];
  // Lane W: what is visible right now before the rest of its section.
  for (const section of ordered)
    for (const ref of section.visible ?? []) add(ref);
  for (const section of ordered) for (const ref of section.refs) add(ref);
  return out;
}
