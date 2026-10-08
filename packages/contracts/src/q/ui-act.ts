import { z } from "zod";

/**
 * RECOVERY-2026-10 (lead contract): universal application control.
 *
 * A page registers its controls under stable semantic ids ("tab.mandate",
 * "section.risks", "list.investors", "menu.card"), each with a closed
 * kind. Q chooses a UI act on one of those ids; trusted page code performs
 * it through the page's own handler, the same one a click runs, and
 * reports a receipt. Q never gets selectors, coordinates, script or the
 * DOM. An id the page has not registered does nothing and is reported
 * TARGET_MISSING, never as success.
 *
 * Ids are names the code defines, not page text: they carry no labels,
 * values or record content (the q.screen.v2 manifest rule).
 */
export const QControlIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_-]{0,31}(\.[a-z0-9][a-z0-9_-]{0,47}){1,3}$/);
export type QControlId = z.infer<typeof QControlIdSchema>;

export const Q_CONTROL_KINDS = [
  "TAB",
  "SECTION",
  "LIST",
  "LIST_ITEM",
  "BUTTON",
  "MENU",
  "DISCLOSURE",
  "FILTER",
  "TOGGLE",
  "INPUT",
  "DIALOG",
  "CAROUSEL",
] as const;
export const QControlKindSchema = z.enum(Q_CONTROL_KINDS);
export type QControlKind = z.infer<typeof QControlKindSchema>;

/** What a control currently is; closed states only. */
export const Q_CONTROL_STATES = [
  "SELECTED",
  "OPEN",
  "CLOSED",
  "DISABLED",
  "ON",
  "OFF",
] as const;
export const QControlStateSchema = z.enum(Q_CONTROL_STATES);

export const QManifestControlSchema = z
  .object({
    id: QControlIdSchema,
    kind: QControlKindSchema,
    state: QControlStateSchema.optional(),
    /** LIST: how many items it holds (so "the third one" can be checked). */
    count: z.number().int().min(0).max(10_000).optional(),
  })
  .strict();
export type QManifestControl = z.infer<typeof QManifestControlSchema>;
export const Q_MANIFEST_CONTROLS_MAX = 48;

export const Q_UI_ACTS = [
  /** TAB: select it. */
  "SELECT_TAB",
  /** SECTION / any control: bring it into view. */
  "SCROLL_TO",
  /** The page: scroll by a step. */
  "SCROLL_DOWN",
  "SCROLL_UP",
  "SCROLL_TOP",
  "SCROLL_BOTTOM",
  /** INPUT / any focusable control. */
  "FOCUS",
  /** DISCLOSURE / MENU / DIALOG. */
  "EXPAND",
  "COLLAPSE",
  "OPEN",
  "CLOSE",
  /** LIST: select (and open) the nth item, 1-based. */
  "SELECT_ITEM",
  /** BUTTON / LIST_ITEM: what a click does; never a consequential action (those are app actions with approval). */
  "ACTIVATE",
  /** TOGGLE: set on or off. */
  "SET",
  /** FILTER: set a code value; null clears. */
  "FILTER",
  /** CAROUSEL / LIST: next and previous. */
  "NEXT",
  "PREVIOUS",
  /** Browser history. */
  "BACK",
  "FORWARD",
] as const;
export const QUiActSchema = z.enum(Q_UI_ACTS);
export type QUiAct = z.infer<typeof QUiActSchema>;

export const QUiActIntentSchema = z
  .object({
    kind: z.literal("UI_ACT"),
    /** One act id per request, so the receipt can be matched. */
    actId: z.string().regex(/^uia_[A-Za-z0-9_-]{6,48}$/),
    act: QUiActSchema,
    target: QControlIdSchema.optional(),
    /** SELECT_ITEM: 1-based position. */
    index: z.number().int().min(1).max(500).optional(),
    /** SET: on/off; FILTER: a code value or null to clear. */
    value: z
      .union([
        z.boolean(),
        z.string().regex(/^[A-Za-z0-9_.,:-]{1,64}$/),
        z.null(),
      ])
      .optional(),
  })
  .strict();
export type QUiActIntent = z.infer<typeof QUiActIntentSchema>;

export const Q_UI_ACT_STATUSES = [
  "DONE",
  /** The id is not registered on the page now (or the item index is out of range). */
  "TARGET_MISSING",
  /** The control is disabled or the act does not apply to its kind. */
  "NOT_APPLICABLE",
  /** The page's handler threw or the result could not be confirmed. */
  "FAILED",
] as const;
export const QUiActStatusSchema = z.enum(Q_UI_ACT_STATUSES);

/** What the page reports after performing (or refusing) a UI act. */
export const QUiActReceiptSchema = z
  .object({
    actId: z.string().regex(/^uia_[A-Za-z0-9_-]{6,48}$/),
    status: QUiActStatusSchema,
    /** The manifest seq after the act, so the server reads the new state. */
    seq: z.number().int().min(0).optional(),
  })
  .strict();
export type QUiActReceipt = z.infer<typeof QUiActReceiptSchema>;
