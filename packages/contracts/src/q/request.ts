import { z } from "zod";

import { QCapabilitySchema, QClientModalitySchema } from "./capability.js";
import {
  Q_OBJECTIVE_MAX_LENGTH,
  QLocaleSchema,
  QRequestContextSchema,
} from "./context.js";
import { UuidSchema } from "../common/ids.js";
import { QConversationIdSchema, QRunIdSchema } from "./ids.js";
import { QPageManifestSchema } from "./screen-manifest.js";
import { QSubjectRefsSchema, type QSubjectRef } from "./subject.js";
import { QWorkspacePaneStateSchema } from "./ui-intent.js";
import { QContractVersionSchema } from "./version.js";

/**
 * What a person may say to Q in one turn. Bounded: an unbounded string at a
 * trust boundary is a cost, a prompt-injection surface and a storage problem
 * all at once. The limit is a V1 technical bound in line with the other
 * free-text contracts in this package, not a product rule.
 */
export const Q_MESSAGE_TEXT_MAX_LENGTH = 8000;

/** A surface's opening words: a greeting and a short briefing, never a page. */
export const Q_OPENING_MAX_LENGTH = 1200;

export const QUserMessageInputSchema = z
  .object({
    text: z.string().trim().min(1).max(Q_MESSAGE_TEXT_MAX_LENGTH),
  })
  .strict();

export type QUserMessageInput = z.infer<typeof QUserMessageInputSchema>;

/**
 * What the person is watching as they ask (R18: Q watches the video with
 * us): a pitch and the playback position. A request, never authority --
 * the Q API authorises the asset for the asker with the pitch playback
 * rule and the company's visibility before anything enters the run's
 * context, and drops it silently when refused, exactly as if absent.
 */
export const QViewingMomentSchema = z
  .object({
    kind: z.literal("PITCH_PLAYBACK"),
    companyId: UuidSchema,
    mediaAssetId: UuidSchema,
    positionSeconds: z.number().int().min(0).max(7200),
  })
  .strict();
export type QViewingMoment = z.infer<typeof QViewingMomentSchema>;

/**
 * The screens a person can be on when they ask (R21). A closed list the
 * web maps its routes onto; OTHER for anything else. Not pixels.
 */
export const Q_SCREEN_ROUTES = [
  "HOME",
  "DISCOVER",
  "CAPITAL",
  "PROFILE",
  "COMPANY_VISIBILITY",
  "COMPANY_INTEREST",
  "COMPANY",
  "PITCH",
  "RELATIONSHIPS",
  "RELATIONSHIP_COMPANY",
  "RELATIONSHIP_INVESTOR",
  "VERIFICATION",
  "ONBOARDING",
  // The Q Daily (founder live 2026-10-01): "summarize everything here" on
  // the Daily was answered from older conversation text.
  "DAILY",
  // voiceq-63: their documents, and Q's work page ("Needs you").
  "DOCUMENTS",
  "WORK",
  "OTHER",
] as const;
export const QScreenRouteSchema = z.enum(Q_SCREEN_ROUTES);

/** The surface a typed question came from (Q intelligence step 1). */
export const Q_ASK_SURFACES = ["CHAT", "DOCK", "STAGE"] as const;
export const QAskSurfaceSchema = z.enum(Q_ASK_SURFACES);
export type QAskSurface = z.infer<typeof QAskSurfaceSchema>;
export type QScreenRoute = z.infer<typeof QScreenRouteSchema>;

/**
 * What is on the person's screen as they ask (R21): the screen, and the
 * canonical entities it shows -- a company, an investor organisation, an
 * open Q document. The pitch and playback position travel as `viewing`
 * (R18), not here. A request, never authority: each entity is resolved
 * for the asker through its owning context exactly like a named subject,
 * and one that does not resolve is dropped silently, as if absent.
 */
/**
 * Q Workspace (DECISIONS 71): the workspace as this tab shows it, for the
 * navigation decision (W4). Set by the web only when the Q Workspace shell
 * is on for this tab; absent means off or an older web. A display hint for
 * emitting workspace-only intents (LAYOUT_SET, navigate targets) and for
 * the move policy's hard rules -- never authority: a page path here grants
 * nothing, and every move is still validated and authorised as a click.
 */
export const Q_WORKSPACE_PATH_MAX = 512;
export const QWorkspaceScreenSchema = z
  .object({
    pagePane: QWorkspacePaneStateSchema,
    qPane: QWorkspacePaneStateSchema,
    /** The current page in the page pane (its path). */
    at: z.string().max(Q_WORKSPACE_PATH_MAX).optional(),
    /** The page before Q's last move (its path). */
    previous: z.string().max(Q_WORKSPACE_PATH_MAX).optional(),
    /** Unsaved work on the page (the leave guard). */
    dirty: z.boolean().optional(),
    /** The person is typing or scrolling in the page pane. */
    busy: z.boolean().optional(),
    /**
     * Pinned workspace (owner addendum, 13 Nov 2026). Shared-contract
     * assessment: the pin is client state of this tab (sessionStorage,
     * like the pane layout's own store; no DB), so it travels here, in the
     * one workspace screen W4's move policy already reads -- a minor,
     * optional addition (absent = not pinned; the web sends it only when
     * true, so an older q-api never sees it unless a person pins). The
     * navigation decision applies it as one more guard (PINNED, in
     * gateByReading): a move becomes an offer, an explicit GO becomes an
     * "unpin and open" offer. No independent navigation system, no new
     * intent kind, no persistence. A hint like `dirty`: it only ever holds
     * a move back, never grants one.
     */
    pinned: z.boolean().optional(),
  })
  .strict();
export type QWorkspaceScreen = z.infer<typeof QWorkspaceScreenSchema>;

export const QScreenContextSchema = z
  .object({
    route: QScreenRouteSchema,
    companyId: UuidSchema.optional(),
    investorOrganisationId: UuidSchema.optional(),
    documentId: UuidSchema.optional(),
    /**
     * Q room W3 (R3): the page of documentId open in the Q room's viewer
     * (1-based), so "this page" and "read it to me" mean that page. A
     * position, never authority.
     */
    documentPage: z.number().int().min(1).max(10_000).optional(),
    /**
     * voiceq-63: a document Q prepared for them, open in a viewer on this
     * Capital Q tab (founder, live 2026-10-04: Q opened the prep PDF and
     * could not read what it showed). An id, never authority: its words
     * are read only through read_my_document, which reads it as the asker
     * through the documents' own service and refuses anything not theirs.
     */
    artifactId: UuidSchema.optional(),
    /**
     * Q room W5 (R8): the slide of artifactId open in the Q room's deck
     * surface (1-based) and the version it shows, so "this slide" means
     * that slide and an edit applies to the version on screen. A
     * position, never authority.
     */
    artifactSlide: z.number().int().min(1).max(24).optional(),
    artifactVersion: z.number().int().min(1).max(10_000).optional(),
    /**
     * The device's IANA time zone as the person asks (live test 2026-09-28
     * #2): "tomorrow at 2 PM" is resolved by code in this zone, never in
     * UTC by accident. A request like the rest: a zone the runtime does not
     * know is ignored, and it grants nothing.
     */
    timeZone: z
      .string()
      .regex(/^[A-Za-z]+(\/[A-Za-z0-9_+-]+){0,2}$/)
      .max(64)
      .optional(),
    /**
     * Q room R1: what the whole page shows (sections, tab, filters, open
     * dialogs), as ids and closed kinds only. Read back on the server
     * through each record's own service, as the asker; a ref that does not
     * resolve for them is dropped silently. It grants nothing.
     */
    manifest: QPageManifestSchema.optional(),
    /**
     * Lane 8: documents the person attached in Q's composer, newest last.
     * Ids only, never authority: each is read solely through
     * read_attached_document, which reads it as the asker through the
     * Evidence service (document.view in their own organisation) and
     * refuses one that is not theirs.
     */
    attachedDocumentIds: z.array(UuidSchema).min(1).max(5).optional(),
    /**
     * Q intelligence step 1: which of Q's surfaces they asked from -- the
     * dock beside a page, or the Q page in its presence (STAGE) or chat
     * view. A closed kind for Q's situation line, never authority; a
     * spoken turn is VOICE on the server whatever this says.
     */
    surface: QAskSurfaceSchema.optional(),
    /**
     * Q Workspace: present only when the workspace shell is on for this
     * tab (QWorkspaceScreenSchema). A display hint, never authority.
     */
    workspace: QWorkspaceScreenSchema.optional(),
  })
  .strict();
export type QScreenContext = z.infer<typeof QScreenContextSchema>;

/**
 * The screen with only the entities the caller has bound for this person
 * (owner live test, 7 Nov 2026, R1). One rule for every place that narrows
 * a screen -- the run as recorded, the Context Firewall's plan -- so a field
 * added to the contract is never silently lost on the way to Q.
 *
 * Only the fields that NAME an entity are judged: a company, an investor
 * organisation and a document (with its page) ride only when `bound` says
 * so; an artifact's slide and version ride only with the artifact. Every
 * other field is a hint about the person's own screen (route, surface, time
 * zone, manifest, attached ids, the Q Workspace's panes) that grants nothing
 * and is kept as the strict schema accepted it. A new entity-naming field
 * must be added here, and the contract tests fail until it is.
 */
export function screenWithBoundEntities(
  screen: QScreenContext,
  bound: (ref: QSubjectRef) => boolean,
): QScreenContext {
  const {
    companyId,
    investorOrganisationId,
    documentId,
    documentPage,
    artifactId,
    artifactSlide,
    artifactVersion,
    ...hints
  } = screen;
  return {
    ...hints,
    ...(artifactId === undefined
      ? {}
      : {
          artifactId,
          ...(artifactSlide === undefined ? {} : { artifactSlide }),
          ...(artifactVersion === undefined ? {} : { artifactVersion }),
        }),
    ...(companyId !== undefined && bound({ kind: "COMPANY", companyId })
      ? { companyId }
      : {}),
    ...(investorOrganisationId !== undefined &&
    bound({ kind: "INVESTOR_ORGANISATION", investorOrganisationId })
      ? { investorOrganisationId }
      : {}),
    ...(documentId !== undefined && bound({ kind: "DOCUMENT", documentId })
      ? {
          documentId,
          ...(documentPage === undefined ? {} : { documentPage }),
        }
      : {}),
  };
}

/** The screen fields `screenWithBoundEntities` judges as naming an entity. */
export const Q_SCREEN_ENTITY_FIELDS = [
  "companyId",
  "investorOrganisationId",
  "documentId",
  "documentPage",
  "artifactId",
  "artifactSlide",
  "artifactVersion",
] as const;

/**
 * PUBLIC. The body a client sends to start a Q run (doc 22 §67).
 *
 * Strict, and deliberately small. What a client may say: which capability it
 * wants, what it is trying to achieve, what it is asking, which canonical
 * subjects it means, how it is interacting, and which conversation this
 * continues. What it may not say, and what fails validation if it tries:
 * who it is, which tenant it is in, what it is permitted to see, how
 * consequential the request is, which model or prompt to use, which tools
 * exist, or that anything has been approved. Every one of those is resolved
 * server-side or belongs to a later packet's internal contract.
 *
 * Extra fields are rejected rather than stripped. A client that sends
 * `tenantId` or `approved: true` is either broken or probing, and in both
 * cases a loud failure is more useful than silent acceptance.
 */
export const CreateQRunRequestSchema = z
  .object({
    capability: QCapabilitySchema,
    /** Optional; when absent the message itself states the objective. */
    objective: z.string().trim().min(1).max(Q_OBJECTIVE_MAX_LENGTH).optional(),
    message: QUserMessageInputSchema,
    subjects: QSubjectRefsSchema.optional(),
    modality: QClientModalitySchema,
    locale: QLocaleSchema.optional(),
    conversationId: QConversationIdSchema.optional(),
    /** R18: asked while watching a pitch; authorised server-side or dropped. */
    viewing: QViewingMomentSchema.optional(),
    /** R21: what is on screen; each entity resolved for the asker or dropped. */
    screen: QScreenContextSchema.optional(),
    /**
     * What Q's surface said to the person before this first question (the
     * welcome or briefing on Home: "There are companies in your feed…").
     * Kept as Q's opening line of a NEW conversation, so a follow-up such
     * as "what are these companies?" has what it refers to. Ignored when
     * the run continues a conversation. It is what this person's own
     * screen showed them, read as conversation (data, never instruction),
     * and it grants nothing.
     */
    opening: z.string().trim().min(1).max(Q_OPENING_MAX_LENGTH).optional(),
  })
  .strict();

export type CreateQRunRequest = z.infer<typeof CreateQRunRequestSchema>;

/**
 * PUBLIC. A follow-up message into an existing run (doc 22 §77) -- the
 * answer to a clarification, or the next turn of a conversation.
 */
export const AppendQRunMessageRequestSchema = z
  .object({ message: QUserMessageInputSchema })
  .strict();

export type AppendQRunMessageRequest = z.infer<
  typeof AppendQRunMessageRequestSchema
>;

/**
 * INTERNAL. The fully resolved unit of work handed to the Q runtime: the
 * server-resolved context plus the person's input.
 *
 * Assembled only by the Q API after authentication, actor resolution and
 * policy have run. Never parsed from a client body. There is no field for a
 * system prompt, a provider, a model, a tool list or a permission override,
 * and there will not be one here: advanced controls for trusted callers, if
 * they are ever needed, belong in a separate internal contract so that this
 * one cannot be weakened by accident.
 */
export const QRequestEnvelopeSchema = z
  .object({
    contractVersion: QContractVersionSchema,
    context: QRequestContextSchema,
    input: QUserMessageInputSchema,
    /** The run this request continues, when it is a follow-up turn. */
    continuesRunId: QRunIdSchema.optional(),
  })
  .strict();

export type QRequestEnvelope = z.infer<typeof QRequestEnvelopeSchema>;
