import { z } from "zod";

import {
  QControlIdSchema,
  QNavigateDestinationSchema,
} from "@capital-q/contracts";

/**
 * Q Pitch tour actions, version 1 (blueprint §5; audit QP-F01).
 *
 * ONLY the blueprint primitives the app already backs with an acknowledged,
 * typed contract. Each one is dispatched by the host through an existing
 * path, never through a selector, URL, script or the DOM:
 *
 * - `openRoute`, `openCompany`, `showReview`, `showQJob` → the navigation
 *   lifecycle (NAVIGATE / OPEN_RECORD_PAGE; acknowledged DONE | FAILED);
 * - `selectTab`, `scrollTo` → a UI act on a registered control (UI_ACT;
 *   receipt DONE only once the page shows it);
 * - `buildComparison`, `askApprovedQuestion` → a governed Q run
 *   (CreateQRunRequest), so the Context Firewall still decides what Q may
 *   use. `askApprovedQuestion` is PROPOSED r2 (QP-F01 §3), pending owner
 *   approval.
 *
 * The audit lists as UNSUPPORTED, BACKED-but-EXCLUDED or director-local
 * (not here): focusEvidence, openDocument, playPitch, saveCompany,
 * focusGateQApplication, switchDemoContext, requestHumanApproval, and the
 * director commands pauseTour, resumeTour, goBack and jumpToChapter.
 *
 * Records are named by FIXTURE KEY, never by a canonical id: scripts are
 * environment-independent, and the host resolves a key to the canonical
 * record from data the current actor is authorised to read.
 */
export const TOUR_CONTRACT_VERSION = 1 as const;

export const TourActionIdSchema = z
  .string()
  .regex(/^ta_[a-z0-9][a-z0-9_-]{2,62}$/u);
export type TourActionId = z.infer<typeof TourActionIdSchema>;

/**
 * A record key, never a uuid or a name. `card-N` (N = 1..9) is the Nth
 * company card of the tour's latest acknowledged Q answer with cards: the
 * company comes from what the actor was actually shown (scene receipt), so
 * a script never hard-codes a company. `subject` is the tour's subject
 * company, named only by the server (CQ_Q_PITCH_SUBJECT_COMPANY_ID) and
 * re-checked for the viewer. Other keys name seeded demo records.
 */
export const FixtureKeySchema = z.string().regex(/^[a-z][a-z0-9-]{1,62}$/u);
export type FixtureKey = z.infer<typeof FixtureKeySchema>;

/** The tour's subject company (server setting, viewer-checked). */
export const SUBJECT_KEY = "subject" as const;

/** `card-N`: N (1-based) if the key is a receipt card key, else null. */
export function receiptCardIndex(key: FixtureKey): number | null {
  const match = /^card-([1-9])$/u.exec(key);
  return match?.[1] === undefined ? null : Number(match[1]);
}

/**
 * An owner-approved question, by id. The text lives in the script's
 * question table, so an action can never carry free model input.
 */
export const ApprovedQuestionIdSchema = z
  .string()
  .regex(/^q\.[a-z0-9][a-z0-9-]{1,62}$/u);
export type ApprovedQuestionId = z.infer<typeof ApprovedQuestionIdSchema>;

const TabControlIdSchema = QControlIdSchema.refine(
  (id) => id.startsWith("tab."),
  { message: "selectTab names a registered tab.* control" },
);
const SectionControlIdSchema = QControlIdSchema.refine(
  (id) => id.startsWith("section."),
  { message: "scrollTo names a registered section.* control" },
);

const base = { actionId: TourActionIdSchema } as const;

export const OpenRouteActionSchema = z
  .object({
    ...base,
    kind: z.literal("openRoute"),
    destination: QNavigateDestinationSchema,
  })
  .strict();

export const OpenCompanyActionSchema = z
  .object({
    ...base,
    kind: z.literal("openCompany"),
    company: FixtureKeySchema,
  })
  .strict();

export const SelectTabActionSchema = z
  .object({ ...base, kind: z.literal("selectTab"), target: TabControlIdSchema })
  .strict();

export const ScrollToActionSchema = z
  .object({
    ...base,
    kind: z.literal("scrollTo"),
    target: SectionControlIdSchema,
  })
  .strict();

export const ShowReviewActionSchema = z
  .object({ ...base, kind: z.literal("showReview") })
  .strict();

export const ShowQJobActionSchema = z
  .object({ ...base, kind: z.literal("showQJob"), job: FixtureKeySchema })
  .strict();

/** Two canonical companies, as the certified comparison (INV-COMPARE-TABLE). */
export const BuildComparisonActionSchema = z
  .object({
    ...base,
    kind: z.literal("buildComparison"),
    question: ApprovedQuestionIdSchema,
    companies: z.array(FixtureKeySchema).min(2).max(6),
  })
  .strict()
  .refine((a) => new Set(a.companies).size === a.companies.length, {
    message: "a comparison names each company once",
    path: ["companies"],
  });

/** PROPOSED r2 (QP-F01 §3): a governed Q question, by approved id only. */
export const AskApprovedQuestionActionSchema = z
  .object({
    ...base,
    kind: z.literal("askApprovedQuestion"),
    question: ApprovedQuestionIdSchema,
    /** The record the question is about, when it is about one. */
    subject: FixtureKeySchema.optional(),
  })
  .strict();

/**
 * PROPOSED r3 (blueprint §16.1 P8): a short Q-to-Q rehearsal through the
 * existing rehearsal session contracts. The narrator's side speaks only
 * approved lines (by id), the counterpart is the actor's own rehearsal
 * partner named by fixture key, and the session is bounded and always
 * ended explicitly (`q2q-rehearsal.ts`).
 */
export const RunShortRehearsalActionSchema = z
  .object({
    ...base,
    kind: z.literal("runShortRehearsal"),
    counterpart: FixtureKeySchema,
    lines: z.array(ApprovedQuestionIdSchema).min(1).max(4),
    maxMs: z.number().int().min(15_000).max(45_000),
  })
  .strict();

/**
 * A non-consequential act on a control the page registered (Q's own
 * deterministic UI acts, never a model): next/previous pitch, the nth item
 * of a list, a button whose click is not consequential (Save, open a panel),
 * a dialog or disclosure. Acknowledged by the page's own UI-act receipt.
 * Consequential actions (send, approve, book) are never tour actions.
 */
export const TOUR_UI_ACTS = [
  "NEXT",
  "PREVIOUS",
  "SELECT_ITEM",
  "ACTIVATE",
  "OPEN",
  "CLOSE",
  "EXPAND",
  "SCROLL_TO",
] as const;
export const UiActActionSchema = z
  .object({
    ...base,
    kind: z.literal("uiAct"),
    act: z.enum(TOUR_UI_ACTS),
    target: QControlIdSchema,
    /** SELECT_ITEM: 1-based position. */
    index: z.number().int().min(1).max(50).optional(),
  })
  .strict()
  .refine((a) => (a.act === "SELECT_ITEM") === (a.index !== undefined), {
    message: "SELECT_ITEM names a position, and only SELECT_ITEM does",
    path: ["index"],
  });

/**
 * Open one record page by fixture key (never a URL or id in a script): a
 * GateQ application in the actor's own inbox, or the actor's relationship
 * with a company, optionally at its call-booking dialog (the real flow,
 * opened, never submitted by the tour).
 */
export const OpenRecordActionSchema = z
  .object({
    ...base,
    kind: z.literal("openRecord"),
    record: z.enum([
      "GATEQ_APPLICATION",
      "RELATIONSHIP",
      "RELATIONSHIP_CALLS",
      // v6: the relationship's own tabs.
      "RELATIONSHIP_MESSAGES",
      "RELATIONSHIP_SCHEDULE",
    ]),
    key: FixtureKeySchema,
  })
  .strict();

/**
 * v6 founder track: open a fictional investor's page by fixture key
 * (`demoInvestor`): its profile, the founder's relationship with it, or
 * its rehearsal page. Never a URL or id in a script.
 */
export const OpenInvestorActionSchema = z
  .object({
    ...base,
    kind: z.literal("openInvestor"),
    investor: FixtureKeySchema,
    page: z.enum(["PROFILE", "RELATIONSHIP", "REHEARSE"]),
  })
  .strict();

/**
 * v6: a page that exists for the tour itself, by name (never a URL in a
 * script): the founder track's Capital Q pitch page.
 */
export const TOUR_PAGES = { CAPITAL_Q_PITCH: "/q-pitch/capital-q" } as const;
export const OpenTourPageActionSchema = z
  .object({
    ...base,
    kind: z.literal("openTourPage"),
    page: z.enum(["CAPITAL_Q_PITCH"]),
  })
  .strict();

export const TourActionSchema = z.discriminatedUnion("kind", [
  OpenRouteActionSchema,
  OpenCompanyActionSchema,
  SelectTabActionSchema,
  ScrollToActionSchema,
  ShowReviewActionSchema,
  ShowQJobActionSchema,
  BuildComparisonActionSchema,
  AskApprovedQuestionActionSchema,
  RunShortRehearsalActionSchema,
  UiActActionSchema,
  OpenRecordActionSchema,
  OpenInvestorActionSchema,
  OpenTourPageActionSchema,
]);
export type TourAction = z.infer<typeof TourActionSchema>;
export type TourActionKind = TourAction["kind"];

export const TOUR_ACTION_KINDS = [
  "openRoute",
  "openCompany",
  "selectTab",
  "scrollTo",
  "showReview",
  "showQJob",
  "buildComparison",
  "askApprovedQuestion",
  "runShortRehearsal",
  "uiAct",
  "openRecord",
  "openInvestor",
  "openTourPage",
] as const satisfies readonly TourActionKind[];
export const TourActionKindSchema = z.enum(TOUR_ACTION_KINDS);

/**
 * Why an action did not land. The navigation lifecycle's reasons
 * (NavigationFailure) and the UI-act receipt statuses, carried through
 * unchanged so Q can say them plainly, plus the director's own.
 */
export const TOUR_FAILURE_CODES = [
  // Navigation lifecycle (apps/web .../navigation-lifecycle.ts).
  "NOT_FOUND",
  "UNAUTHORIZED",
  "NO_ROUTER",
  "NOT_LANDED",
  "CONTROL_MISSING",
  "SUPERSEDED",
  // UI-act receipt (QUiActReceipt).
  "TARGET_MISSING",
  "NOT_APPLICABLE",
  "FAILED",
  // Q run settled without the expected result.
  "Q_RUN_FAILED",
  // Director / host.
  "FIXTURE_UNRESOLVED",
  "ACK_TIMEOUT",
  "CANCELLED",
  "NOT_VISIBLE",
] as const;
export const TourFailureCodeSchema = z.enum(TOUR_FAILURE_CODES);
export type TourFailureCode = z.infer<typeof TourFailureCodeSchema>;

/**
 * The host's acknowledgement of one dispatched action. `ok` only when the
 * effect is observed on screen: the route the router settled on, and the
 * expected panel visible. Never "there it is" before this.
 */
export const TourActionResultSchema = z
  .object({
    actionId: TourActionIdSchema,
    /** Which dispatch this answers; a stale attempt's result is ignored. */
    dispatchId: z.string().regex(/^ta_[a-z0-9_-]{3,63}#[0-9]{1,6}$/u),
    ok: z.boolean(),
    /** The route the browser settled on (path only), or null when none. */
    observedRoute: z
      .string()
      .regex(/^\/[A-Za-z0-9/_.~%-]{0,300}$/u)
      .nullable(),
    visible: z.boolean(),
    failureCode: TourFailureCodeSchema.nullable(),
  })
  .strict()
  .refine((r) => !r.ok || (r.visible && r.failureCode === null), {
    message: "an ok result is visible and carries no failure",
  })
  .refine((r) => r.ok || r.failureCode !== null, {
    message: "a failed result names its failure",
  });
export type TourActionResult = z.infer<typeof TourActionResultSchema>;
