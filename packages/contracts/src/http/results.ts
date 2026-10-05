import { z } from "zod";

/**
 * A person's results on Capital Q (docs/specs/2026-10/admin.md §5): what
 * their activity here produced, from recorded events only, for a date
 * range, and downloadable as CSV or PDF. Their own organisation's records
 * only; unknown stays null, never 0.
 */

export const RESULTS_PATH = "/v1/results" as const;
export const RESULTS_REPORT_PATH = "/v1/results/report" as const;

export const RESULTS_RANGES = ["7d", "30d", "90d", "12m", "all"] as const;
export const ResultsRangeSchema = z.enum(RESULTS_RANGES);
export type ResultsRange = z.infer<typeof ResultsRangeSchema>;

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const ResultsQuerySchema = z
  .object({
    range: ResultsRangeSchema.optional(),
    from: Day.optional(),
    to: Day.optional(),
    format: z.enum(["csv", "pdf"]).optional(),
  })
  .strict();
export type ResultsQuery = z.infer<typeof ResultsQuerySchema>;

const Count = z.number().int().min(0);
const Money = z
  .object({ currencyCode: z.string().length(3), amount: z.string() })
  .strict();

/** An aggregate about other people's browsing: hidden below a floor of 3. */
export const FlooredCountSchema = z
  .object({ value: Count.nullable(), belowFloor: z.boolean() })
  .strict();

const Window = z
  .object({ from: Day.nullable(), to: Day, label: z.string().max(60) })
  .strict();

/**
 * Activity over the window, a bar per day (a window of a month or less) or
 * per week (Monday), oldest first. Recorded events only. Absent from an
 * older server.
 */
export const ResultsActivitySchema = z
  .object({
    bucket: z.enum(["DAY", "WEEK"]),
    points: z
      .array(
        z
          .object({
            start: Day,
            interests: Count,
            connections: Count,
            meetings: Count,
          })
          .strict(),
      )
      .max(60),
  })
  .strict();
export type ResultsActivity = z.infer<typeof ResultsActivitySchema>;

/**
 * How long an interest waited for its answer (accepted or declined), in
 * hours: the median over interests sent in the window that were answered.
 * Null when none were answered: unknown, never 0.
 */
export const ResultsResponseTimeSchema = z
  .object({
    medianHours: z.number().min(0).nullable(),
    answered: Count,
    waiting: Count,
  })
  .strict();

export const FounderResultsSchema = z
  .object({
    side: z.literal("FOUNDER"),
    organisationName: z.string().max(300),
    window: Window,
    raise: z
      .object({
        target: Money.nullable(),
        totals: z.array(
          z
            .object({
              currencyCode: z.string(),
              confirmed: z.string(),
              soft: z.string(),
            })
            .strict(),
        ),
        remaining: z.string().nullable(),
        inConversation: Count,
        committedInvestors: z.array(
          z
            .object({
              investorName: z.string().max(300),
              amount: z.string(),
              currencyCode: z.string(),
              bucket: z.enum(["CONFIRMED", "SOFT"]),
            })
            .strict(),
        ),
      })
      .strict()
      .nullable(),
    pipeline: z
      .object({
        byState: z.array(
          z.object({ state: z.string(), count: Count }).strict(),
        ),
        rows: z
          .array(
            z
              .object({
                investorName: z.string().max(300),
                state: z.string(),
                since: z.string(),
                /** For the link to the relationship. Absent from an older server. */
                investorOrganisationId: z.string().uuid().optional(),
              })
              .strict(),
          )
          .max(200),
      })
      .strict(),
    engagement: z
      .object({
        interestsReceived: Count,
        connections: Count,
        meetingsHeld: Count,
        profileOpens: FlooredCountSchema,
        pitchWatches: FlooredCountSchema,
      })
      .strict(),
    rehearsals: z
      .array(
        z
          .object({
            at: z.string(),
            counterpart: z.string().max(200),
            outcome: z.string().nullable(),
            score: z.number().int().min(0).max(100).nullable(),
            ratings: z.array(
              z.object({ dimension: z.string(), rating: z.string() }).strict(),
            ),
          })
          .strict(),
      )
      .max(100),
    documents: z.array(z.object({ type: z.string(), count: Count }).strict()),
    /** Distinct investor firms with any recorded step in the window. */
    investorsEngaged: Count.optional(),
    diligence: z
      .object({ requested: Count, fulfilled: Count })
      .strict()
      .optional(),
    /** How long the founder took to answer an investor's interest. */
    responseTime: ResultsResponseTimeSchema.optional(),
    activity: ResultsActivitySchema.optional(),
  })
  .strict();
export type FounderResults = z.infer<typeof FounderResultsSchema>;

export const InvestorResultsSchema = z
  .object({
    side: z.literal("INVESTOR"),
    organisationName: z.string().max(300),
    window: Window,
    funnel: z
      .object({
        seen: Count,
        saved: Count,
        interest: Count,
        connected: Count,
        met: Count,
        committed: Count,
      })
      .strict(),
    meetings: z
      .object({
        held: Count,
        upcoming: z
          .array(
            z
              .object({
                companyName: z.string().max(300),
                startsAt: z.string(),
              })
              .strict(),
          )
          .max(50),
      })
      .strict(),
    qWork: z
      .object({
        runs: z.array(
          z.object({ capability: z.string(), runs: Count }).strict(),
        ),
        errands: Count,
        documents: Count,
      })
      .strict(),
    pipelineFit: z
      .array(
        z
          .object({
            companyName: z.string().max(300),
            /** For the link to the relationship. Absent from an older server. */
            companyId: z.string().uuid().optional(),
            state: z.string(),
            excluded: z.boolean(),
            reasons: z.array(
              z
                .object({ kind: z.string(), detail: z.string().max(200) })
                .strict(),
            ),
          })
          .strict(),
      )
      .max(200),
    hasMandate: z.boolean(),
    /** Every relationship by where it stands now, declined included. */
    pipeline: z
      .object({
        byState: z.array(
          z.object({ state: z.string(), count: Count }).strict(),
        ),
      })
      .strict()
      .optional(),
    /** Interest the firm sent in the window, and what came of it. */
    interest: z
      .object({ sent: Count, accepted: Count, declined: Count })
      .strict()
      .optional(),
    /** How long founders took to answer the firm's interest. */
    responseTime: ResultsResponseTimeSchema.optional(),
    /** Commitments now (not superseded), by status, per currency. */
    commitments: z
      .array(
        z
          .object({
            status: z.enum(["STATED", "CONFIRMED", "WITHDRAWN"]),
            currencyCode: z.string().length(3),
            count: Count,
            amount: z.string(),
          })
          .strict(),
      )
      .max(30)
      .optional(),
    activity: ResultsActivitySchema.optional(),
  })
  .strict();
export type InvestorResults = z.infer<typeof InvestorResultsSchema>;

export const ResultsDtoSchema = z.discriminatedUnion("side", [
  FounderResultsSchema,
  InvestorResultsSchema,
  z.object({ side: z.literal("NONE") }).strict(),
]);
export type ResultsDto = z.infer<typeof ResultsDtoSchema>;
