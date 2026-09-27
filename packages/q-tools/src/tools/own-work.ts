import { createHash } from "node:crypto";

import { z } from "zod";

import {
  Q_TASK_CLASSES,
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
  DiscoveryDecisionPort,
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
export const SAVE_COMPANY = "discovery.company.save" as const;
export const UNSAVE_COMPANY = "discovery.company.unsave" as const;
export const PASS_COMPANY = "discovery.company.pass" as const;

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

// --- an investor's Save, Unsave and Pass ----------------------------------

export const DiscoveryDecisionInputSchema = z
  .object({
    companyId: z
      .string()
      .uuid()
      .describe(
        "The company's id, exactly as a tool or the screen gave it. Never guessed from a name.",
      ),
  })
  .strict();
export type DiscoveryDecisionInput = z.infer<
  typeof DiscoveryDecisionInputSchema
>;

export const DiscoveryDecisionOutputSchema = z
  .object({
    status: z.enum(["DONE", "NOT_AVAILABLE"]),
    saved: z.boolean().nullable(),
    passed: z.boolean().nullable(),
  })
  .strict();
export type DiscoveryDecisionOutput = z.infer<
  typeof DiscoveryDecisionOutputSchema
>;

/**
 * The idempotency identity of one decision in one run: a retried call
 * records nothing twice, and a new turn is a new decision (the person may
 * save, unsave and save again). Never the model's to choose.
 */
export function decisionEventId(
  runId: string,
  type: "SAVE" | "UNSAVE" | "PASS",
  companyId: string,
): string {
  const digest = createHash("sha256")
    .update(`${runId}\u0000${type}\u0000${companyId.toLowerCase()}`)
    .digest("hex")
    .slice(0, 40);
  return `q-${digest}`;
}

const DECISION_WORDS: Readonly<
  Record<"SAVE" | "UNSAVE" | "PASS", { name: string; description: string }>
> = {
  SAVE: {
    name: "save_company",
    description:
      "Saves a company to the investor's Saved list, exactly as the Save button in Discover does. Reversible (unsave_company). Call it when they ask to save, bookmark or keep a company. NOT_AVAILABLE means it cannot be saved from their feed; say so without guessing why.",
  },
  UNSAVE: {
    name: "unsave_company",
    description:
      "Removes a company from the investor's Saved list, exactly as un-saving it in Discover does. Call it when they ask to unsave or remove a saved company.",
  },
  PASS: {
    name: "pass_company",
    description:
      "Passes on a company in the investor's Discover feed, exactly as the Pass button does: it leaves their feed. A neutral decision, not a judgment of the company. Call it only when they clearly ask to pass on or skip that company.",
  },
};

export function createDiscoveryDecisionTool(
  type: "SAVE" | "UNSAVE" | "PASS",
  port: DiscoveryDecisionPort,
): AnyQToolDefinition {
  const words = DECISION_WORDS[type];
  return defineQTool<DiscoveryDecisionInput, DiscoveryDecisionOutput, null>({
    ...OWN,
    id:
      type === "SAVE"
        ? SAVE_COMPANY
        : type === "UNSAVE"
          ? UNSAVE_COMPANY
          : PASS_COMPANY,
    providerName: words.name,
    description: words.description,
    // Their own feed decision, reversible from the page; the interaction
    // service re-runs the feed's eligibility for this company.
    classification: "SIDE_EFFECT",
    riskClass: "LOW_RISK_INTERNAL",
    input: DiscoveryDecisionInputSchema,
    output: DiscoveryDecisionOutputSchema,
    authorize: (_input, { actor, plan }) =>
      Promise.resolve(
        ownConversation(actor, plan)
          ? allow<null>("INTERNAL", null)
          : deny<null>("NOT_AVAILABLE"),
      ),
    execute: async (input, context) => {
      const outcome = await port.decide(context.actor, {
        type,
        companyId: input.companyId,
        clientEventId: decisionEventId(context.runId, type, input.companyId),
      });
      return outcome.status === "RECORDED"
        ? { status: "DONE", saved: outcome.saved, passed: outcome.passed }
        : { status: "NOT_AVAILABLE", saved: null, passed: null };
    },
  });
}

export function createOwnWorkTools(ports: {
  readonly approvalInbox?: ApprovalInboxPort | undefined;
  readonly documents?: OwnDocumentsPort | undefined;
  readonly discoveryDecisions?: DiscoveryDecisionPort | undefined;
}): readonly AnyQToolDefinition[] {
  const decisions = ports.discoveryDecisions;
  return [
    ...(ports.approvalInbox === undefined
      ? []
      : [createListPendingApprovalsTool(ports.approvalInbox)]),
    ...(ports.documents === undefined
      ? []
      : [createListMyDocumentsTool(ports.documents)]),
    ...(decisions === undefined
      ? []
      : (["SAVE", "UNSAVE", "PASS"] as const).map((type) =>
          createDiscoveryDecisionTool(type, decisions),
        )),
  ];
}
