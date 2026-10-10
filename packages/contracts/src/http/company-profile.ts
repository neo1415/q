import { z } from "zod";

import { UuidSchema } from "../common/ids.js";
import { MoneySchema } from "../common/money.js";
import { UtcTimestampSchema } from "../common/time.js";

import { CompanyNetworkFactSchema } from "./companies.js";
import { CompanyRaiseViewSchema } from "./company-raise.js";
import { PitchSummaryDtoSchema } from "./media.js";

/**
 * `GET /v1/companies/:companyId/profile` — one company, as THIS reader may
 * see it (founder request 2026-10-02: a profile from Discover).
 *
 * The viewer's role is the server's answer, never the client's claim, and
 * it decides the shape:
 *
 *   INVESTOR  the network projection, its classified facts, the raise only
 *             where the disclosure evaluator allows this reader to view it,
 *             Capital Q's own organisation verification, and whether the
 *             company shared a pitch deck with them (the relationship
 *             chat's share, R34 — the one rule a document reaches another
 *             organisation by).
 *   FOUNDER   another company's founder: basic identity and the videos its
 *             owner opened to the network (ADR 0021). No overview, no
 *             raise, no deck, and no decision actions.
 *   OWNER     the company's own organisation, previewing.
 *
 * Every list of videos is what the player would sign for this reader: the
 * media service's own playback rule, asked per video. Nothing here is
 * founder-private, and absence is never a zero.
 */

export const COMPANY_PROFILE_SEGMENT = "/profile" as const;
/** `POST` — a short-lived signed read of the deck shared with the reader. */
export const COMPANY_PROFILE_DECK_DOWNLOAD_SEGMENT =
  "/profile/deck/download" as const;

/**
 * `GET` — the photo alone, for the avatar over a Discover pitch: the same
 * visibility and the same Q Card scope as the profile, nothing else read.
 */
export const COMPANY_PROFILE_PHOTO_SEGMENT = "/profile/photo" as const;

export const CompanyProfilePhotoDtoSchema = z
  .object({ photoUrl: z.string().url().nullable() })
  .strict();
export type CompanyProfilePhotoDto = z.infer<
  typeof CompanyProfilePhotoDtoSchema
>;

export const CompanyProfileViewerSchema = z.enum([
  "INVESTOR",
  "FOUNDER",
  "OWNER",
]);
export type CompanyProfileViewer = z.infer<typeof CompanyProfileViewerSchema>;

/** The deck the company shared with this reader; never a URL. */
export const CompanyProfileDeckSchema = z
  .object({
    title: z.string().min(1).max(300),
    sharedAt: UtcTimestampSchema,
    /** ADR 0042: false shows "Not virus-scanned yet" beside it. */
    scanned: z.boolean().default(true),
  })
  .strict();
export type CompanyProfileDeck = z.infer<typeof CompanyProfileDeckSchema>;

/**
 * One team member as an investor who can find the company sees them
 * (ADR 0041): the person's name, how they relate to the company, the title
 * they declared, whether they represent themselves as a founder, and their
 * declared professional summary, bounded. Never contact details, the
 * background summary, ids, or anything not declared for the team profile.
 */
export const COMPANY_TEAM_BIO_MAX = 600;
export const CompanyProfileTeamMemberSchema = z
  .object({
    name: z.string().min(1).max(200),
    relationshipType: z.enum([
      "team_member",
      "advisor",
      "board_member",
      "contractor",
      "other",
    ]),
    businessTitle: z.string().max(120).nullable(),
    isFounder: z.boolean(),
    shortBio: z.string().max(COMPANY_TEAM_BIO_MAX).nullable(),
    /**
     * 2026-10-08 (F9): where the name comes from. MEMBER (or absent): a
     * person on the company's team on Capital Q. PUBLIC_SOURCE: named in a
     * network-visible public-web claim (USER_CLAIM, never verified) on a
     * company with no members yet; the reader is told so.
     */
    source: z.enum(["MEMBER", "PUBLIC_SOURCE"]).optional(),
  })
  .strict();
export type CompanyProfileTeamMember = z.infer<
  typeof CompanyProfileTeamMemberSchema
>;

/**
 * What a founder said in a pitch video this reader may play (2026-10-08),
 * read deterministically from the pitch's transcript. The company's own
 * claim (USER_CLAIM, SELF_REPORTED), with the pitch and the moment it was
 * said as its provenance. It reaches exactly the people who may play the
 * pitch: the transcript is part of the pitch, never a separate disclosure.
 */
export const PitchClaimKindSchema = z.enum([
  "RAISE",
  "STAGE",
  "INSTRUMENT",
  "TRACTION",
  "USE_OF_FUNDS",
]);
export type PitchClaimKind = z.infer<typeof PitchClaimKindSchema>;

export const PitchClaimDtoSchema = z
  .object({
    kind: PitchClaimKindSchema,
    /** The founder's words, as transcribed. */
    statement: z.string().min(1).max(300),
    pitchId: UuidSchema,
    /** The owner's name for the video, where they named it. */
    pitchTitle: z.string().max(200).nullable(),
    /** Where in the pitch it is said, in whole seconds. */
    atSeconds: z.number().int().min(0).max(86_400),
    money: MoneySchema.nullable(),
    stageCode: z.string().max(40).nullable(),
    instrument: z.string().max(60).nullable(),
    truthClass: z.literal("USER_CLAIM"),
    evidenceStatus: z.literal("SELF_REPORTED"),
    source: z.literal("PITCH_VIDEO"),
  })
  .strict();
export type PitchClaimDto = z.infer<typeof PitchClaimDtoSchema>;

/**
 * The owner's view only: their pitch states a raise their profile does not
 * show as declared. The founder is told; nothing is decided for them.
 *
 *   SHOWN_FROM_PITCH       the raise is not shared, so investors who may
 *                          play the pitch see what it says, labelled so
 *   HIDDEN_BY_FOUNDER      they turned a raise share off: the overview
 *                          shows no raise, though the video still says it
 *   DIFFERS_FROM_DECLARED  the declared raise differs from what is said
 */
export const PitchRaiseNoticeSchema = z
  .object({
    state: z.enum([
      "SHOWN_FROM_PITCH",
      "HIDDEN_BY_FOUNDER",
      "DIFFERS_FROM_DECLARED",
    ]),
    said: PitchClaimDtoSchema,
  })
  .strict();
export type PitchRaiseNotice = z.infer<typeof PitchRaiseNoticeSchema>;

export const CompanyProfileOverviewSchema = z
  .object({
    legalName: z.string().nullable(),
    websiteUrl: z.string().nullable(),
    foundedDate: z.string().nullable(),
    primaryDescription: z.string().nullable(),
    /** Declared, confirmed industry nodes (taxonomy ids; the reader labels). */
    sectorNodeIds: z.array(UuidSchema).max(32),
    /** The current raise, only where it is disclosed to this reader. */
    raise: MoneySchema.nullable(),
    /** Capital Q's own organisation verification, never a self-claim. */
    organisationVerified: z.boolean(),
    facts: z.array(CompanyNetworkFactSchema).max(8),
    /**
     * Null: the company has shared no deck with this reader. That is not
     * "no deck exists" and the reader is never told which.
     */
    deck: CompanyProfileDeckSchema.nullable(),
    /**
     * The team, for an investor who can find the company (ADR 0041) and
     * the owner. Empty: none declared, or not shown to this reader.
     */
    team: z.array(CompanyProfileTeamMemberSchema).max(50).default([]),
    /** What the pitches this reader may play say; absent from older servers. */
    pitchClaims: z.array(PitchClaimDtoSchema).max(40).default([]),
    /**
     * The raise as said in a pitch, where the declared raise is not
     * disclosed to this reader and the founder has not hidden it. The
     * server decides; null otherwise.
     */
    raiseFromPitch: PitchClaimDtoSchema.nullable().default(null),
    /** OWNER only: the pitch and the declared raise disagree in what shows. */
    pitchRaiseNotice: PitchRaiseNoticeSchema.nullable().default(null),
    /**
     * The raise as this reader sees it on every surface (`raiseFor`): the
     * same answer the Discover card and Q give. `raise` and
     * `raiseFromPitch` above are derived from it. Absent from older servers.
     */
    raiseView: CompanyRaiseViewSchema.optional(),
  })
  .strict();
export type CompanyProfileOverview = z.infer<
  typeof CompanyProfileOverviewSchema
>;

export const CompanyProfileDtoSchema = z
  .object({
    viewer: CompanyProfileViewerSchema,
    companyId: UuidSchema,
    canonicalName: z.string(),
    shortDescription: z.string().nullable(),
    currentStageCode: z.string().nullable(),
    headquartersCountry: z.string().nullable(),
    headquartersCity: z.string().nullable(),
    /**
     * The company's photo, a short-lived signed URL, only where its Q Card
     * shows the photo to signed-in participants. Null: none, or not shown.
     */
    photoUrl: z.string().url().nullable(),
    /**
     * The company's cover, under its Q Card's own `cover` scope, the same
     * way (founder ask 2026-10-04). Absent from older servers.
     */
    coverUrl: z.string().url().nullable().optional(),
    /** Null for a FOUNDER viewer, by design. */
    overview: CompanyProfileOverviewSchema.nullable(),
    /** Every video this reader may play, newest first. */
    videos: z.array(PitchSummaryDtoSchema).max(30),
  })
  .strict();
export type CompanyProfileDto = z.infer<typeof CompanyProfileDtoSchema>;

export const CompanyProfileDeckDownloadDtoSchema = z
  .object({
    url: z.string().url(),
    expiresAt: UtcTimestampSchema,
    /** ADR 0042: false when the deck was never virus-scanned. */
    scanned: z.boolean().default(true),
  })
  .strict();
export type CompanyProfileDeckDownloadDto = z.infer<
  typeof CompanyProfileDeckDownloadDtoSchema
>;
