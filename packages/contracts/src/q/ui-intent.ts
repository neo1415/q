import { z } from "zod";

import { UuidSchema } from "../common/ids.js";
import { QEvidenceRefsSchema } from "./evidence-ref.js";
import type { QVoiceDestination } from "./voice.js";

/**
 * A known Capital Q UI action Q may suggest (doc 12 §70-71).
 *
 * Q proposes navigation; the client decides whether and how to perform it,
 * under the same permission checks the person would face clicking the same
 * thing. Every intent is a closed shape with identifier or enum parameters
 * only. There is no OPEN_URL, no RUN_SCRIPT, no SET_HTML and no CALL_API,
 * and a string that looks like JavaScript inside a text field is text.
 *
 * Intents refer to companies rather than to a generic subject because these
 * are the screens that exist. Investor and relationship surfaces gain their
 * own intents when those screens do -- additively.
 */
export const Q_UI_INTENT_KINDS = [
  "OPEN_COMPANY",
  "SHOW_COMPARISON",
  "FOCUS_SECTION",
  "SHOW_EVIDENCE",
  "NAVIGATE",
] as const;

export type QUiIntentKind = (typeof Q_UI_INTENT_KINDS)[number];

export const QUiIntentKindSchema = z.enum(Q_UI_INTENT_KINDS);

/**
 * Sections of the company surface a client knows how to focus. Bounded to
 * what the information architecture defines today (doc 17); a section name
 * is never free text.
 */
export const Q_UI_COMPANY_SECTIONS = [
  "OVERVIEW",
  "TEAM",
  "PITCH",
  "FINANCIALS",
  "CAPITAL_OBJECTIVE",
  "EVIDENCE",
  "DOCUMENTS",
] as const;

export type QUiCompanySection = (typeof Q_UI_COMPANY_SECTIONS)[number];

export const QUiCompanySectionSchema = z.enum(Q_UI_COMPANY_SECTIONS);

/** Companies in one comparison view. Matches the comparison block bound. */
export const Q_COMPARISON_SUBJECTS_MIN = 2;
export const Q_COMPARISON_SUBJECTS_MAX = 6;

export const QOpenCompanyIntentSchema = z
  .object({ kind: z.literal("OPEN_COMPANY"), companyId: UuidSchema })
  .strict();

export const QShowComparisonIntentSchema = z
  .object({
    kind: z.literal("SHOW_COMPARISON"),
    companyIds: z
      .array(UuidSchema)
      .min(Q_COMPARISON_SUBJECTS_MIN)
      .max(Q_COMPARISON_SUBJECTS_MAX),
  })
  .strict();

export const QFocusSectionIntentSchema = z
  .object({
    kind: z.literal("FOCUS_SECTION"),
    companyId: UuidSchema,
    section: QUiCompanySectionSchema,
  })
  .strict();

export const QShowEvidenceIntentSchema = z
  .object({
    kind: z.literal("SHOW_EVIDENCE"),
    evidenceRefs: QEvidenceRefsSchema.min(1),
  })
  .strict();

/**
 * Where a typed request may take the person (CQ-QACT-001): the platform's
 * own top-level surfaces, by name. A subset of the spoken destinations, so
 * a typed "take me to Discover" and a spoken one go to the same place
 * through the same route map; the setup and form hand-offs are the
 * interview's own and are not offered here. Never a path, never a URL.
 */
export const Q_NAVIGATE_DESTINATIONS = [
  "HOME",
  "PROFILE",
  "CAPITAL",
  "DISCOVER",
  "COMPANY_VISIBILITY",
] as const satisfies readonly QVoiceDestination[];

export type QNavigateDestination = (typeof Q_NAVIGATE_DESTINATIONS)[number];

export const QNavigateDestinationSchema = z.enum(Q_NAVIGATE_DESTINATIONS);

export const QNavigateIntentSchema = z
  .object({
    kind: z.literal("NAVIGATE"),
    destination: QNavigateDestinationSchema,
  })
  .strict();

export const QUiIntentSchema = z.discriminatedUnion("kind", [
  QOpenCompanyIntentSchema,
  QShowComparisonIntentSchema,
  QFocusSectionIntentSchema,
  QShowEvidenceIntentSchema,
  QNavigateIntentSchema,
]);

export type QUiIntent = z.infer<typeof QUiIntentSchema>;
