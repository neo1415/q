import { z } from "zod";

import {
  Q_TASK_CLASSES,
  QArtifactIdSchema,
  QArtifactStatusSchema,
  QArtifactTypeSchema,
  QBrandKitSchema,
  QDocumentAuditSchema,
  type PermittedContextPlan,
  type QBrandKit,
  type QBrandKitState,
  type QDocumentAudit,
} from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

import {
  allow,
  defineQTool,
  deny,
  type AnyQToolDefinition,
} from "../definition.js";
import { actorWideScope } from "../plan.js";

/**
 * DOCS: the document studio from a conversation (spec §6). Their brand
 * kit read and suggested, a document's audit read, and their confirmed
 * brand applied to one of their documents as a new version.
 *
 * Confirming a brand is never a tool: Q suggests, the person presses "Use
 * this brand" on Documents (the capability registry offers that screen).
 * Every port acts as the actor; the services authorise again.
 */

export const GET_BRAND_KIT = "documents.brand.get" as const;
export const SUGGEST_BRAND_KIT = "documents.brand.suggest" as const;
export const AUDIT_MY_DOCUMENT = "documents.own.audit" as const;
export const APPLY_MY_BRAND = "documents.own.brand" as const;

export type DocumentStudioPort = {
  readonly brandState: (actor: ActorContext) => Promise<QBrandKitState>;
  readonly suggestBrand: (
    actor: ActorContext,
  ) => Promise<
    | { readonly status: "SUGGESTED"; readonly kit: QBrandKit }
    | { readonly status: "NO_WEBSITE" | "UNREADABLE" | "NO_ORGANISATION" }
  >;
  readonly audit: (
    actor: ActorContext,
    artifactId: string,
  ) => Promise<
    | {
        readonly status: "FOUND";
        readonly title: string;
        readonly version: number;
        readonly audit: QDocumentAudit | undefined;
      }
    | { readonly status: "NOT_FOUND" }
  >;
  readonly applyBrand: (input: {
    readonly actor: ActorContext;
    readonly plan: PermittedContextPlan;
    readonly runId: string;
    readonly artifactId: string;
  }) => Promise<
    | {
        readonly status: "APPLIED";
        readonly artifactId: string;
        readonly type: string;
        readonly artifactStatus: string;
        readonly title: string;
        readonly currentVersion: number;
      }
    | { readonly status: "NOT_FOUND" | "NO_BRAND" | "NOT_REVISABLE" | "FAILED" }
  >;
};

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

const authorizeOwn = (
  _input: unknown,
  { actor, plan }: { actor: ActorContext; plan: PermittedContextPlan },
) =>
  Promise.resolve(
    ownConversation(actor, plan)
      ? allow<null>("CONFIDENTIAL", null)
      : deny<null>("NOT_AVAILABLE"),
  );

// --- get_brand_kit --------------------------------------------------------

export const GetBrandKitInputSchema = z.object({}).strict();
export const GetBrandKitOutputSchema = z
  .object({
    effective: QBrandKitSchema.nullable(),
    suggestion: QBrandKitSchema.nullable(),
  })
  .strict();

function createGetBrandKitTool(port: DocumentStudioPort): AnyQToolDefinition {
  return defineQTool<
    z.infer<typeof GetBrandKitInputSchema>,
    z.infer<typeof GetBrandKitOutputSchema>,
    null
  >({
    ...OWN,
    id: GET_BRAND_KIT,
    providerName: "get_brand_kit",
    description:
      "Reads the brand their documents are drawn with: the confirmed colours, type pairing and whether a logo is set (effective), and any suggestion waiting for them to confirm on Documents (suggestion). Null means none.",
    classification: "READ_ONLY",
    riskClass: "SAFE_READ",
    input: GetBrandKitInputSchema,
    output: GetBrandKitOutputSchema,
    authorize: authorizeOwn,
    execute: async (_input, context) => {
      const state = await port.brandState(context.actor);
      return {
        effective: state.effective ?? null,
        suggestion: state.suggestion ?? null,
      };
    },
  });
}

// --- suggest_brand_kit ----------------------------------------------------

export const SuggestBrandKitInputSchema = z.object({}).strict();
export const SuggestBrandKitOutputSchema = z.discriminatedUnion("status", [
  z
    .object({ status: z.literal("SUGGESTED"), suggestion: QBrandKitSchema })
    .strict(),
  z
    .object({
      status: z.enum(["NO_WEBSITE", "UNREADABLE", "NO_ORGANISATION"]),
    })
    .strict(),
]);

function createSuggestBrandKitTool(
  port: DocumentStudioPort,
): AnyQToolDefinition {
  return defineQTool<
    z.infer<typeof SuggestBrandKitInputSchema>,
    z.infer<typeof SuggestBrandKitOutputSchema>,
    null
  >({
    ...OWN,
    id: SUGGEST_BRAND_KIT,
    providerName: "suggest_brand_kit",
    description:
      "Reads their company's own website (the one on their record) for its brand colours, fonts and logo, and files them as a suggestion. Nothing applies until they press Use this brand on Documents: tell them what was found and offer to take them there. NO_WEBSITE: no website on record (ask for their colours or a logo instead). UNREADABLE: the site gave nothing usable.",
    classification: "SIDE_EFFECT",
    riskClass: "LOW_RISK_INTERNAL",
    input: SuggestBrandKitInputSchema,
    output: SuggestBrandKitOutputSchema,
    authorize: authorizeOwn,
    execute: async (_input, context) => {
      const outcome = await port.suggestBrand(context.actor);
      return outcome.status === "SUGGESTED"
        ? { status: "SUGGESTED", suggestion: outcome.kit }
        : { status: outcome.status };
    },
  });
}

// --- audit_my_document ----------------------------------------------------

export const AuditMyDocumentInputSchema = z
  .object({
    artifactId: QArtifactIdSchema.describe(
      "The document: its id from this conversation's card or list_my_documents.",
    ),
  })
  .strict();
export const AuditMyDocumentOutputSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("FOUND"),
      title: z.string().max(160),
      version: z.number().int().min(1),
      audit: QDocumentAuditSchema.nullable(),
    })
    .strict(),
  z.object({ status: z.literal("NOT_FOUND") }).strict(),
]);

function createAuditMyDocumentTool(
  port: DocumentStudioPort,
): AnyQToolDefinition {
  return defineQTool<
    z.infer<typeof AuditMyDocumentInputSchema>,
    z.infer<typeof AuditMyDocumentOutputSchema>,
    null
  >({
    ...OWN,
    id: AUDIT_MY_DOCUMENT,
    providerName: "audit_my_document",
    description:
      "Reads the checks Capital Q ran on one of their documents (layout fits, text contrast, every figure traced to their record, charts sourced, photos credited) and up to three things they could add to make it stronger. Use it to be proactive after a deck is made or when they ask how to improve it; never fill a gap in yourself. audit null: this version was made before checks existed.",
    classification: "READ_ONLY",
    riskClass: "SAFE_READ",
    input: AuditMyDocumentInputSchema,
    output: AuditMyDocumentOutputSchema,
    authorize: authorizeOwn,
    execute: async (input, context) => {
      const found = await port.audit(context.actor, input.artifactId);
      return found.status === "FOUND"
        ? {
            status: "FOUND",
            title: found.title.slice(0, 160),
            version: found.version,
            audit: found.audit ?? null,
          }
        : { status: "NOT_FOUND" };
    },
  });
}

// --- apply_my_brand -------------------------------------------------------

export const ApplyMyBrandInputSchema = z
  .object({
    artifactId: QArtifactIdSchema.describe(
      "The document to redraw in their confirmed brand.",
    ),
  })
  .strict();
const BrandedDocumentSchema = z
  .object({
    artifactId: QArtifactIdSchema,
    type: QArtifactTypeSchema,
    status: QArtifactStatusSchema,
    title: z.string().trim().min(1).max(160),
    currentVersion: z.number().int().min(1),
  })
  .strict();
export const ApplyMyBrandOutputSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("DOCUMENT_UPDATED"),
      document: BrandedDocumentSchema,
    })
    .strict(),
  z
    .object({
      status: z.enum(["NOT_FOUND", "NO_BRAND", "NOT_REVISABLE", "FAILED"]),
    })
    .strict(),
]);

function createApplyMyBrandTool(port: DocumentStudioPort): AnyQToolDefinition {
  return defineQTool<
    z.infer<typeof ApplyMyBrandInputSchema>,
    z.infer<typeof ApplyMyBrandOutputSchema>,
    null
  >({
    ...OWN,
    id: APPLY_MY_BRAND,
    providerName: "apply_my_brand",
    description:
      "Redraws one of their documents in their confirmed brand (colours, type pairing, logo on a deck's cover) as a new version; the earlier version is kept and the new card has fresh downloads. NO_BRAND: they have not confirmed a brand yet (offer suggest_brand_kit or Documents).",
    classification: "SIDE_EFFECT",
    riskClass: "LOW_RISK_INTERNAL",
    input: ApplyMyBrandInputSchema,
    output: ApplyMyBrandOutputSchema,
    authorize: authorizeOwn,
    execute: async (input, context) => {
      const outcome = await port.applyBrand({
        actor: context.actor,
        plan: context.plan,
        runId: context.runId,
        artifactId: input.artifactId,
      });
      if (outcome.status !== "APPLIED") return { status: outcome.status };
      const document = BrandedDocumentSchema.safeParse({
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

export function createDocumentStudioTools(ports: {
  readonly documentStudio?: DocumentStudioPort | undefined;
}): readonly AnyQToolDefinition[] {
  const port = ports.documentStudio;
  if (port === undefined) return [];
  return [
    createGetBrandKitTool(port),
    createSuggestBrandKitTool(port),
    createAuditMyDocumentTool(port),
    createApplyMyBrandTool(port),
  ];
}
