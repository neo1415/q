import { z } from "zod";

import {
  Q_TASK_CLASSES,
  QArtifactIdSchema,
  QDocumentEditSchema,
  QArtifactStatusSchema,
  QArtifactTypeSchema,
  type PermittedContextPlan,
} from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

import {
  allow,
  defineQTool,
  deny,
  type AnyQToolDefinition,
} from "../definition.js";
import { actorWideScope } from "../plan.js";
import type {
  ApprovalInboxPort,
  DocumentEditPort,
  DocumentRevisionPort,
  OwnDocumentsPort,
} from "../ports.js";

/**
 * R33: the person's own work, done from a conversation exactly as the
 * app's own controls do it — what is waiting for their approval, their
 * documents, and an investor's Save, Unsave and Pass. Each tool reaches
 * the same service the page calls, as the actor; the service authorises
 * again. The model picks the tool; nothing here reads their words.
 */

export const LIST_PENDING_APPROVALS = "approvals.pending.list" as const;
export const LIST_MY_DOCUMENTS = "documents.own.list" as const;
export const READ_MY_DOCUMENT = "documents.own.read" as const;
export const REVISE_MY_DOCUMENT = "documents.own.revise" as const;
export const EDIT_MY_DOCUMENT = "documents.own.edit" as const;

/** A person, in their own Q conversation. */
function ownConversation(
  actor: ActorContext,
  plan: PermittedContextPlan,
): boolean {
  if (actor.actorType !== "HUMAN") return false;
  const scope = actorWideScope(plan, "OWN_Q_CONVERSATION");
  return scope !== undefined && scope.filter.userId === actor.userId;
}

const OWN = {
  version: 1,
  status: "ACTIVE",
  requiredCapabilities: [],
  supportedPurposes: [...Q_TASK_CLASSES],
  requiredScopeKinds: ["OWN_Q_CONVERSATION"],
  approval: "NONE",
  idempotency: "SAFE_TO_REPEAT",
  owner: "q-tools",
  visibleStage: null,
} as const;

// --- approvals waiting for them -------------------------------------------

export const ListPendingApprovalsInputSchema = z.object({}).strict();
export type ListPendingApprovalsInput = z.infer<
  typeof ListPendingApprovalsInputSchema
>;

export const ListPendingApprovalsOutputSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            approvalId: z.string().max(64),
            summary: z.string().max(400),
            requestedAt: z.string().max(40),
            expiresAt: z.string().max(40),
          })
          .strict(),
      )
      .max(20),
  })
  .strict();
export type ListPendingApprovalsOutput = z.infer<
  typeof ListPendingApprovalsOutputSchema
>;

export function createListPendingApprovalsTool(
  inbox: ApprovalInboxPort,
): AnyQToolDefinition {
  return defineQTool<
    ListPendingApprovalsInput,
    ListPendingApprovalsOutput,
    null
  >({
    ...OWN,
    id: LIST_PENDING_APPROVALS,
    // Always on (R33): "what's waiting for me?" whatever the turn is about.
    core: true,
    providerName: "list_pending_approvals",
    description:
      "Lists every change waiting for the person's approval, across all their conversations, newest first, as their approvals list shows it (a summary of each and when it expires). Call it when they ask what is waiting for them, what needs their approval or what they have not decided yet. Nothing is approved by reading.",
    classification: "READ_ONLY",
    riskClass: "SAFE_READ",
    input: ListPendingApprovalsInputSchema,
    output: ListPendingApprovalsOutputSchema,
    authorize: (_input, { actor, plan }) =>
      Promise.resolve(
        ownConversation(actor, plan)
          ? allow<null>("CONFIDENTIAL", null)
          : deny<null>("NOT_AVAILABLE"),
      ),
    execute: async (_input, context) => {
      const items = await inbox.pending(context.actor);
      return {
        items: items.slice(0, 20).map((item) => ({
          approvalId: item.approvalId,
          summary: item.summary.slice(0, 400),
          requestedAt: item.requestedAt,
          expiresAt: item.expiresAt,
        })),
      };
    },
  });
}

// --- their documents ------------------------------------------------------

export const ListMyDocumentsInputSchema = z
  .object({
    limit: z
      .number()
      .int()
      .min(1)
      .max(20)
      .default(10)
      .describe("How many, newest first."),
  })
  .strict();
export type ListMyDocumentsInput = z.infer<typeof ListMyDocumentsInputSchema>;

export const ListMyDocumentsOutputSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            artifactId: z.string().max(64),
            type: z.string().max(64),
            status: z.string().max(32),
            title: z.string().max(200),
            currentVersion: z.number().int().min(0),
            updatedAt: z.string().max(40),
          })
          .strict(),
      )
      .max(20),
  })
  .strict();
export type ListMyDocumentsOutput = z.infer<typeof ListMyDocumentsOutputSchema>;

export function createListMyDocumentsTool(
  documents: OwnDocumentsPort,
): AnyQToolDefinition {
  return defineQTool<ListMyDocumentsInput, ListMyDocumentsOutput, null>({
    ...OWN,
    id: LIST_MY_DOCUMENTS,
    supportedPurposes: [
      "OWN_COMPANY_QUESTION",
      "INVESTOR_QUESTION",
      "ACTION_PREPARATION",
      "GENERAL_QUESTION",
    ],
    providerName: "list_my_documents",
    description:
      "Lists the documents Q has prepared for the person (pitch decks, briefs, one-pagers, mandates), newest first, with each one's title, type, status and latest version. Call it when they ask what documents they have, for an earlier deck or brief, or which version is current. Each document's own card has its PDF and PowerPoint downloads.",
    classification: "READ_ONLY",
    riskClass: "SAFE_READ",
    input: ListMyDocumentsInputSchema,
    output: ListMyDocumentsOutputSchema,
    authorize: (_input, { actor, plan }) =>
      Promise.resolve(
        ownConversation(actor, plan)
          ? allow<null>("CONFIDENTIAL", null)
          : deny<null>("NOT_AVAILABLE"),
      ),
    execute: async (input, context) => {
      const items = await documents.list(context.actor, input.limit);
      return {
        items: items.slice(0, 20).map((item) => ({
          artifactId: item.artifactId,
          type: item.type,
          status: item.status,
          title: item.title.slice(0, 200),
          currentVersion: item.currentVersion,
          updatedAt: item.updatedAt,
        })),
      };
    },
  });
}

// --- reading one of their documents (voiceq-63) ----------------------------

/** What a turn can carry of one document: enough to read it out or summarise. */
export const READ_MY_DOCUMENT_TEXT_MAX = 12_000;

export const ReadMyDocumentInputSchema = z
  .object({
    artifactId: QArtifactIdSchema.describe(
      "The document: the one open on their screen (named under WHERE THEY ARE NOW), on a document card in this conversation, or from list_my_documents.",
    ),
  })
  .strict();
export type ReadMyDocumentInput = z.infer<typeof ReadMyDocumentInputSchema>;

export const ReadMyDocumentOutputSchema = z
  .object({
    status: z.enum(["FOUND", "NONE"]),
    title: z.string().max(200).nullable(),
    type: z.string().max(64).nullable(),
    version: z.number().int().min(0).nullable(),
    /** Its sections as written, headings first; cut at a sentence when long. */
    text: z
      .string()
      .max(READ_MY_DOCUMENT_TEXT_MAX + 64)
      .nullable(),
    truncated: z.boolean(),
    /** What Q could not establish when it wrote it: unknown stays unknown. */
    gaps: z.array(z.string().max(300)).max(24),
  })
  .strict();
export type ReadMyDocumentOutput = z.infer<typeof ReadMyDocumentOutputSchema>;

/** A document's sections as one text a voice or a reader can follow. */
export function documentText(
  sections: readonly { readonly heading: string; readonly body: string }[],
): { readonly text: string; readonly truncated: boolean } {
  const whole = sections
    .map((section) => `${section.heading}\n${section.body}`)
    .join("\n\n");
  if (whole.length <= READ_MY_DOCUMENT_TEXT_MAX) {
    return { text: whole, truncated: false };
  }
  const cut = whole.slice(0, READ_MY_DOCUMENT_TEXT_MAX);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("\n"));
  return {
    text: `${end > READ_MY_DOCUMENT_TEXT_MAX / 2 ? cut.slice(0, end + 1) : cut}…`,
    truncated: true,
  };
}

export function createReadMyDocumentTool(
  documents: OwnDocumentsPort,
): AnyQToolDefinition | null {
  const read = documents.read;
  if (read === undefined) return null;
  return defineQTool<ReadMyDocumentInput, ReadMyDocumentOutput, null>({
    ...OWN,
    id: READ_MY_DOCUMENT,
    supportedPurposes: [
      "OWN_COMPANY_QUESTION",
      "INVESTOR_QUESTION",
      "ACTION_PREPARATION",
      "GENERAL_QUESTION",
    ],
    providerName: "read_my_document",
    description:
      "Reads one of the documents Q prepared for them, as its viewer shows it: title, version and its sections' text. Call it when they ask what a document says, to read it out, or to summarise or check it, above all the one open on their screen. NONE: not one of theirs, or still being prepared.",
    classification: "READ_ONLY",
    riskClass: "SAFE_READ",
    input: ReadMyDocumentInputSchema,
    output: ReadMyDocumentOutputSchema,
    authorize: (_input, { actor, plan }) =>
      Promise.resolve(
        ownConversation(actor, plan)
          ? allow<null>("CONFIDENTIAL", null)
          : deny<null>("NOT_AVAILABLE"),
      ),
    execute: async (input, context) => {
      // Read as the actor: the artifact service refuses what is not theirs.
      const found = await read(context.actor, input.artifactId).catch(
        () => null,
      );
      if (found === null || found.sections.length === 0) {
        return {
          status: "NONE",
          title: null,
          type: null,
          version: null,
          text: null,
          truncated: false,
          gaps: [],
        };
      }
      const { text, truncated } = documentText(found.sections);
      return {
        status: "FOUND",
        title: found.title.slice(0, 200),
        type: found.type.slice(0, 64),
        version: found.version,
        text,
        truncated,
        gaps: found.gaps.slice(0, 24).map((gap) => gap.slice(0, 300)),
      };
    },
  });
}

// Save, Unsave, Pass and Undo pass are declared once in the app's action
// registry (ADR 0040) and generated as Q tools (tools/app-actions.ts).

// --- revising one of their documents -------------------------------------

export const ReviseMyDocumentInputSchema = z
  .object({
    artifactId: QArtifactIdSchema.describe(
      "The document to change: its id from this conversation's document card or from list_my_documents.",
    ),
    changes: z
      .string()
      .trim()
      .min(3)
      .max(2_000)
      .describe(
        "What should change, in the person's own terms (e.g. 'shorten the executive summary', 'add our Lagos expansion to the traction slide').",
      ),
  })
  .strict();
export type ReviseMyDocumentInput = z.infer<typeof ReviseMyDocumentInputSchema>;

const RevisedDocumentSchema = z
  .object({
    artifactId: QArtifactIdSchema,
    type: QArtifactTypeSchema,
    status: QArtifactStatusSchema,
    title: z.string().trim().min(1).max(160),
    currentVersion: z.number().int().min(1),
  })
  .strict();

export const ReviseMyDocumentOutputSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("DOCUMENT_UPDATED"),
      document: RevisedDocumentSchema,
    })
    .strict(),
  z
    .object({
      status: z.enum(["NOT_FOUND", "NOT_REVISABLE", "FAILED"]),
    })
    .strict(),
]);
export type ReviseMyDocumentOutput = z.infer<
  typeof ReviseMyDocumentOutputSchema
>;

/**
 * Q revising a document it prepared (founder directive 2026-09-28): the
 * person asks for changes and gets a new version, with the earlier one
 * kept and fresh PDF/PPTX downloads on the new card. It writes only the
 * person's own private document, so it is INSTANT like preparing one (ADR
 * 0013 puts the consequential boundary at publish, share and send). The
 * artifact service finds the document as the actor and re-authorises it
 * under the run's plan; knowing an id grants nothing.
 */
export function createReviseMyDocumentTool(
  revision: DocumentRevisionPort,
): AnyQToolDefinition {
  return defineQTool<ReviseMyDocumentInput, ReviseMyDocumentOutput, null>({
    ...OWN,
    id: REVISE_MY_DOCUMENT,
    // Always offered (R33 core): "change my deck" can come mid-anything,
    // and a registered capability Q is not offered is one it denies.
    core: true,
    providerName: "revise_my_document",
    description:
      "Changes a document Q prepared for the person (a pitch deck, brief, one-pager or mandate) by writing a new version with the changes they ask for; the earlier version is kept and the new card has fresh PDF and PowerPoint downloads. Call it whenever they ask to edit, update, fix, shorten, extend or restyle one of their documents. Use the id from the document's card in this conversation, or call list_my_documents first to find it. NOT_FOUND: no such document of theirs. NOT_REVISABLE: it has nothing to revise yet.",
    classification: "SIDE_EFFECT",
    riskClass: "LOW_RISK_INTERNAL",
    visibleStage: null,
    input: ReviseMyDocumentInputSchema,
    output: ReviseMyDocumentOutputSchema,
    authorize: (_input, { actor, plan }) =>
      Promise.resolve(
        ownConversation(actor, plan)
          ? allow<null>("CONFIDENTIAL", null)
          : deny<null>("NOT_AVAILABLE"),
      ),
    execute: async (input, context) => {
      const outcome = await revision.revise({
        actor: context.actor,
        plan: context.plan,
        runId: context.runId,
        artifactId: input.artifactId,
        instruction: input.changes,
        ...(context.signal === undefined ? {} : { signal: context.signal }),
      });
      if (outcome.status !== "REVISED") return { status: outcome.status };
      const document = RevisedDocumentSchema.safeParse({
        artifactId: outcome.artifactId,
        type: outcome.type,
        status: outcome.artifactStatus,
        title: outcome.title.slice(0, 160),
        currentVersion: outcome.currentVersion,
      });
      return document.success
        ? { status: "DOCUMENT_UPDATED", document: document.data }
        : { status: "FAILED" };
    },
  });
}

// --- Q room W5: a typed edit of one of their documents ---------------------

export const EditMyDocumentInputSchema = z
  .object({
    artifactId: QArtifactIdSchema.describe(
      "The document: its id from its card, the Q room, or list_my_documents.",
    ),
    version: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe(
        "The version on their screen, when known (the room says it); the edit applies to that version.",
      ),
    edit: QDocumentEditSchema.describe(
      "One change. slide counts from 1 as they do (the page open in the room when they say 'this slide'). SHORTEN: fewer words. CHANGE_TITLE: the new title in their words (slide 1 is the cover and the document's name). SWAP_IMAGE: a different picture. REMOVE_IMAGE. REMOVE_SLIDE. MOVE_SLIDE: to the position in `to`.",
    ),
  })
  .strict();
export type EditMyDocumentInput = z.infer<typeof EditMyDocumentInputSchema>;

export const EditMyDocumentOutputSchema = z.discriminatedUnion("status", [
  // The same shape as revise_my_document's, so the answer carries the
  // document's card (and the room goes to the slide).
  z
    .object({
      status: z.literal("DOCUMENT_UPDATED"),
      document: RevisedDocumentSchema,
      slide: z.number().int().min(1).max(24),
      replayed: z.boolean(),
    })
    .strict(),
  z
    .object({
      status: z.literal("NOT_APPLICABLE"),
      reason: z.string().trim().min(1).max(200),
    })
    .strict(),
  z
    .object({
      status: z.enum(["CHANGED_SINCE", "NOT_FOUND", "NOT_EDITABLE", "FAILED"]),
    })
    .strict(),
]);
export type EditMyDocumentOutput = z.infer<typeof EditMyDocumentOutputSchema>;

/**
 * Q room W5 (R8): endless edits by voice or text, typed. Each writes a
 * new version of the person's own private draft (append-only; the old
 * version stays), so it is INSTANT like revising one: ADR 0013 puts the
 * consequential boundary at share and send, where approval binds to the
 * exact payload. The artifact service finds the document as the actor
 * and the same edit of the same version replays rather than repeats.
 */
export function createEditMyDocumentTool(
  port: DocumentEditPort,
): AnyQToolDefinition {
  return defineQTool<EditMyDocumentInput, EditMyDocumentOutput, null>({
    ...OWN,
    id: EDIT_MY_DOCUMENT,
    core: true,
    providerName: "edit_my_document",
    description:
      "Makes one specific change to a document Q made for them, by slide: 'make slide 3 shorter', 'swap this image', 'change the title to ...', 'remove slide 5', 'move the team slide to the end', 'use my team photo on slide 4' (USE_PICTURE with the photo's document id from their data room). Writes a new version (the old one is kept) and the room goes to that slide. For a change that is not one of these (rewrite, restyle, add content), use revise_my_document. replayed: it was already done. CHANGED_SINCE: the document changed after the version named; read it again. NOT_APPLICABLE: say the reason.",
    classification: "SIDE_EFFECT",
    riskClass: "LOW_RISK_INTERNAL",
    visibleStage: "REVISING_DOCUMENT",
    input: EditMyDocumentInputSchema,
    output: EditMyDocumentOutputSchema,
    authorize: (_input, { actor, plan }) =>
      Promise.resolve(
        ownConversation(actor, plan)
          ? allow<null>("CONFIDENTIAL", null)
          : deny<null>("NOT_AVAILABLE"),
      ),
    execute: async (input, context) => {
      const outcome = await port.edit({
        actor: context.actor,
        plan: context.plan,
        runId: context.runId,
        artifactId: input.artifactId,
        ...(input.version === undefined ? {} : { version: input.version }),
        edit: input.edit,
        ...(context.signal === undefined ? {} : { signal: context.signal }),
      });
      switch (outcome.status) {
        case "EDITED":
        case "REPLAYED": {
          const parsed = EditMyDocumentOutputSchema.safeParse({
            status: "DOCUMENT_UPDATED",
            document: {
              artifactId: outcome.artifactId,
              type: outcome.type,
              status: outcome.artifactStatus,
              title: outcome.title.slice(0, 160),
              currentVersion: outcome.version,
            },
            slide: outcome.slide,
            replayed: outcome.status === "REPLAYED",
          });
          return parsed.success ? parsed.data : { status: "FAILED" };
        }
        case "NOT_APPLICABLE":
          return {
            status: "NOT_APPLICABLE",
            reason: outcome.reason.slice(0, 200),
          };
        case "STALE":
          return { status: "CHANGED_SINCE" };
        case "NOT_FOUND":
        case "NOT_EDITABLE":
        case "FAILED":
          return { status: outcome.status };
      }
    },
  });
}

export function createOwnWorkTools(ports: {
  readonly approvalInbox?: ApprovalInboxPort | undefined;
  readonly documents?: OwnDocumentsPort | undefined;
  readonly documentRevision?: DocumentRevisionPort | undefined;
  readonly documentEdit?: DocumentEditPort | undefined;
}): readonly AnyQToolDefinition[] {
  return [
    ...(ports.approvalInbox === undefined
      ? []
      : [createListPendingApprovalsTool(ports.approvalInbox)]),
    ...(ports.documents === undefined
      ? []
      : [createListMyDocumentsTool(ports.documents)]),
    ...(ports.documents === undefined
      ? []
      : [createReadMyDocumentTool(ports.documents)].filter(
          (tool): tool is AnyQToolDefinition => tool !== null,
        )),
    ...(ports.documentRevision === undefined
      ? []
      : [createReviseMyDocumentTool(ports.documentRevision)]),
    ...(ports.documentEdit === undefined
      ? []
      : [createEditMyDocumentTool(ports.documentEdit)]),
  ];
}
