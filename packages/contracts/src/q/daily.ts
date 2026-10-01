import { z } from "zod";

/**
 * The Q Daily (DAILY, docs/specs/2026-10/daily.md): a personal newspaper
 * of the week's (or day's) news about the things a person invests in or
 * raises for, gathered from public sources, written with every claim
 * cited, and laid out as a newspaper for email, the reader and a PDF.
 *
 * Every story carries at least one source. Q's take is the only opinion in
 * an edition and is always `Q_INFERENCE`; stories report what a source
 * says and are attributed to it, never stated as verified fact.
 */

export const Q_DAILY_SECTION_CODES = [
  "LEAD",
  "YOUR_SECTOR",
  "YOUR_MARKET",
  "DEALS",
  "PEOPLE",
  "Q_TAKE",
] as const;
export const QDailySectionCodeSchema = z.enum(Q_DAILY_SECTION_CODES);
export type QDailySectionCode = z.infer<typeof QDailySectionCodeSchema>;

/** The sections a person can turn on or off (the lead is always printed). */
export const Q_DAILY_OPTIONAL_SECTIONS = [
  "YOUR_SECTOR",
  "YOUR_MARKET",
  "DEALS",
  "PEOPLE",
  "Q_TAKE",
] as const satisfies readonly QDailySectionCode[];
export const QDailyOptionalSectionSchema = z.enum(Q_DAILY_OPTIONAL_SECTIONS);
export type QDailyOptionalSection = z.infer<typeof QDailyOptionalSectionSchema>;

export const Q_DAILY_FREQUENCIES = ["WEEKLY", "DAILY", "OFF"] as const;
export const QDailyFrequencySchema = z.enum(Q_DAILY_FREQUENCIES);
export type QDailyFrequency = z.infer<typeof QDailyFrequencySchema>;

const HttpsUrlSchema = z
  .string()
  .url()
  .max(2_048)
  .refine((value) => value.startsWith("https://"), "https only");

export const QDailySourceSchema = z
  .object({
    url: HttpsUrlSchema,
    publisher: z.string().min(1).max(120),
    title: z.string().max(300),
    publishedAt: z.string().max(40).nullable(),
  })
  .strict();
export type QDailySource = z.infer<typeof QDailySourceSchema>;

export const QDailyQuoteSchema = z
  .object({
    /** Verbatim from the source (checked in code before it is kept). */
    text: z.string().min(8).max(400),
    speaker: z.string().max(120).nullable(),
    sourceIndex: z.number().int().min(0).max(7),
  })
  .strict();
export type QDailyQuote = z.infer<typeof QDailyQuoteSchema>;

export const QDailyImageSchema = z
  .object({
    url: HttpsUrlSchema,
    alt: z.string().min(1).max(200),
    /** Printed under the picture, always. */
    credit: z.string().min(1).max(160),
    creditUrl: HttpsUrlSchema.nullable(),
    /**
     * STOCK: a licensed stock photograph (Pexels). PUBLISHER_THUMBNAIL: the
     * thumbnail a publisher offers in its own feed, shown only hotlinked
     * and linked to the article, never re-hosted or embedded in a file.
     */
    kind: z.enum(["STOCK", "PUBLISHER_THUMBNAIL"]),
    linkUrl: HttpsUrlSchema.nullable(),
  })
  .strict();
export type QDailyImage = z.infer<typeof QDailyImageSchema>;

export const QDailyDealSchema = z
  .object({
    company: z.string().min(1).max(120),
    /** As printed in the source ("$12 million"), never re-computed. */
    amount: z.string().max(60).nullable(),
    /** The amount in US dollars when the source states it in dollars; drawn in the diagram. */
    amountUsd: z.number().nonnegative().nullable(),
    round: z.string().max(60).nullable(),
    sourceIndex: z.number().int().min(0).max(7),
  })
  .strict();
export type QDailyDeal = z.infer<typeof QDailyDealSchema>;

export const QDailyStorySchema = z
  .object({
    id: z.string().min(1).max(64),
    section: QDailySectionCodeSchema,
    headline: z.string().min(1).max(200),
    standfirst: z.string().max(400),
    paragraphs: z.array(z.string().min(1).max(1_200)).max(6),
    quotes: z.array(QDailyQuoteSchema).max(3),
    sources: z.array(QDailySourceSchema).min(1).max(8),
    image: QDailyImageSchema.nullable(),
    deal: QDailyDealSchema.nullable(),
    /** False when the model step failed and the source's own summary is shown. */
    written: z.boolean(),
  })
  .strict();
export type QDailyStory = z.infer<typeof QDailyStorySchema>;

export const QDailySectionSchema = z
  .object({
    code: QDailySectionCodeSchema,
    title: z.string().max(80),
    stories: z.array(QDailyStorySchema).max(8),
  })
  .strict();
export type QDailySection = z.infer<typeof QDailySectionSchema>;

export const QDailyChartSchema = z
  .object({
    title: z.string().max(120),
    unit: z.literal("USD"),
    bars: z
      .array(
        z
          .object({
            label: z.string().max(60),
            value: z.number().nonnegative(),
            formatted: z.string().max(40),
            storyId: z.string().max(64),
          })
          .strict(),
      )
      .min(2)
      .max(8),
    source: z.string().max(160),
  })
  .strict();
export type QDailyChart = z.infer<typeof QDailyChartSchema>;

export const QDailyTakeSchema = z
  .object({
    paragraphs: z.array(z.string().min(1).max(900)).min(1).max(3),
    /** The stories it rests on; a take with none is not printed. */
    storyIds: z.array(z.string().max(64)).min(1).max(8),
    truthClass: z.literal("Q_INFERENCE"),
  })
  .strict();
export type QDailyTake = z.infer<typeof QDailyTakeSchema>;

export const QDailyEditionSchema = z
  .object({
    id: z.string().uuid(),
    number: z.number().int().min(1),
    editionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    frequency: z.enum(["WEEKLY", "DAILY"]),
    readerName: z.string().max(120).nullable(),
    /** The public topics the edition followed, as printed in the masthead. */
    topics: z.array(z.string().max(80)).max(12),
    lead: QDailyStorySchema.nullable(),
    sections: z.array(QDailySectionSchema).max(6),
    briefs: z.array(QDailyStorySchema).max(10),
    chart: QDailyChartSchema.nullable(),
    qTake: QDailyTakeSchema.nullable(),
    generatedAt: z.string().max(40),
  })
  .strict();
export type QDailyEdition = z.infer<typeof QDailyEditionSchema>;

export const QDailyPreferencesSchema = z
  .object({
    frequency: QDailyFrequencySchema,
    email: z.boolean(),
    sections: z.array(QDailyOptionalSectionSchema).max(5),
    /** When the next edition is due; null when off. */
    nextDueAt: z.string().max(40).nullable(),
  })
  .strict();
export type QDailyPreferences = z.infer<typeof QDailyPreferencesSchema>;

export const SetQDailyPreferencesRequestSchema = z
  .object({
    frequency: QDailyFrequencySchema.optional(),
    email: z.boolean().optional(),
    sections: z.array(QDailyOptionalSectionSchema).max(5).optional(),
  })
  .strict();
export type SetQDailyPreferencesRequest = z.infer<
  typeof SetQDailyPreferencesRequestSchema
>;

export const QDailyEditionSummarySchema = z
  .object({
    id: z.string().uuid(),
    number: z.number().int().min(1),
    editionDate: z.string().max(10),
    frequency: z.enum(["WEEKLY", "DAILY"]),
    headline: z.string().max(200).nullable(),
  })
  .strict();
export type QDailyEditionSummary = z.infer<typeof QDailyEditionSummarySchema>;

export const QDailyHomeDtoSchema = z
  .object({
    latest: QDailyEditionSchema.nullable(),
    archive: z.array(QDailyEditionSummarySchema).max(30),
    /** Cursor for the next archive page (an edition date), or null. */
    nextCursor: z.string().max(10).nullable(),
    preferences: QDailyPreferencesSchema,
    /** True while an edition the person asked for is being prepared. */
    preparing: z.boolean(),
  })
  .strict();
export type QDailyHomeDto = z.infer<typeof QDailyHomeDtoSchema>;

export const QDailyRequestDtoSchema = z
  .object({
    status: z.enum(["QUEUED", "ALREADY_QUEUED", "TOO_SOON", "OFF"]),
    /** TOO_SOON: when another edition can be asked for. */
    retryAfter: z.string().max(40).nullable(),
  })
  .strict();
export type QDailyRequestDto = z.infer<typeof QDailyRequestDtoSchema>;

export const Q_DAILY_PATH = "/v1/q/daily" as const;
export const Q_DAILY_PREFERENCES_PATH = "/v1/q/daily/preferences" as const;
export const Q_DAILY_REQUESTS_PATH = "/v1/q/daily/requests" as const;
export const Q_DAILY_EDITION_PATH = "/v1/q/daily/editions/:editionId" as const;
export const Q_DAILY_EDITION_PDF_PATH =
  "/v1/q/daily/editions/:editionId/pdf" as const;

export function qDailyEditionPath(editionId: string): string {
  return `/v1/q/daily/editions/${encodeURIComponent(editionId)}`;
}
export function qDailyEditionPdfPath(editionId: string): string {
  return `${qDailyEditionPath(editionId)}/pdf`;
}

/** The reader's own address in the web app. */
export const Q_DAILY_READER_HREF = "/daily" as const;
