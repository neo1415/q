import { z } from "zod";

/**
 * Shapes of the server-assembled step contexts (F3 review, F6 raise
 * confirmation, F8 snapshot). Deterministic projections of what the founder
 * entered and what the canonical domains now hold -- labels and values,
 * never analysis, scoring, readiness, visibility or verification. The web
 * client validates them with these schemas before rendering.
 */

const Labelled = z.object({ key: z.string(), label: z.string() });
export type LabelledValue = z.infer<typeof Labelled>;

export const FounderReviewContextSchema = z.object({
  kind: z.literal("founder.review"),
  intent: Labelled.nullable(),
  company: z.object({
    name: z.string(),
    websiteUrl: z.string().nullable(),
    country: Labelled.nullable(),
    stage: Labelled.nullable(),
    description: z.string().nullable(),
  }),
  categories: z.array(
    z.object({
      nodeId: z.string(),
      label: z.string(),
      vocabularyCode: z.string(),
    }),
  ),
  /** Declared materials (labels); null when the step was not answered. */
  materials: z.array(Labelled).nullable(),
});
export type FounderReviewContext = z.infer<typeof FounderReviewContextSchema>;

export const FounderRaiseContextSchema = z.object({
  kind: z.literal("founder.raise"),
  /** Whether confirming creates the company's objective or recalibrates the active one. */
  mode: z.enum(["create", "recalibrate"]),
  currency: z.string(),
  amount: z.string(),
  instrument: Labelled.nullable(),
  timeframe: Labelled.nullable(),
  useOfFunds: z.array(Labelled),
  existing: z
    .object({ amount: z.string(), currency: z.string(), version: z.number() })
    .nullable(),
});
export type FounderRaiseContext = z.infer<typeof FounderRaiseContextSchema>;

export const FounderSnapshotContextSchema = z.object({
  kind: z.literal("founder.snapshot"),
  company: z.object({
    name: z.string(),
    websiteUrl: z.string().nullable(),
    country: Labelled.nullable(),
    stage: Labelled.nullable(),
    description: z.string().nullable(),
    categories: z.array(
      z.object({
        nodeId: z.string(),
        label: z.string(),
        vocabularyCode: z.string(),
      }),
    ),
  }),
  team: z.object({
    role: Labelled.nullable(),
    founderCount: z.number().int().nullable(),
    fullTimeFounderCount: z.number().int().nullable(),
    teamSize: z.number().int().nullable(),
    functions: z.array(Labelled),
  }),
  traction: z.object({
    signal: Labelled.nullable(),
    pilots: z.string().nullable(),
    revenueStatus: Labelled.nullable(),
    customers: z.string().nullable(),
    growth: Labelled.nullable(),
  }),
  raise: z.discriminatedUnion("status", [
    z.object({ status: z.literal("none"), raising: Labelled.nullable() }),
    z.object({
      status: z.literal("active"),
      amount: z.string(),
      currency: z.string(),
      instrumentCode: z.string().nullable(),
      useOfFundsSummary: z.string().nullable(),
      targetStage: z.string().nullable(),
    }),
  ]),
  materials: z.array(Labelled).nullable(),
  /** Whether the founder left a private follow-up note. Never its content. */
  followUpRecorded: z.boolean(),
  /** Facts still absent, by stable key. Absence, not judgement. */
  missing: z.array(z.string()),
});
export type FounderSnapshotContext = z.infer<
  typeof FounderSnapshotContextSchema
>;
