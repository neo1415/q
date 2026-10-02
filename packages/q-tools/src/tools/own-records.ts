import { z } from "zod";

import {
  Q_TASK_CLASSES,
  VISIBILITY_AUDIENCES,
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
import {
  OWN_RECORD_KINDS,
  type EvidenceDocumentsPort,
  type OwnRecordKind,
  type OwnRecordsPort,
  type QToolPorts,
  type RelationshipIntelligencePort,
  type RelationshipMailPort,
} from "../ports.js";
import { ownSubject } from "./q-card.js";

/**
 * R33: what the app's screens show the person about their own records,
 * read by Q through the same services as the actor. Whose record is code's
 * to resolve (their own company or investor organisation, bound in this
 * run's plan); the owning service authorises the read again. A record
 * that is not theirs, or not there, is one answer: NONE.
 */

export const READ_MY_RECORD = "records.own.read" as const;
export const REASSESS_READINESS = "company.readiness.reassess" as const;
export const LIST_UPLOADED_DOCUMENTS = "documents.uploaded.list" as const;
export const READ_RELATIONSHIP_EMAIL = "relationship.email.read" as const;

/** How much of one record a model is handed; the screen has the rest. */
const DATA_MAX_CHARS = 12_000;

function ownConversation(
  actor: ActorContext,
  plan: PermittedContextPlan,
): boolean {
  if (actor.actorType !== "HUMAN") return false;
  const scope = actorWideScope(plan, "OWN_Q_CONVERSATION");
  return scope !== undefined && scope.filter.userId === actor.userId;
}

const INVESTOR_RECORDS: ReadonlySet<OwnRecordKind> = new Set([
  "INVESTOR_ORGANISATION",
  "INVESTOR_NETWORK_PREVIEW",
  "INVESTOR_REPRESENTATIVE",
  "INVESTOR_MANDATES",
]);

const READ = {
  version: 1,
  status: "ACTIVE",
  classification: "READ_ONLY",
  riskClass: "SAFE_READ",
  requiredCapabilities: [],
  supportedPurposes: [...Q_TASK_CLASSES],
  approval: "NONE",
  idempotency: "SAFE_TO_REPEAT",
  owner: "q-tools",
  visibleStage: null,
} as const;

type Subject = {
  readonly subjectType: "COMPANY" | "INVESTOR_ORGANISATION";
  readonly subjectId: string;
};

// --- read_my_record -------------------------------------------------------

export const ReadMyRecordInputSchema = z
  .object({
    record: z
      .enum(OWN_RECORD_KINDS)
      .describe(
        "VERIFICATION_STATUS (what is verified), MARKETPLACE_READINESS (the requirements to appear in investor recommendations and feeds: the answer to why investors do not see their company or pitch in Discover; a visible pitch alone is not enough), COMPANY_NETWORK_PREVIEW (how investors on the network see their company), COMPANY_AUDIENCE_PREVIEW (what one audience sees: give audience), COMPANY_TEAM (their role, founder profile, team facts), RAISE_HISTORY (their raises, past and current), PROFILE_FINDINGS (what Q found about them in public), INVESTOR_ORGANISATION (their organisation's profile), INVESTOR_NETWORK_PREVIEW (how founders see it), INVESTOR_REPRESENTATIVE (their own role there), INVESTOR_MANDATES (their mandates).",
      ),
    subject: z
      .enum(["COMPANY", "INVESTOR_ORGANISATION"])
      .optional()
      .describe(
        "PROFILE_FINDINGS only: whose findings. Default: their company.",
      ),
    audience: z.enum(VISIBILITY_AUDIENCES).optional(),
    relationshipId: z
      .string()
      .uuid()
      .optional()
      .describe("COMPANY_AUDIENCE_PREVIEW with audience INVESTOR only."),
  })
  .strict();
export type ReadMyRecordInput = z.infer<typeof ReadMyRecordInputSchema>;

export const OwnRecordOutputSchema = z
  .object({
    status: z.enum(["FOUND", "NONE", "TOO_LARGE"]),
    data: z.unknown(),
  })
  .strict();
export type OwnRecordOutput = z.infer<typeof OwnRecordOutputSchema>;

function bounded(data: unknown): OwnRecordOutput {
  if (data === null || data === undefined)
    return { status: "NONE", data: null };
  const text = JSON.stringify(data);
  return text.length > DATA_MAX_CHARS
    ? { status: "TOO_LARGE", data: null }
    : { status: "FOUND", data: JSON.parse(text) as unknown };
}

function subjectKind(input: ReadMyRecordInput): Subject["subjectType"] {
  if (input.record === "PROFILE_FINDINGS") return input.subject ?? "COMPANY";
  return INVESTOR_RECORDS.has(input.record)
    ? "INVESTOR_ORGANISATION"
    : "COMPANY";
}

export function createReadMyRecordTool(
  ports: Pick<QToolPorts, "companies" | "investors">,
  records: OwnRecordsPort,
): AnyQToolDefinition {
  return defineQTool<ReadMyRecordInput, OwnRecordOutput, Subject>({
    ...READ,
    id: READ_MY_RECORD,
    supportedPurposes: [
      "OWN_COMPANY_QUESTION",
      "INVESTOR_QUESTION",
      "ACTION_PREPARATION",
      "GENERAL_QUESTION",
    ],
    providerName: "read_my_record",
    description:
      "Reads one of their own records exactly as its screen shows it: verification status, marketplace readiness, how the network or one audience sees their company, their team and role, their raise history, what Q found about them publicly, their investor organisation, how founders see it, their role there, or their mandates. NONE means there is nothing to show; never guess it.",
    requiredScopeKinds: ["COMPANY_PROFILE", "INVESTOR_PROFILE"],
    input: ReadMyRecordInputSchema,
    output: OwnRecordOutputSchema,
    authorize: async (input, { actor, plan }) => {
      if (!ownConversation(actor, plan)) return deny<Subject>("NOT_AVAILABLE");
      const subjectType = subjectKind(input);
      const subjectId = await ownSubject(ports, actor, plan, subjectType);
      return subjectId === null
        ? deny<Subject>("NOT_AVAILABLE")
        : allow<Subject>("CONFIDENTIAL", { subjectType, subjectId });
    },
    execute: async (input, context, grant) =>
      bounded(
        await records
          .read(context.actor, {
            record: input.record,
            subjectType: grant.subjectType,
            subjectId: grant.subjectId,
            audience: input.audience,
            relationshipId: input.relationshipId,
          })
          .catch(() => null),
      ),
  });
}

// --- reassess readiness ----------------------------------------------------

export const ReassessReadinessInputSchema = z.object({}).strict();
export type ReassessReadinessInput = z.infer<
  typeof ReassessReadinessInputSchema
>;

export function createReassessReadinessTool(
  ports: Pick<QToolPorts, "companies" | "investors">,
  records: OwnRecordsPort,
): AnyQToolDefinition {
  return defineQTool<ReassessReadinessInput, OwnRecordOutput, Subject>({
    ...READ,
    // Recomputes a derived assessment from their own record, as the
    // page's "check again" does: nothing they declared changes.
    classification: "SIDE_EFFECT",
    riskClass: "LOW_RISK_INTERNAL",
    id: REASSESS_READINESS,
    supportedPurposes: ["OWN_COMPANY_QUESTION", "ACTION_PREPARATION"],
    providerName: "reassess_marketplace_readiness",
    description:
      "Checks their company's marketplace readiness again, as the visibility page's check does, and returns the fresh assessment. Nothing they declared changes. Use it to answer why investors don't see their company or pitch in Discover: investor feeds and recommendations show only marketplace-ready companies, and being visible or having a ready pitch is not enough on its own (a visible company's pitch still shows on its profile to investors who look it up). Answer from the requirements it returns, naming each one still outstanding and where to meet it (profile, visibility, verification).",
    requiredScopeKinds: ["COMPANY_PROFILE"],
    input: ReassessReadinessInputSchema,
    output: OwnRecordOutputSchema,
    authorize: async (_input, { actor, plan }) => {
      if (!ownConversation(actor, plan)) return deny<Subject>("NOT_AVAILABLE");
      const subjectId = await ownSubject(ports, actor, plan, "COMPANY");
      return subjectId === null
        ? deny<Subject>("NOT_AVAILABLE")
        : allow<Subject>("CONFIDENTIAL", { subjectType: "COMPANY", subjectId });
    },
    execute: async (_input, context, grant) =>
      bounded(
        await records
          .reassessReadiness(
            context.actor,
            grant.subjectId,
            context.correlationId,
          )
          .catch(() => null),
      ),
  });
}

// --- their uploaded documents ---------------------------------------------

export const ListUploadedDocumentsInputSchema = z.object({}).strict();
export type ListUploadedDocumentsInput = z.infer<
  typeof ListUploadedDocumentsInputSchema
>;

export const ListUploadedDocumentsOutputSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            documentId: z.string().max(64),
            title: z.string().max(300),
            documentType: z.string().max(64),
            status: z.string().max(64),
            processing: z.string().max(64).nullable(),
            updatedAt: z.string().max(40),
          })
          .strict(),
      )
      .max(50),
  })
  .strict();
export type ListUploadedDocumentsOutput = z.infer<
  typeof ListUploadedDocumentsOutputSchema
>;

export function createListUploadedDocumentsTool(
  ports: Pick<QToolPorts, "companies" | "investors">,
  documents: EvidenceDocumentsPort,
): AnyQToolDefinition {
  return defineQTool<
    ListUploadedDocumentsInput,
    ListUploadedDocumentsOutput,
    Subject
  >({
    ...READ,
    id: LIST_UPLOADED_DOCUMENTS,
    supportedPurposes: [
      "OWN_COMPANY_QUESTION",
      "ACTION_PREPARATION",
      "GENERAL_QUESTION",
    ],
    providerName: "list_uploaded_documents",
    description:
      "Lists the documents their company uploaded (decks, financials and the like): title, type, status and whether Q has finished reading each. Not their contents.",
    // Firewall: only where the plan admits their organisation's evidence.
    requiredScopeKinds: ["EVIDENCE_DOCUMENTS"],
    input: ListUploadedDocumentsInputSchema,
    output: ListUploadedDocumentsOutputSchema,
    authorize: async (_input, { actor, plan }) => {
      if (!ownConversation(actor, plan)) return deny<Subject>("NOT_AVAILABLE");
      if (!plan.scopes.some((scope) => scope.kind === "EVIDENCE_DOCUMENTS")) {
        return deny<Subject>("NOT_AVAILABLE");
      }
      const subjectId = await ownSubject(ports, actor, plan, "COMPANY");
      return subjectId === null
        ? deny<Subject>("NOT_AVAILABLE")
        : allow<Subject>("CONFIDENTIAL", { subjectType: "COMPANY", subjectId });
    },
    execute: async (_input, context, grant) => ({
      items: (await documents.list(context.actor, grant.subjectId))
        .slice(0, 50)
        .map((item) => ({ ...item, title: item.title.slice(0, 300) })),
    }),
  });
}

// --- a relationship's email -----------------------------------------------

export const ReadRelationshipEmailInputSchema = z
  .object({
    relationshipId: z
      .string()
      .uuid()
      .describe("The relationship's id, exactly as get_relationship gave it."),
  })
  .strict();
export type ReadRelationshipEmailInput = z.infer<
  typeof ReadRelationshipEmailInputSchema
>;

export const ReadRelationshipEmailOutputSchema = z
  .object({
    status: z.enum(["FOUND", "NOT_CONNECTED_OR_NONE"]),
    items: z
      .array(
        z
          .object({
            direction: z.string().max(16),
            status: z.string().max(16),
            from: z.string().max(320),
            to: z.string().max(320),
            subject: z.string().max(300),
            at: z.string().max(40),
          })
          .strict(),
      )
      .max(30),
  })
  .strict();
export type ReadRelationshipEmailOutput = z.infer<
  typeof ReadRelationshipEmailOutputSchema
>;

export function createReadRelationshipEmailTool(
  relationships: RelationshipIntelligencePort,
  mail: RelationshipMailPort,
): AnyQToolDefinition {
  return defineQTool<
    ReadRelationshipEmailInput,
    ReadRelationshipEmailOutput,
    null
  >({
    ...READ,
    id: READ_RELATIONSHIP_EMAIL,
    supportedPurposes: [
      "RELATIONSHIP_QUESTION",
      "COUNTERPARTY_COMPANY_QUESTION",
      "INVESTOR_QUESTION",
      "ACTION_PREPARATION",
      "GENERAL_QUESTION",
    ],
    providerName: "read_relationship_email",
    description:
      "Reads the email exchanged on one of their relationships from their own connected Gmail, newest first: direction, status, from, to, subject and when (not the bodies). NOT_CONNECTED_OR_NONE: Gmail is not connected or there is no email; offer Settings to connect it.",
    requiredScopeKinds: ["OWN_Q_CONVERSATION"],
    input: ReadRelationshipEmailInputSchema,
    output: ReadRelationshipEmailOutputSchema,
    /**
     * Their own party to the relationship, read as them (the Network
     * context's own check), and their own mailbox: never another person's.
     */
    authorize: async (input, { actor, plan }) => {
      if (!ownConversation(actor, plan)) return deny<null>("NOT_AVAILABLE");
      const standing = await relationships
        .byRelationship(actor, input.relationshipId)
        .catch(() => null);
      return standing === null
        ? deny<null>("NOT_AVAILABLE")
        : allow<null>("CONFIDENTIAL", null);
    },
    execute: async (input, context) => {
      const items = await mail
        .list(context.actor, input.relationshipId)
        .catch(() => null);
      if (items === null || items.length === 0) {
        return { status: "NOT_CONNECTED_OR_NONE", items: [] };
      }
      return {
        status: "FOUND",
        items: items.slice(0, 30).map((item) => ({
          direction: item.direction.slice(0, 16),
          status: item.status.slice(0, 16),
          from: item.from.slice(0, 320),
          to: item.to.slice(0, 320),
          subject: item.subject.slice(0, 300),
          at: item.at,
        })),
      };
    },
  });
}

export function createOwnRecordTools(
  ports: QToolPorts,
): readonly AnyQToolDefinition[] {
  const records = ports.ownRecords;
  const evidence = ports.evidenceDocuments;
  const mail = ports.relationshipMail;
  const relationships = ports.relationships;
  return [
    ...(records === undefined
      ? []
      : [
          createReadMyRecordTool(ports, records),
          createReassessReadinessTool(ports, records),
        ]),
    ...(evidence === undefined
      ? []
      : [createListUploadedDocumentsTool(ports, evidence)]),
    ...(mail === undefined || relationships === undefined
      ? []
      : [createReadRelationshipEmailTool(relationships, mail)]),
  ];
}
