import { z } from "zod";

import {
  Q_TASK_CLASSES,
  QArtifactIdSchema,
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
export const REVISE_MY_DOCUMENT = "documents.own.revise" as const;

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

export function createOwnWorkTools(ports: {
  readonly approvalInbox?: ApprovalInboxPort | undefined;
  readonly documents?: OwnDocumentsPort | undefined;
  readonly documentRevision?: DocumentRevisionPort | undefined;
}): readonly AnyQToolDefinition[] {
  return [
    ...(ports.approvalInbox === undefined
      ? []
      : [createListPendingApprovalsTool(ports.approvalInbox)]),
    ...(ports.documents === undefined
      ? []
      : [createListMyDocumentsTool(ports.documents)]),
    ...(ports.documentRevision === undefined
      ? []
      : [createReviseMyDocumentTool(ports.documentRevision)]),
  ];
}
