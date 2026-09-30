import { z } from "zod";

import { UuidSchema } from "../common/ids.js";
import { StageCodeSchema } from "../http/companies.js";
import {
  DISCOVER_FILTER_LIST_MAX,
  DiscoverRaiseFilterSchema,
} from "../http/discovery.js";
import { TaxonomyCanonicalCodeSchema } from "../http/taxonomy.js";
import { QEvidenceRefsSchema } from "./evidence-ref.js";
import type { QVoiceChoice, QVoiceDestination } from "./voice.js";

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
  "SET_Q_MOTION",
  "SET_VOICE",
  "SIGN_OUT",
  "OPEN_RECORD_PAGE",
  "OPEN_SETUP",
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
  "RELATIONSHIPS",
  // R33: every page a person can open from the app's own navigation.
  "SETTINGS",
  "VERIFICATION",
  "PITCH",
  "COMPANY_INTEREST",
  // R30 #7: the Saved list (/discover/saved).
  "SAVED",
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

/** R33: Q's motion on this device, as the Settings control sets it. */
export const Q_MOTION_CHOICES = ["full", "calm", "off"] as const;
export const QMotionChoiceSchema = z.enum(Q_MOTION_CHOICES);
export type QMotionChoice = z.infer<typeof QMotionChoiceSchema>;

export const QSetQMotionIntentSchema = z
  .object({ kind: z.literal("SET_Q_MOTION"), motion: QMotionChoiceSchema })
  .strict();

/**
 * R33: which voice Q speaks in on this device, as the Settings control
 * sets it. The same two values as `Q_VOICE_CHOICES` (voice.ts), restated
 * because voice.ts reads this module's schemas at load time.
 */
export const QSetVoiceIntentSchema = z
  .object({
    kind: z.literal("SET_VOICE"),
    voice: z.enum(["FEMALE", "MALE"] satisfies readonly QVoiceChoice[]),
  })
  .strict();

/**
 * R33: sign out of this browser, through the same server action the Sign
 * out button submits (this session only; other devices keep theirs).
 */
export const QSignOutIntentSchema = z
  .object({ kind: z.literal("SIGN_OUT") })
  .strict();

/**
 * R33: open one record's own page by id: a company, or the person's
 * relationship with a company or an investor organisation. The browser
 * builds the path from its fixed route map; the page authorises the read
 * server-side, as it does for a typed URL.
 */
export const Q_RECORD_PAGES = [
  "COMPANY",
  "RELATIONSHIP_COMPANY",
  "RELATIONSHIP_INVESTOR",
  // The chat itself (founder report 2026-09-30: "open the chat for me").
  "RELATIONSHIP_COMPANY_MESSAGES",
  "RELATIONSHIP_INVESTOR_MESSAGES",
] as const;
export const QRecordPageSchema = z.enum(Q_RECORD_PAGES);
export type QRecordPage = z.infer<typeof QRecordPageSchema>;

export const QOpenRecordPageIntentSchema = z
  .object({
    kind: z.literal("OPEN_RECORD_PAGE"),
    page: QRecordPageSchema,
    id: UuidSchema,
  })
  .strict();

/**
 * Setup reminders (founder directive 2026-09-27): take the person back to
 * their own unfinished setup. The journey comes from their own record on
 * the server, never from a model; the browser maps it to its fixed route.
 */
export const QOpenSetupIntentSchema = z
  .object({
    kind: z.literal("OPEN_SETUP"),
    journey: z.enum(["founder", "investor"]),
  })
  .strict();

/**
 * Discover filters, set by asking ("show me only fintech in Nigeria";
 * lead-owned contract change, ux/discover-filters). Replaces the reader's
 * filters on their own screen, exactly as the filter sheet does. Sectors
 * travel as taxonomy canonical codes, because a model knows "fintech" and
 * not a node id; the browser resolves them against the vocabulary it lists
 * and drops what it cannot resolve. Narrowing a feed changes nothing
 * server-side and is undone from the same control.
 */
export const QSetDiscoverFiltersIntentSchema = z
  .object({
    kind: z.literal("SET_DISCOVER_FILTERS"),
    sectorCodes: z
      .array(TaxonomyCanonicalCodeSchema)
      .max(DISCOVER_FILTER_LIST_MAX),
    stageCodes: z.array(StageCodeSchema).max(DISCOVER_FILTER_LIST_MAX),
    countryCodes: z
      .array(z.string().regex(/^[A-Z]{2}$/))
      .max(DISCOVER_FILTER_LIST_MAX),
    raise: DiscoverRaiseFilterSchema.nullable(),
    raiseDisclosedOnly: z.boolean(),
    verifiedOnly: z.boolean(),
    hasPitch: z.boolean(),
  })
  .strict();
export type QSetDiscoverFiltersIntent = z.infer<
  typeof QSetDiscoverFiltersIntentSchema
>;

/**
 * Q working the screen the person is on (founder report 2026-09-30: "it
 * would be nice if it could even scroll for me... take me anywhere"):
 * scroll, go back, bring a section of the page into view, or open one of
 * the page's own dialogs. Every target is a fixed name the page defines;
 * a name the page does not have does nothing.
 */
export const Q_SCREEN_ACTS = [
  "SCROLL_TOP",
  "SCROLL_BOTTOM",
  "PAGE_DOWN",
  "PAGE_UP",
  "GO_BACK",
  "SHOW_SECTION",
  "OPEN_BOOK_CALL",
  "OPEN_REMINDER",
] as const;
export const QScreenActSchema = z.enum(Q_SCREEN_ACTS);
export type QScreenAct = z.infer<typeof QScreenActSchema>;

export const Q_SCREEN_SECTIONS = [
  "history",
  "commitment",
  "next",
  "context",
  "objective",
  "relationships",
  "share",
  "applications",
] as const;
export const QScreenSectionSchema = z.enum(Q_SCREEN_SECTIONS);

export const QScreenActIntentSchema = z
  .object({
    kind: z.literal("SCREEN_ACT"),
    act: QScreenActSchema,
    section: QScreenSectionSchema.optional(),
  })
  .strict();
export type QScreenActIntent = z.infer<typeof QScreenActIntentSchema>;

export const QClientActionIntentSchema = z.discriminatedUnion("kind", [
  QScreenActIntentSchema,
  QSetDiscoverFiltersIntentSchema,
  QOpenRecordPageIntentSchema,
  QSetThemeIntentSchema,
  QReloadPageIntentSchema,
  QOpenWebsiteIntentSchema,
  QSetQMotionIntentSchema,
  QSetVoiceIntentSchema,
  QSignOutIntentSchema,
  QOpenSetupIntentSchema,
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
  "set_q_motion",
  "set_voice",
  "sign_out",
  "open_page",
  "control_screen",
  "continue_onboarding",
  "set_discover_filters",
] as const;

/**
 * R33: the tools that change something of the person's own AT ONCE, at
 * their word, reversible from the page (Save, Unsave, Pass; declining a
 * waiting change). Not client actions (the server records them) and not
 * "for approval": the answer tells a model these happen when called.
 */
export const Q_INSTANT_ACTION_TOOLS = [
  "save_company",
  "unsave_company",
  "pass_company",
  "decline_pending_proposal",
  "reassess_marketplace_readiness",
  "set_onboarding_reminders",
  // A new version of their own private document; the earlier one is kept.
  "revise_my_document",
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
  QSetQMotionIntentSchema,
  QSetVoiceIntentSchema,
  QSignOutIntentSchema,
  QOpenRecordPageIntentSchema,
  QOpenSetupIntentSchema,
  QSetDiscoverFiltersIntentSchema,
  QScreenActIntentSchema,
]);

export type QUiIntent = z.infer<typeof QUiIntentSchema>;
