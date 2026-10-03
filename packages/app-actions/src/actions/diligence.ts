import { z } from "zod";

import {
  DiligenceRequestResultDtoSchema,
  DiligenceRevokeResultDtoSchema,
  DiligenceShareResultDtoSchema,
  IDEMPOTENCY_KEY_HEADER,
  IdempotencyKeyHeaderSchema,
  NETWORK_DILIGENCE_REQUEST_FULFIL_PATH,
  NETWORK_DILIGENCE_REQUESTS_PATH,
  NETWORK_DILIGENCE_SHARE_REVOKE_PATH,
  NETWORK_DILIGENCE_SHARES_PATH,
  RequestDiligenceDocumentRequestSchema,
  ShareDiligenceDocumentRequestSchema,
  type KnownErrorCode,
} from "@capital-q/contracts";
import type {
  DiligenceOutcome,
  DiligenceRefusal,
} from "@capital-q/permissions";

import {
  defineAppAction,
  defineAppActionFamily,
  type AnyAppAction,
} from "../define.js";
import type { AppActionPorts } from "../ports.js";

/**
 * Diligence documents (2026-10-02; ADR 0040): the founder shares one of
 * their own documents with a relationship in diligence, or takes it back;
 * the investor asks for a document; the founder answers a request by
 * sharing one. Each declared once with its own route, and one family tool
 * for Q. Sharing is the existing disclosure policy (relationship_shared),
 * never a looser rule; everything Q does here is approved on a card first.
 */

const missing = (port: string): never => {
  throw new Error(`APP_ACTION_PORT_MISSING:${port}`);
};
const diligence = (ports: AppActionPorts) =>
  ports.diligence ?? missing("diligence");
const servicesDecide = () => Promise.resolve({ ok: true as const });
const keyOf = (headers: Readonly<Record<string, unknown>>) =>
  headers[IDEMPOTENCY_KEY_HEADER];

const REFUSALS: Readonly<
  Record<
    DiligenceRefusal,
    { readonly code: KnownErrorCode; readonly detail: string }
  >
> = {
  NOT_FOUND: { code: "RESOURCE_NOT_FOUND", detail: "Not found." },
  NOT_OPEN: {
    code: "RESOURCE_CONFLICT",
    detail: "Diligence hasn't started on this relationship.",
  },
  COMPANY_ONLY: {
    code: "PERMISSION_DENIED",
    detail: "Only the company's side shares its documents.",
  },
  INVESTOR_ONLY: {
    code: "PERMISSION_DENIED",
    detail: "Only the investor's side asks for documents.",
  },
  NOT_SHAREABLE: {
    code: "RESOURCE_CONFLICT",
    detail: "That document can't be shared here.",
  },
};

const problem = (out: DiligenceOutcome<unknown>) =>
  out.outcome === "OK" ? null : REFUSALS[out.code];
const notFound = (out: DiligenceOutcome<unknown>) =>
  out.outcome === "REFUSED" && out.code === "NOT_FOUND";
const succeeded = (out: DiligenceOutcome<unknown>) => out.outcome === "OK";
const failedWords = (out: DiligenceOutcome<unknown>) =>
  problem(out)?.detail ?? "That couldn't be done.";

const Share = z
  .object({
    relationshipId: z.string().max(64),
    input: ShareDiligenceDocumentRequestSchema,
  })
  .strict();

const SHARE = defineAppAction<
  z.infer<typeof Share>,
  DiligenceOutcome<{ readonly policyId: string }>
>({
  name: "diligence.document.share",
  short: "share a diligence document",
  area: "relationships",
  classification: "CONSEQUENTIAL",
  does: "Shares one of the company's own documents with one investor in diligence, as the relationship page does; it can be taken back.",
  input: Share,
  output: z.custom<DiligenceOutcome<{ readonly policyId: string }>>(),
  authorize: servicesDecide,
  run: (ports, context, input) =>
    diligence(ports).share({
      actor: context.actor,
      relationshipId: input.relationshipId,
      documentId: input.input.documentId,
      correlationId: context.correlationId,
    }),
  targets: (input) => [
    { kind: "RELATIONSHIP", relationshipId: input.relationshipId },
  ],
  card: () => ({
    summary: "Share this document with them",
    preview:
      "They can open and download it while diligence lasts. You can take it back at any time.",
  }),
  done: (out) => (out.outcome === "OK" ? "Shared." : failedWords(out)),
  succeeded,
  http: {
    method: "POST",
    path: NETWORK_DILIGENCE_SHARES_PATH,
    fromRequest: (params, body) => ({
      relationshipId: params["relationshipId"],
      input: body,
    }),
    status: 201,
    problem,
    notFound,
    respond: (out) =>
      out.outcome === "OK"
        ? DiligenceShareResultDtoSchema.parse(out.value)
        : undefined,
  },
});

const Revoke = z
  .object({
    relationshipId: z.string().max(64),
    policyId: z.string().max(64),
  })
  .strict();

const REVOKE = defineAppAction<
  z.infer<typeof Revoke>,
  DiligenceOutcome<{ readonly revoked: boolean }>
>({
  name: "diligence.document.revoke",
  short: "unshare a diligence document",
  area: "relationships",
  classification: "CONSEQUENTIAL",
  does: "Takes back a document the company shared with one investor in diligence; they lose access at once.",
  input: Revoke,
  output: z.custom<DiligenceOutcome<{ readonly revoked: boolean }>>(),
  authorize: servicesDecide,
  run: (ports, context, input) =>
    diligence(ports).revoke({
      actor: context.actor,
      relationshipId: input.relationshipId,
      policyId: input.policyId,
      correlationId: context.correlationId,
    }),
  targets: (input) => [
    { kind: "RELATIONSHIP", relationshipId: input.relationshipId },
  ],
  card: () => ({
    summary: "Stop sharing this document",
    preview: "They can no longer open or download it.",
  }),
  done: (out) =>
    out.outcome === "OK" ? "They no longer have it." : failedWords(out),
  succeeded,
  http: {
    method: "POST",
    path: NETWORK_DILIGENCE_SHARE_REVOKE_PATH,
    fromRequest: (params) => ({
      relationshipId: params["relationshipId"],
      policyId: params["policyId"],
    }),
    status: 200,
    problem,
    notFound,
    respond: (out) =>
      out.outcome === "OK"
        ? DiligenceRevokeResultDtoSchema.parse(out.value)
        : undefined,
  },
});

const Ask = z
  .object({
    relationshipId: z.string().max(64),
    idempotencyKey: IdempotencyKeyHeaderSchema,
    input: RequestDiligenceDocumentRequestSchema,
  })
  .strict();

const REQUEST = defineAppAction<
  z.infer<typeof Ask>,
  DiligenceOutcome<{ readonly requestId: string }>
>({
  name: "diligence.document.request",
  short: "ask for a diligence document",
  area: "relationships",
  classification: "CONSEQUENTIAL",
  does: "Asks the company, in diligence, for one document (a title and an optional note), as the relationship page does; they see it on their checklist.",
  input: Ask,
  output: z.custom<DiligenceOutcome<{ readonly requestId: string }>>(),
  authorize: servicesDecide,
  run: (ports, context, input) =>
    diligence(ports).request({
      actor: context.actor,
      relationshipId: input.relationshipId,
      title: input.input.title,
      note: input.input.note ?? null,
      idempotencyKey: input.idempotencyKey,
      correlationId: context.correlationId,
    }),
  targets: (input) => [
    { kind: "RELATIONSHIP", relationshipId: input.relationshipId },
  ],
  card: (input) => ({
    summary: `Ask for: ${input.input.title}`,
    preview:
      input.input.note === undefined || input.input.note === null
        ? "The company sees this on their diligence checklist."
        : `With your note: "${input.input.note}"`,
  }),
  done: (out) =>
    out.outcome === "OK"
      ? "Asked. They'll see it on their checklist."
      : failedWords(out),
  succeeded,
  http: {
    method: "POST",
    path: NETWORK_DILIGENCE_REQUESTS_PATH,
    fromRequest: (params, body, headers) => ({
      relationshipId: params["relationshipId"],
      idempotencyKey: keyOf(headers),
      input: body,
    }),
    status: 201,
    problem,
    notFound,
    respond: (out) =>
      out.outcome === "OK"
        ? DiligenceRequestResultDtoSchema.parse(out.value)
        : undefined,
  },
});

const Fulfil = z
  .object({
    relationshipId: z.string().max(64),
    requestId: z.string().max(64),
    input: ShareDiligenceDocumentRequestSchema,
  })
  .strict();

const FULFIL = defineAppAction<
  z.infer<typeof Fulfil>,
  DiligenceOutcome<{ readonly policyId: string }>
>({
  name: "diligence.request.fulfil",
  short: "answer a document request",
  area: "relationships",
  classification: "CONSEQUENTIAL",
  does: "Answers an investor's diligence request by sharing one of the company's own documents with them; the request shows as fulfilled to both.",
  input: Fulfil,
  output: z.custom<DiligenceOutcome<{ readonly policyId: string }>>(),
  authorize: servicesDecide,
  run: (ports, context, input) =>
    diligence(ports).share({
      actor: context.actor,
      relationshipId: input.relationshipId,
      documentId: input.input.documentId,
      requestId: input.requestId,
      correlationId: context.correlationId,
    }),
  targets: (input) => [
    { kind: "RELATIONSHIP", relationshipId: input.relationshipId },
  ],
  card: () => ({
    summary: "Answer their request with this document",
    preview:
      "They can open and download it, and the request shows as fulfilled. You can take it back at any time.",
  }),
  done: (out) =>
    out.outcome === "OK"
      ? "Shared; the request is fulfilled."
      : failedWords(out),
  succeeded,
  http: {
    method: "POST",
    path: NETWORK_DILIGENCE_REQUEST_FULFIL_PATH,
    fromRequest: (params, body) => ({
      relationshipId: params["relationshipId"],
      requestId: params["requestId"],
      input: body,
    }),
    status: 201,
    problem,
    notFound,
    respond: (out) =>
      out.outcome === "OK"
        ? DiligenceShareResultDtoSchema.parse(out.value)
        : undefined,
  },
});

const DiligenceTool = z
  .object({
    relationship: z
      .string()
      .min(1)
      .max(200)
      .describe("The company or investor as the person named it."),
    operation: z
      .enum(["SHARE", "REVOKE", "REQUEST", "FULFIL"])
      .describe(
        "SHARE (founder): share one of their documents. REVOKE (founder): take a shared document back. REQUEST (investor): ask for a document. FULFIL (founder): answer one of the investor's requests with a document.",
      ),
    document: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe("SHARE, REVOKE, FULFIL: the document as they named it."),
    title: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe(
        "REQUEST: what to ask for. FULFIL: the request being answered, as they named it.",
      ),
    note: z
      .string()
      .min(1)
      .max(1000)
      .optional()
      .describe("REQUEST: an optional note."),
  })
  .strict();

export const DILIGENCE_ACTIONS: readonly AnyAppAction[] = defineAppActionFamily<
  z.infer<typeof DiligenceTool>
>({
  name: "diligence.change",
  short: "diligence documents and requests",
  area: "relationships",
  does: "Shares or takes back a company's diligence documents, asks for one as an investor, or answers a request, as the relationship page's diligence area does.",
  members: { SHARE, REVOKE, REQUEST, FULFIL },
  tool: {
    name: "diligence_documents",
    description:
      "Prepares, for the person's approval, a change in a relationship's diligence area: a founder sharing one of their own documents with that investor, taking one back, or answering the investor's request with a document; an investor asking the company for a document. Name the relationship and the document as they said them. Nothing changes until they approve exactly it.",
    input: DiligenceTool,
    // Diligence shares the company's uploaded (Evidence) documents, never
    // Q's drafts: matched among their uploads.
    references: { relationship: "RELATIONSHIP", document: "UPLOAD" },
    purposes: ["RELATIONSHIP_QUESTION", "COUNTERPARTY_COMPANY_QUESTION"],
    eval: {
      say: [
        "Share our financial model with {name}.",
        "Ask {name} for their last 12 months of management accounts.",
      ],
      names: "RELATIONSHIP",
    },
    toCanonical: async (tool, context, ports) => {
      const relationshipId = tool.relationship;
      switch (tool.operation) {
        case "SHARE":
          return tool.document === undefined
            ? null
            : {
                operation: "SHARE",
                input: { relationshipId, input: { documentId: tool.document } },
              };
        case "REQUEST":
          return tool.title === undefined
            ? null
            : {
                operation: "REQUEST",
                input: {
                  relationshipId,
                  idempotencyKey: context.idempotencyKey,
                  input: {
                    title: tool.title,
                    ...(tool.note === undefined ? {} : { note: tool.note }),
                  },
                },
              };
        case "REVOKE":
        case "FULFIL": {
          if (tool.document === undefined) return null;
          const view = await ports.diligence
            ?.view({ actor: context.actor, relationshipId })
            .catch(() => null);
          if (view === null || view === undefined) return null;
          if (tool.operation === "REVOKE") {
            const share = view.shares.find(
              (candidate) => candidate.documentId === tool.document,
            );
            return share === undefined
              ? null
              : {
                  operation: "REVOKE",
                  input: { relationshipId, policyId: share.policyId },
                };
          }
          const wanted = (tool.title ?? "").trim().toLowerCase();
          const open = view.requests.filter((r) => r.status === "OPEN");
          const request =
            open.find((r) => r.title.toLowerCase() === wanted) ??
            open.find(
              (r) =>
                wanted.length > 0 && r.title.toLowerCase().includes(wanted),
            ) ??
            (open.length === 1 ? open[0] : undefined);
          return request === undefined
            ? null
            : {
                operation: "FULFIL",
                input: {
                  relationshipId,
                  requestId: request.requestId,
                  input: { documentId: tool.document },
                },
              };
        }
      }
    },
  },
});
