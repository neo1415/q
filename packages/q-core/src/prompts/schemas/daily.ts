import { z } from "zod";

import {
  QCommunicationProfileSchema,
  QOperatingModeSchema,
} from "@capital-q/contracts";

/**
 * The Q Daily's two model steps (DAILY, docs/specs/2026-10/daily.md §6).
 *
 * DAILY_STORY_WRITER reads one news story's public sources and writes it
 * up for a newspaper: what the sources say, attributed, with quotes copied
 * exactly. Code then keeps a quote only if it is verbatim in a source and
 * keeps the prose only if every number in it is in a source.
 *
 * DAILY_Q_TAKE is the only opinion in an edition: Q's reading of what the
 * stories just written mean for this person, citing the stories it rests
 * on. It is printed as Q inference, always.
 */

const COMMON = {
  operatingMode: QOperatingModeSchema,
  communicationProfile: QCommunicationProfileSchema,
  communicationGuidance: z.string().max(4_000),
  environmentNotes: z.string().max(2_000),
};

export const DAILY_STORY_WRITER_SCHEMA_NAME = "DailyStoryWriterResult";
export const DAILY_STORY_WRITER_SCHEMA_VERSION = 1;

export const DailyStoryWriterVariablesSchema = z
  .object({
    ...COMMON,
    /** The section the story is being considered for, as printed. */
    sectionTitle: z.string().max(80),
    /** The public topics the reader follows (sector, stage, market words). */
    topics: z.array(z.string().max(80)).max(12),
    /** The story's sources, numbered. Untrusted content throughout. */
    sources: z
      .array(
        z
          .object({
            index: z.number().int().min(0).max(7),
            publisher: z.string().max(120),
            title: z.string().max(300),
            publishedAt: z.string().max(40).nullable(),
            excerpt: z.string().max(6_000),
          })
          .strict(),
      )
      .min(1)
      .max(4),
  })
  .strict();
export type DailyStoryWriterVariables = z.infer<
  typeof DailyStoryWriterVariablesSchema
>;

export const DAILY_STORY_WRITER_UNTRUSTED = ["topics", "sources"] as const;

export const DailyStoryWriterResultSchema = z
  .object({
    /** False when the sources are not news about private capital, companies, investors or these topics. */
    relevant: z.boolean(),
    headline: z.string().trim().min(1).max(160),
    standfirst: z.string().trim().max(300),
    paragraphs: z.array(z.string().trim().min(1).max(900)).min(1).max(4),
    quotes: z
      .array(
        z
          .object({
            text: z.string().trim().min(8).max(400),
            speaker: z.string().trim().max(120).nullable(),
            sourceIndex: z.number().int().min(0).max(7),
          })
          .strict(),
      )
      .max(2),
    /** A funding round the sources report, exactly as printed. */
    deal: z
      .object({
        company: z.string().trim().min(1).max(120),
        amount: z.string().trim().max(60).nullable(),
        round: z.string().trim().max(60).nullable(),
        sourceIndex: z.number().int().min(0).max(7),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type DailyStoryWriterResult = z.infer<
  typeof DailyStoryWriterResultSchema
>;

export const DAILY_Q_TAKE_SCHEMA_NAME = "DailyQTakeResult";
export const DAILY_Q_TAKE_SCHEMA_VERSION = 1;

export const DailyQTakeVariablesSchema = z
  .object({
    ...COMMON,
    /** FOUNDER (raising) or INVESTOR (deploying). */
    readerRole: z.enum(["FOUNDER", "INVESTOR"]),
    /** The reader's own sectors, stages and markets, as labels. */
    readerFocus: z.array(z.string().max(80)).max(12),
    /** The reader's own raise, as they recorded it; null when none. Their own data, for their own edition. */
    readerRaise: z.string().max(200).nullable(),
    /** The stories in this edition, as written. Untrusted (public web). */
    stories: z
      .array(
        z
          .object({
            id: z.string().max(64),
            headline: z.string().max(200),
            standfirst: z.string().max(400),
          })
          .strict(),
      )
      .min(1)
      .max(12),
  })
  .strict();
export type DailyQTakeVariables = z.infer<typeof DailyQTakeVariablesSchema>;

export const DAILY_Q_TAKE_UNTRUSTED = ["stories"] as const;

export const DailyQTakeResultSchema = z
  .object({
    /** True when the stories give nothing worth a view for this reader. */
    noTake: z.boolean(),
    paragraphs: z.array(z.string().trim().min(1).max(700)).max(3),
    /** The ids of the stories each view rests on. */
    storyIds: z.array(z.string().max(64)).max(8),
  })
  .strict();
export type DailyQTakeResult = z.infer<typeof DailyQTakeResultSchema>;
