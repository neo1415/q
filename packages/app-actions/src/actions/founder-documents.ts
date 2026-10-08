import { z } from "zod";

import {
  AccessChangeResultSchema,
  AnswerQuestionResultSchema,
  AnswerQuestionSchema,
  DATA_ROOM_GRANT_DAYS,
  DATA_ROOM_GRANT_DEFAULT_DAYS,
  DataRoomCodeSchema,
  DataRoomLevelSchema,
  DeclineDocumentRequestSchema,
  DOCUMENT_ACCESS_LEVEL_WORDS,
  DOCUMENT_GRANT_REVOKE_PATH,
  DOCUMENT_GRANTS_PATH,
  DOCUMENT_REQUEST_DECLINE_PATH,
  DOCUMENT_REQUEST_FULFIL_PATH,
  DOCUMENT_SCOPE_CHOICES,
  DocumentAccessLevelSchema,
  DocumentRequestResultSchema,
  FOLDER_GRANTS_PATH,
  FOLDER_LEVEL_PATH,
  FulfilDocumentRequestSchema,
  GrantDaysSchema,
  IDEMPOTENCY_KEY_HEADER,
  IdempotencyKeyHeaderSchema,
  QUESTION_ANSWER_MAX_LENGTH,
  QUESTION_ANSWER_PATH,
  UuidSchema,
  inboxItemOpen,
  type DocumentAccessLevel,
  type KnownErrorCode,
  type RequestInboxItem,
} from "@capital-q/contracts";
import type {
  FounderRequestsOutcome,
  FounderRequestsRefusal,
} from "@capital-q/permissions";

import {
  defineAppAction,
  portMissing,
  refusal,
  relationshipTarget,
  type AnyAppAction,
  type AppActionContext,
} from "../define.js";
import type { AppActionPorts } from "../ports.js";
import type { OwnReadItem } from "../reads.js";

/**
 * Founder documents (2026-10-08): the founder answers what investors ask
 * for, and decides who can see each document. Every action is declared
 * once, with its own route and its Q tool; each widens or answers a
 * disclosure, so Q prepares it and the founder approves exactly it.
 */

const service = (ports: AppActionPorts) =>
  ports.founderRequests ?? portMissing("founderRequests");
const servicesDecide = () => Promise.resolve({ ok: true as const });
const keyOf = (headers: Readonly<Record<string, unknown>>) =>
  headers[IDEMPOTENCY_KEY_HEADER];

const REFUSALS: Readonly<
  Record<
    FounderRequestsRefusal,
    { readonly code: KnownErrorCode; readonly detail: string }
  >
> = {
  NOT_FOUND: { code: "RESOURCE_NOT_FOUND", detail: "Not found." },
  ALREADY_ANSWERED: {
    code: "RESOURCE_CONFLICT",
    detail: "That was already answered.",
  },
  NOT_SHAREABLE: {
    code: "RESOURCE_CONFLICT",
    detail: "That document can't be shared this way.",
  },
  VERSION_CONFLICT: {
    code: "RESOURCE_CONFLICT",
    detail: "Someone changed this meanwhile. Refresh and try again.",
  },
};
type Out<T> = FounderRequestsOutcome<T>;
const problem = (out: Out<unknown>) =>
  out.outcome === "OK" ? null : REFUSALS[out.code];
const notFound = (out: Out<unknown>) =>
  out.outcome === "REFUSED" && out.code === "NOT_FOUND";
const succeeded = (out: Out<unknown>) => out.outcome === "OK";
const failedWords = (out: Out<unknown>) =>
  problem(out)?.detail ?? "That couldn't be done.";

const days = (value: number | undefined) =>
  (DATA_ROOM_GRANT_DAYS as readonly number[]).includes(value ?? -1)
    ? (value ?? DATA_ROOM_GRANT_DEFAULT_DAYS)
    : DATA_ROOM_GRANT_DEFAULT_DAYS;

const AccessTool = DocumentAccessLevelSchema.optional().describe(
  "view (view only, watermarked; the default) or view_download.",
);
const DaysTool = z
  .number()
  .int()
  .optional()
  .describe("How long they keep it: 7, 14, 30 (default) or 90 days.");
const FolderTool = DataRoomCodeSchema.optional().describe(
  "The data-room folder code to file it in (fundraising, corporate, kyc_kyb, cap_table, financials, tax, legal_ip, commercial, team, licences, other).",
);

/** The founder's open inbox items, matched by who asked or what for. */
async function openItems(
  ports: AppActionPorts,
  context: AppActionContext,
): Promise<readonly RequestInboxItem[] | null> {
  const companyId = await ports.ownCompanyId?.(context.actor).catch(() => null);
  if (companyId === null || companyId === undefined) return null;
  const inbox = await ports.founderRequests
    ?.inbox(context.actor, companyId)
    .catch(() => null);
  return inbox === null || inbox === undefined
    ? null
    : inbox.items.filter(inboxItemOpen);
}

const said = (words: string) => {
  const lower = words.toLowerCase();
  return (text: string | null) =>
    text !== null &&
    text.length > 0 &&
    (lower.includes(text.toLowerCase()) || text.toLowerCase().includes(lower));
};

// --- share a document for a request -------------------------------------------

const Fulfil = z
  .object({ requestId: UuidSchema, input: FulfilDocumentRequestSchema })
  .strict();
type FulfilIn = z.infer<typeof Fulfil>;
type FulfilOut = Out<{ readonly requestId: string; readonly status: "SHARED" }>;

const FulfilTool = z
  .object({
    request: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .describe("The open request, as they named it: who asked or what for."),
    document: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .describe("The document that answers it, as they named it."),
    access: AccessTool,
    days: DaysTool,
    folder: FolderTool,
  })
  .strict();

const FULFIL_DOCUMENT_REQUEST = defineAppAction<
  FulfilIn,
  FulfilOut,
  z.infer<typeof FulfilTool>
>({
  name: "document_request.fulfil",
  short: "answer a document request",
  area: "documents",
  classification: "CONSEQUENTIAL",
  does: "Shares one of the company's documents for an investor's request, at the level and for the time the founder chose, and files it in the data room.",
  input: Fulfil,
  output: z.custom<FulfilOut>(),
  authorize: servicesDecide,
  run: (ports, context, input) =>
    service(ports).fulfil({
      actor: context.actor,
      source: input.input.source,
      requestId: input.requestId,
      documentId: input.input.documentId,
      folderCode: input.input.folderCode,
      accessLevel: input.input.accessLevel,
      days: input.input.days,
      correlationId: context.correlationId,
    }),
  targets: (input) => [
    { kind: "DOCUMENT", documentId: input.input.documentId },
  ],
  card: (input) => ({
    summary: "Share this document for their request",
    preview: `${DOCUMENT_ACCESS_LEVEL_WORDS[input.input.accessLevel]}, for ${String(input.input.days)} days. Only they see it. You can take it back at any time.`,
  }),
  done: (out) =>
    out.outcome === "OK"
      ? "Shared. They've been told, and it's in your data room."
      : failedWords(out),
  succeeded,
  http: {
    method: "POST",
    path: DOCUMENT_REQUEST_FULFIL_PATH,
    fromRequest: (params, body) => ({
      requestId: params["requestId"],
      input: body,
    }),
    problem,
    notFound,
    respond: (out) =>
      out.outcome === "OK"
        ? DocumentRequestResultSchema.parse(out.value)
        : undefined,
  },
  tool: {
    name: "fulfil_document_request",
    description:
      "For a founder: prepares, for their approval, sharing one of their uploaded documents to answer an investor's open request (by who asked or what for), view only or with download, for 7, 14, 30 or 90 days, filed in their data room. Nothing is shared until they approve exactly it.",
    input: FulfilTool,
    references: { document: "UPLOAD" },
    scopes: ["COMPANY_PROFILE"],
    purposes: ["OWN_COMPANY_QUESTION", "ACTION_PREPARATION"],
    eval: {
      say: [
        "Send {name} for Zino's request.",
        "Answer the management accounts request with {name}.",
      ],
      names: "UPLOAD",
      orSays: "no open request|isn't",
    },
    toCanonical: async (tool, context, ports) => {
      const open = await openItems(ports, context);
      if (open === null) return null;
      const requests = open.filter((item) => item.kind === "DOCUMENT_REQUEST");
      const hit = said(tool.request);
      const matches = requests.filter(
        (item) =>
          hit(item.investorOrganisationName) ||
          hit(item.requesterName) ||
          hit(item.title),
      );
      const request =
        matches.length === 1
          ? matches[0]
          : requests.length === 1
            ? requests[0]
            : undefined;
      if (request === undefined)
        return refusal("There's no single open request matching that.");
      return {
        requestId: request.requestId,
        input: {
          source: request.source,
          documentId: tool.document,
          ...(tool.folder === undefined ? {} : { folderCode: tool.folder }),
          accessLevel: tool.access ?? "view",
          days: days(tool.days),
        },
      };
    },
  },
});

// --- decline a request ---------------------------------------------------------

const Decline = z
  .object({
    requestId: UuidSchema,
    /** Q's path names the relationship, so the card binds to it. */
    relationshipId: UuidSchema.optional(),
    input: DeclineDocumentRequestSchema,
  })
  .strict();
type DeclineIn = z.infer<typeof Decline>;
type DeclineOut = Out<{
  readonly requestId: string;
  readonly status: "DECLINED";
}>;

const DeclineTool = z
  .object({
    request: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .describe("The open request, as they named it: who asked or what for."),
    note: z
      .string()
      .trim()
      .min(1)
      .max(1000)
      .optional()
      .describe("Optional words to the investor, as the founder said them."),
  })
  .strict();

const DECLINE_DOCUMENT_REQUEST = defineAppAction<
  DeclineIn,
  DeclineOut,
  z.infer<typeof DeclineTool>
>({
  name: "document_request.decline",
  short: "decline a document request",
  area: "documents",
  classification: "CONSEQUENTIAL",
  does: "Declines an investor's document request, with an optional note they see.",
  input: Decline,
  output: z.custom<DeclineOut>(),
  authorize: servicesDecide,
  run: (ports, context, input) =>
    service(ports).decline({
      actor: context.actor,
      source: input.input.source,
      requestId: input.requestId,
      note: input.input.note ?? null,
      correlationId: context.correlationId,
    }),
  targets: (input) => relationshipTarget(input.relationshipId ?? ""),
  card: (input) => ({
    summary: "Decline this request",
    preview:
      input.input.note === undefined || input.input.note === null
        ? "They see that it wasn't shared. Nothing else changes."
        : `They see your note: "${input.input.note}"`,
  }),
  done: (out) =>
    out.outcome === "OK" ? "Declined. They've been told." : failedWords(out),
  succeeded,
  http: {
    method: "POST",
    path: DOCUMENT_REQUEST_DECLINE_PATH,
    fromRequest: (params, body) => ({
      requestId: params["requestId"],
      input: body,
    }),
    problem,
    notFound,
    respond: (out) =>
      out.outcome === "OK"
        ? DocumentRequestResultSchema.parse(out.value)
        : undefined,
  },
  tool: {
    name: "decline_document_request",
    description:
      "For a founder: prepares, for their approval, declining an investor's open document request (by who asked or what for), with an optional note they see. Nothing changes until they approve exactly it.",
    input: DeclineTool,
    references: {},
    scopes: ["COMPANY_PROFILE"],
    purposes: ["OWN_COMPANY_QUESTION", "ACTION_PREPARATION"],
    eval: {
      say: [
        "Decline the customer contracts request.",
        "Say no to Zino's request for now.",
      ],
      orSays: "no open request|isn't",
    },
    toCanonical: async (tool, context, ports) => {
      const open = await openItems(ports, context);
      if (open === null) return null;
      const requests = open.filter((item) => item.kind === "DOCUMENT_REQUEST");
      const hit = said(tool.request);
      const matches = requests.filter(
        (item) =>
          hit(item.investorOrganisationName) ||
          hit(item.requesterName) ||
          hit(item.title),
      );
      const request =
        matches.length === 1
          ? matches[0]
          : requests.length === 1
            ? requests[0]
            : undefined;
      if (request === undefined)
        return refusal("There's no single open request matching that.");
      return {
        requestId: request.requestId,
        relationshipId: request.relationshipId,
        input: {
          source: request.source,
          ...(tool.note === undefined ? {} : { note: tool.note }),
        },
      };
    },
  },
});

// --- share a document with an investor -----------------------------------------

const Share = z
  .object({
    documentId: UuidSchema,
    relationshipId: UuidSchema,
    accessLevel: DocumentAccessLevelSchema,
    days: GrantDaysSchema,
    /** File it in this data-room folder first. */
    fileIn: DataRoomCodeSchema.optional(),
  })
  .strict();
type ShareIn = z.infer<typeof Share>;
type ChangeOut = Out<{ readonly changed: number }>;

const ShareTool = z
  .object({
    document: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .describe("The document, as they named it (or the one just uploaded)."),
    investor: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .describe("The investor they have a relationship with, as named."),
    access: AccessTool,
    days: DaysTool,
    folder: FolderTool,
  })
  .strict();

const SHARE_DOCUMENT = defineAppAction<
  ShareIn,
  ChangeOut,
  z.infer<typeof ShareTool>
>({
  name: "document.access.share",
  short: "share document with investor",
  area: "documents",
  classification: "CONSEQUENTIAL",
  does: "Shares one of the company's documents with one investor it has a relationship with, view only or with download, until a date, filed in the data room when asked.",
  input: Share,
  output: z.custom<ChangeOut>(),
  authorize: servicesDecide,
  run: (ports, context, input) =>
    service(ports).share({
      actor: context.actor,
      documentId: input.documentId,
      relationshipId: input.relationshipId,
      accessLevel: input.accessLevel,
      days: input.days,
      fileIn: input.fileIn,
      correlationId: context.correlationId,
    }),
  targets: (input) => relationshipTarget(input.relationshipId),
  card: (input, names) => ({
    summary:
      names?.counterpart == null
        ? "Share this document"
        : `Share this document with ${names.counterpart}`,
    preview: `${DOCUMENT_ACCESS_LEVEL_WORDS[input.accessLevel]}, for ${String(input.days)} days${input.fileIn === undefined ? "" : ", filed in your data room"}. You can take it back at any time.`,
  }),
  done: (out) =>
    out.outcome === "OK"
      ? out.value.changed > 0
        ? "Shared. They've been told."
        : "They could already open it."
      : failedWords(out),
  succeeded,
  http: {
    method: "POST",
    path: DOCUMENT_GRANTS_PATH,
    fromRequest: (params, body) => ({
      ...(typeof body === "object" && body !== null ? body : {}),
      documentId: params["documentId"],
    }),
    problem,
    notFound,
    respond: (out) =>
      out.outcome === "OK"
        ? AccessChangeResultSchema.parse(out.value)
        : undefined,
  },
  tool: {
    name: "share_document_with_investor",
    description:
      "For a founder: prepares, for their approval, sharing one of their uploaded documents with one investor they have a relationship with ('put this in the data room for Zino'), view only (watermarked) or with download, for 7, 14, 30 or 90 days, optionally filed in a data-room folder. Nothing is shared until they approve exactly it.",
    input: ShareTool,
    references: { document: "UPLOAD", investor: "RELATIONSHIP" },
    scopes: ["COMPANY_PROFILE"],
    purposes: ["OWN_COMPANY_QUESTION", "ACTION_PREPARATION"],
    eval: {
      say: [
        "Upload {name} to the data room for Zino.",
        "Share {name} with Zino Capital for 14 days.",
      ],
      names: "UPLOAD",
    },
    toCanonical: (tool) =>
      Promise.resolve({
        documentId: tool.document,
        relationshipId: tool.investor,
        accessLevel: tool.access ?? "view",
        days: days(tool.days),
        ...(tool.folder === undefined ? {} : { fileIn: tool.folder }),
      }),
  },
});

// --- a folder: share it, set its level (screen only) -----------------------------

const FolderShare = z
  .object({
    companyId: UuidSchema,
    folderCode: DataRoomCodeSchema,
    relationshipId: UuidSchema,
    accessLevel: DocumentAccessLevelSchema,
    days: GrantDaysSchema,
  })
  .strict();
type FolderShareIn = z.infer<typeof FolderShare>;

const SHARE_FOLDER = defineAppAction<FolderShareIn, ChangeOut>({
  name: "document.access.share_folder",
  short: "share a data-room folder",
  area: "documents",
  classification: "CONSEQUENTIAL",
  does: "Shares every document in one data-room folder with one investor the company has a relationship with, until a date.",
  input: FolderShare,
  output: z.custom<ChangeOut>(),
  authorize: servicesDecide,
  run: (ports, context, input) =>
    service(ports).share({
      actor: context.actor,
      companyId: input.companyId,
      folderCode: input.folderCode,
      relationshipId: input.relationshipId,
      accessLevel: input.accessLevel,
      days: input.days,
      correlationId: context.correlationId,
    }),
  targets: (input) => relationshipTarget(input.relationshipId),
  card: (input) => ({
    summary: "Share this folder",
    preview: `${DOCUMENT_ACCESS_LEVEL_WORDS[input.accessLevel]}, for ${String(input.days)} days.`,
  }),
  done: (out) =>
    out.outcome === "OK"
      ? `Shared ${String(out.value.changed)} documents.`
      : failedWords(out),
  succeeded,
  qCapability: "offer.documents_folder_access",
  http: {
    method: "POST",
    path: FOLDER_GRANTS_PATH,
    fromRequest: (params, body) => ({
      ...(typeof body === "object" && body !== null ? body : {}),
      companyId: params["companyId"],
      folderCode: params["folderCode"],
    }),
    problem,
    notFound,
    respond: (out) =>
      out.outcome === "OK"
        ? AccessChangeResultSchema.parse(out.value)
        : undefined,
  },
});

const FolderLevel = z
  .object({
    companyId: UuidSchema,
    folderCode: DataRoomCodeSchema,
    level: DataRoomLevelSchema,
  })
  .strict();
type FolderLevelIn = z.infer<typeof FolderLevel>;

const SET_FOLDER_LEVEL = defineAppAction<FolderLevelIn, ChangeOut>({
  name: "document.access.folder_level",
  short: "set who sees a folder",
  area: "documents",
  classification: "CONSEQUENTIAL",
  does: "Sets every document in one data-room folder to one level: public, on request, shared only or private.",
  input: FolderLevel,
  output: z.custom<ChangeOut>(),
  authorize: servicesDecide,
  run: (ports, context, input) =>
    service(ports).setFolderLevel({
      actor: context.actor,
      companyId: input.companyId,
      folderCode: input.folderCode,
      level: input.level,
      correlationId: context.correlationId,
    }),
  targets: () => [],
  supersedes: true,
  card: (input) => ({
    summary: "Change who can see this folder",
    preview:
      DOCUMENT_SCOPE_CHOICES.find((choice) => choice.level === input.level)
        ?.words ?? input.level,
  }),
  done: (out) =>
    out.outcome === "OK"
      ? `Done: ${String(out.value.changed)} documents changed.`
      : failedWords(out),
  succeeded,
  qCapability: "offer.documents_folder_access",
  http: {
    method: "POST",
    path: FOLDER_LEVEL_PATH,
    fromRequest: (params, body) => ({
      ...(typeof body === "object" && body !== null ? body : {}),
      companyId: params["companyId"],
      folderCode: params["folderCode"],
    }),
    problem,
    notFound,
    respond: (out) =>
      out.outcome === "OK"
        ? AccessChangeResultSchema.parse(out.value)
        : undefined,
  },
});

// --- revoke a share ---------------------------------------------------------------

const Revoke = z
  .object({
    policyId: UuidSchema,
    /** Q's path names the document, so the card binds to it. */
    documentId: UuidSchema.optional(),
  })
  .strict();
type RevokeIn = z.infer<typeof Revoke>;

const RevokeTool = z
  .object({
    document: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .describe("The document, as they named it."),
    investor: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .describe("The investor who should lose access, as named."),
  })
  .strict();

const REVOKE_DOCUMENT_ACCESS = defineAppAction<
  RevokeIn,
  ChangeOut,
  z.infer<typeof RevokeTool>
>({
  name: "document.access.revoke",
  short: "take back a document share",
  area: "documents",
  classification: "CONSEQUENTIAL",
  does: "Takes back one investor's access to one of the company's documents; they lose it at once.",
  input: Revoke,
  output: z.custom<ChangeOut>(),
  authorize: servicesDecide,
  run: (ports, context, input) =>
    service(ports).revoke({
      actor: context.actor,
      policyId: input.policyId,
      correlationId: context.correlationId,
    }),
  targets: (input) =>
    input.documentId === undefined
      ? []
      : [{ kind: "DOCUMENT", documentId: input.documentId }],
  card: () => ({
    summary: "Take back their access",
    preview:
      "They can't open it from now on. What they already read stays read.",
  }),
  done: (out) =>
    out.outcome === "OK"
      ? out.value.changed > 0
        ? "Done. They can't open it any more."
        : "They didn't have access any more."
      : failedWords(out),
  succeeded,
  http: {
    method: "POST",
    path: DOCUMENT_GRANT_REVOKE_PATH,
    fromRequest: (params) => ({ policyId: params["policyId"] }),
    problem,
    notFound,
    respond: (out) =>
      out.outcome === "OK"
        ? AccessChangeResultSchema.parse(out.value)
        : undefined,
  },
  tool: {
    name: "revoke_document_access",
    description:
      "For a founder: prepares, for their approval, taking back one investor's access to one of their documents. Nothing changes until they approve exactly it.",
    input: RevokeTool,
    references: { document: "UPLOAD", investor: "RELATIONSHIP" },
    scopes: ["COMPANY_PROFILE"],
    purposes: ["OWN_COMPANY_QUESTION", "ACTION_PREPARATION"],
    eval: {
      say: ["Take {name} back from Zino.", "Stop Zino Capital seeing {name}."],
      names: "UPLOAD",
      orSays: "doesn't have|can't see|no access",
    },
    toCanonical: async (tool, context, ports) => {
      const access = await ports.founderRequests
        ?.documentAccess(context.actor, tool.document)
        .catch(() => null);
      if (access === null || access === undefined) return null;
      const grant = access.grants.find(
        (candidate) => candidate.relationshipId === tool.investor,
      );
      return grant === undefined
        ? refusal("They don't have access to that document now.")
        : { policyId: grant.policyId, documentId: access.documentId };
    },
  },
});

// --- answer an investor's question ---------------------------------------------

const Answer = z
  .object({
    questionId: UuidSchema,
    /** Q's path names the relationship, so the card binds to it. */
    relationshipId: UuidSchema.optional(),
    idempotencyKey: IdempotencyKeyHeaderSchema,
    input: AnswerQuestionSchema,
  })
  .strict();
type AnswerIn = z.infer<typeof Answer>;
type AnswerOut = Out<{
  readonly answerId: string;
  readonly evidenceStatus: "SELF_REPORTED" | "DOCUMENT_SUPPORTED";
  readonly recorded: boolean;
}>;

const AnswerTool = z
  .object({
    question: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .describe("The investor's open question, as they named it or its words."),
    answer: z
      .string()
      .trim()
      .min(1)
      .max(QUESTION_ANSWER_MAX_LENGTH)
      .describe("The founder's answer, in their own words, never Q's."),
    document: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .optional()
      .describe("A document of theirs that supports it, as named."),
  })
  .strict();

const ANSWER_INVESTOR_QUESTION = defineAppAction<
  AnswerIn,
  AnswerOut,
  z.infer<typeof AnswerTool>
>({
  name: "diligence.question.answer",
  short: "answer an investor's question",
  area: "documents",
  classification: "CONSEQUENTIAL",
  does: "Sends the founder's answer to an investor's question, with documents that support it; recorded as the founder's claim.",
  input: Answer,
  output: z.custom<AnswerOut>(),
  authorize: servicesDecide,
  run: (ports, context, input) =>
    service(ports).answer({
      actor: context.actor,
      questionId: input.questionId,
      answer: input.input.answer,
      documentIds: input.input.documentIds,
      idempotencyKey: input.idempotencyKey,
      correlationId: context.correlationId,
    }),
  targets: (input) => relationshipTarget(input.relationshipId ?? ""),
  card: (input) => ({
    summary:
      input.input.documentIds.length > 0
        ? "Send this answer with its document"
        : "Send this answer",
    preview: input.input.answer.slice(0, 600),
  }),
  done: (out) =>
    out.outcome === "OK"
      ? "Sent. They've been told, and it shows as your answer."
      : failedWords(out),
  succeeded,
  http: {
    method: "POST",
    path: QUESTION_ANSWER_PATH,
    fromRequest: (params, body, headers) => ({
      questionId: params["questionId"],
      idempotencyKey: keyOf(headers),
      input: body,
    }),
    status: 201,
    problem,
    notFound,
    respond: (out) =>
      out.outcome === "OK"
        ? AnswerQuestionResultSchema.parse(out.value)
        : undefined,
  },
  tool: {
    name: "answer_investor_question",
    description:
      "For a founder: prepares, for their approval, their answer to an investor's open question (from their inbox), in THEIR words, optionally with one of their documents as support. It is recorded as their claim, never as verified. Nothing is sent until they approve exactly it.",
    input: AnswerTool,
    references: { document: "UPLOAD" },
    scopes: ["COMPANY_PROFILE"],
    purposes: ["OWN_COMPANY_QUESTION", "ACTION_PREPARATION"],
    eval: {
      say: [
        "Tell Zino we had 131 paying customers in September.",
        "Answer their take rate question: it depends on volume.",
      ],
      orSays: "no open question|isn't",
    },
    toCanonical: async (tool, context, ports) => {
      const open = await openItems(ports, context);
      if (open === null) return null;
      const questions = open.flatMap((item) =>
        item.kind === "QUESTIONS"
          ? item.questions
              .filter((question) => question.answer === null)
              .map((question) => ({ item, question }))
          : [],
      );
      const hit = said(tool.question);
      const matches = questions.filter(
        ({ item, question }) =>
          hit(question.question) ||
          hit(question.assumptionLabel) ||
          hit(item.investorOrganisationName),
      );
      const chosen =
        matches.length === 1
          ? matches[0]
          : questions.length === 1
            ? questions[0]
            : undefined;
      if (chosen === undefined)
        return refusal("There's no single open question matching that.");
      return {
        questionId: chosen.question.questionId,
        relationshipId: chosen.item.relationshipId,
        idempotencyKey: context.idempotencyKey,
        input: {
          answer: tool.answer,
          documentIds: tool.document === undefined ? [] : [tool.document],
        },
      };
    },
  },
});

export const FOUNDER_DOCUMENT_ACTIONS: readonly AnyAppAction[] = [
  FULFIL_DOCUMENT_REQUEST,
  DECLINE_DOCUMENT_REQUEST,
  SHARE_DOCUMENT,
  SHARE_FOLDER,
  SET_FOLDER_LEVEL,
  REVOKE_DOCUMENT_ACCESS,
  ANSWER_INVESTOR_QUESTION,
];

// --- read_my("requests"), read_my("access") ----------------------------------------

const ITEM_STATUS: Readonly<Record<"OPEN" | "SHARED" | "DECLINED", string>> = {
  OPEN: "waiting for you",
  SHARED: "shared",
  DECLINED: "declined",
};

/** What investors asked them for, as the Requested tab lists it. */
export async function requestItems(
  ports: AppActionPorts,
  actor: AppActionContext["actor"],
): Promise<readonly OwnReadItem[] | null> {
  if (ports.founderRequests === undefined || ports.ownCompanyId === undefined)
    return null;
  const companyId = await ports.ownCompanyId(actor).catch(() => null);
  if (companyId === null) return [];
  const inbox = await ports.founderRequests
    .inbox(actor, companyId)
    .catch(() => null);
  if (inbox === null) return [];
  return inbox.items.flatMap((item): OwnReadItem[] =>
    item.kind === "DOCUMENT_REQUEST"
      ? [
          {
            id: item.itemId,
            title: item.title.slice(0, 200),
            status: ITEM_STATUS[item.status],
            at: item.requestedAt,
            facts: {
              kind: "document request",
              from: item.investorOrganisationName,
              askedBy: item.requesterName,
              note: item.note?.slice(0, 200) ?? null,
              inDataRoom: item.dataRoom !== null,
              sharedDocument: item.sharedDocument?.title.slice(0, 200) ?? null,
            },
          },
        ]
      : item.questions.map((question) => ({
          id: question.questionId,
          title: question.question.slice(0, 200),
          status:
            question.answer === null ? "waiting for your answer" : "answered",
          at: question.askedAt,
          facts: {
            kind: "question",
            from: item.investorOrganisationName,
            about: question.assumptionLabel,
            answer: question.answer?.text.slice(0, 200) ?? null,
          },
        })),
  );
}

const LEVEL_WORDS = new Map<string, string>(
  DOCUMENT_SCOPE_CHOICES.map((choice) => [choice.level, choice.words]),
);
const ACCESS_WORDS: Readonly<Record<DocumentAccessLevel, string>> =
  DOCUMENT_ACCESS_LEVEL_WORDS;

/** Who can see each of their documents, as the access editor shows it. */
export async function accessItems(
  ports: AppActionPorts,
  actor: AppActionContext["actor"],
): Promise<readonly OwnReadItem[] | null> {
  if (
    ports.founderRequests === undefined ||
    ports.dataRoom === undefined ||
    ports.ownCompanyId === undefined
  )
    return null;
  const companyId = await ports.ownCompanyId(actor).catch(() => null);
  if (companyId === null) return [];
  const view = await ports.dataRoom.view(actor, companyId).catch(() => null);
  if (view === null || view.viewer !== "OWNER") return [];
  const folders = new Map(view.folders.map((f) => [f.code, f.label]));
  const documents = view.documents.slice(0, 40);
  const access = await Promise.all(
    documents.map((document) =>
      ports.founderRequests
        ?.documentAccess(actor, document.documentId)
        .catch(() => null),
    ),
  );
  return documents.map((document, index) => {
    const grants = access[index]?.grants ?? [];
    return {
      id: document.documentId,
      title: document.title.slice(0, 200),
      status: LEVEL_WORDS.get(document.level) ?? "Only my team",
      at: document.updatedAt,
      facts: {
        folder: folders.get(document.folderCode) ?? null,
        sharedWith:
          grants.length === 0
            ? null
            : grants
                .map(
                  (grant) =>
                    `${grant.investorOrganisationName ?? "an investor"} (${ACCESS_WORDS[grant.accessLevel].toLowerCase()}${grant.expiresAt === null ? "" : `, until ${grant.expiresAt.slice(0, 10)}`})`,
                )
                .join("; ")
                .slice(0, 200),
        openedBy: document.openedBy,
      },
    };
  });
}
