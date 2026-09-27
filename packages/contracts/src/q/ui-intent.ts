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
 * only -- except OPEN_WEBSITE's validated http(s) URL, bounded below to the
 * person's own declared site. There is no general OPEN_URL, no RUN_SCRIPT,
 * no SET_HTML and no CALL_API, and a string that looks like JavaScript
 * inside a text field is text.
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
  "SET_THEME",
  "RELOAD_PAGE",
  "OPEN_WEBSITE",
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

/**
 * Client actions (R20/R33, founder live test 2026-09-27 #4): things the
 * app itself does in the person's browser, which Q now does when asked
 * instead of saying it cannot. Each comes only from a typed tool whose
 * authorize step allowed it for this run; the browser performs it through
 * the same code its own controls use.
 */
export const Q_THEME_CHOICES = ["light", "dark", "system"] as const;
export const QThemeChoiceSchema = z.enum(Q_THEME_CHOICES);
export type QThemeChoice = z.infer<typeof QThemeChoiceSchema>;

export const QSetThemeIntentSchema = z
  .object({ kind: z.literal("SET_THEME"), theme: QThemeChoiceSchema })
  .strict();

export const QReloadPageIntentSchema = z
  .object({ kind: z.literal("RELOAD_PAGE") })
  .strict();

export const Q_WEBSITE_URL_MAX_LENGTH = 2048;

/**
 * An http(s) URL, absolute, with no credentials in it. The one shape a
 * website Q opens may take; anything else (javascript:, data:, a relative
 * path, user:pass@host) fails here, on the server and again in the browser.
 */
export const QWebsiteUrlSchema = z
  .string()
  .trim()
  .max(Q_WEBSITE_URL_MAX_LENGTH)
  .refine((raw) => {
    try {
      const url = new URL(raw);
      return (
        (url.protocol === "https:" || url.protocol === "http:") &&
        url.hostname.length > 0 &&
        url.username === "" &&
        url.password === ""
      );
    } catch {
      return false;
    }
  }, "an absolute http(s) URL without credentials");

/**
 * Open a website in a new tab (opened with noopener and noreferrer).
 * Deliberately not a general OPEN_URL: the tool that produces it allows
 * only the person's own declared website (from their own company or
 * investor record) or an address they gave in their own words this turn.
 */
export const QOpenWebsiteIntentSchema = z
  .object({ kind: z.literal("OPEN_WEBSITE"), url: QWebsiteUrlSchema })
  .strict();

export const QClientActionIntentSchema = z.discriminatedUnion("kind", [
  QSetThemeIntentSchema,
  QReloadPageIntentSchema,
  QOpenWebsiteIntentSchema,
]);
export type QClientActionIntent = z.infer<typeof QClientActionIntentSchema>;

/**
 * The model-facing names of the tools that produce a client action, so the
 * answer can tell a model these happen at once (not "for approval").
 */
export const Q_CLIENT_ACTION_TOOLS = [
  "set_theme",
  "reload_page",
  "open_website",
] as const;

/**
 * What a client-action tool returns once its authorize step allowed it:
 * the intent the answer carries to the screen, which the browser performs
 * as the answer arrives.
 */
export const QClientActionToolResultSchema = z
  .object({
    status: z.literal("SCREEN_WILL_DO_IT"),
    clientAction: QClientActionIntentSchema,
  })
  .strict();
export type QClientActionToolResult = z.infer<
  typeof QClientActionToolResultSchema
>;

export const QUiIntentSchema = z.discriminatedUnion("kind", [
  QOpenCompanyIntentSchema,
  QShowComparisonIntentSchema,
  QFocusSectionIntentSchema,
  QShowEvidenceIntentSchema,
  QNavigateIntentSchema,
  QSetThemeIntentSchema,
  QReloadPageIntentSchema,
  QOpenWebsiteIntentSchema,
]);

export type QUiIntent = z.infer<typeof QUiIntentSchema>;
