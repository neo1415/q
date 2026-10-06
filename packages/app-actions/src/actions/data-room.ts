import { z } from "zod";

import {
  DATA_ROOM_DOCUMENT_LEVEL_PATH,
  DATA_ROOM_GRANT_DEFAULT_DAYS,
  DATA_ROOM_REQUEST_DECISION_PATH,
  COMPANY_DATA_ROOM_REQUESTS_PATH,
  DECK_EXTRACTION_CONFIRM_PATH,
  DataRoomCodeSchema,
  DataRoomLevelResultSchema,
  DataRoomLevelSchema,
  DataRoomRequestResultSchema,
  DeckExtractionConfirmResultSchema,
  DecideDataRoomRequestSchema,
  IDEMPOTENCY_KEY_HEADER,
  IdempotencyKeyHeaderSchema,
  RequestDataRoomAccessRequestSchema,
  UuidSchema,
  type DataRoomLevel,
  type KnownErrorCode,
} from "@capital-q/contracts";
import type { DataRoomOutcome, DataRoomRefusal } from "@capital-q/permissions";

import { defineAppAction, refusal, relationshipTarget, type AnyAppAction } from "../define.js";
import type { AppActionPorts } from "../ports.js";

/**
 * The data room and the deck reading (overnight plan A3, A5, A8; ADR
 * 0040): each screen action declared once, with its own route and its Q
 * tool. Everything Q does here widens or answers a disclosure, so Q
 * prepares it and the person approves exactly it.
 */

const missing = (port: string): never => {
  throw new Error(`APP_ACTION_PORT_MISSING:${port}`);
};
const room = (ports: AppActionPorts) => ports.dataRoom ?? missing("dataRoom");
const deck = (ports: AppActionPorts) => ports.companyDeck ?? missing("companyDeck");
const servicesDecide = () => Promise.resolve({ ok: true as const });

const LEVEL_WORDS: Readonly<Record<DataRoomLevel, string>> = {
  PUBLIC: "Public: investors who can find your company can open it",
  ON_REQUEST: "On request: investors see its name and ask; you approve each one",
  SHARED_ONLY: "Shared only: hidden unless you share it",
  PRIVATE: "Private: only your team",
};

const REFUSALS: Readonly<Record<DataRoomRefusal, { readonly code: KnownErrorCode; readonly detail: string }>> = {
  NOT_FOUND: { code: "RESOURCE_NOT_FOUND", detail: "Not found." },
  OWNER_ONLY: { code: "PERMISSION_DENIED", detail: "Only the company's own team changes its data room." },
  INVESTOR_ONLY: { code: "PERMISSION_DENIED", detail: "Only investors ask for documents." },
  NOT_REQUESTABLE: { code: "RESOURCE_CONFLICT", detail: "That document isn't available on request." },
  ALREADY_DECIDED: { code: "RESOURCE_CONFLICT", detail: "That request was already answered." },
  VERSION_CONFLICT: { code: "RESOURCE_CONFLICT", detail: "Someone changed this meanwhile. Refresh and try again." },
};
const problem = (out: DataRoomOutcome<unknown>) => (out.outcome === "OK" ? null : REFUSALS[out.code]);
const notFound = (out: DataRoomOutcome<unknown>) => out.outcome === "REFUSED" && out.code === "NOT_FOUND";
const succeeded = (out: DataRoomOutcome<unknown>) => out.outcome === "OK";
const failedWords = (out: DataRoomOutcome<unknown>) => problem(out)?.detail ?? "That couldn't be done.";

// --- set a document's level (founder) -------------------------------------------

const SetLevel = z
  .object({
    documentId: UuidSchema,
    level: DataRoomLevelSchema,
    folderCode: DataRoomCodeSchema.optional(),
    checklistItemCode: DataRoomCodeSchema.nullable().optional(),
    expectedVersion: z.number().int().min(1).optional(),
  })
  .strict();

const SetLevelTool = z
  .object({
    document: z.string().trim().min(1).max(200).describe("The document as they named it."),
    level: DataRoomLevelSchema.describe(
      "PUBLIC (investors who can find the company open it), ON_REQUEST (its name is listed; investors ask and the founder approves each), SHARED_ONLY (hidden unless shared), PRIVATE (only their team).",
    ),
  })
  .strict();

export const SET_DATA_ROOM_LEVEL = defineAppAction<
  z.infer<typeof SetLevel>,
  DataRoomOutcome<{ readonly documentId: string; readonly level: DataRoomLevel; readonly version: number }>,
  z.infer<typeof SetLevelTool>
>({
  name: "data_room.document.level.set",
  supersedes: true,
  short: "set who sees a document",
  area: "documents",
  classification: "CONSEQUENTIAL",
  does: "Sets who can see one of the company's documents in its data room: public, on request, shared only, or private.",
  input: SetLevel,
  output: z.custom<DataRoomOutcome<{ readonly documentId: string; readonly level: DataRoomLevel; readonly version: number }>>(),
  authorize: servicesDecide,
  run: (ports, context, input) =>
    room(ports).setLevel({
      actor: context.actor,
      documentId: input.documentId,
      level: input.level,
      folderCode: input.folderCode,
      checklistItemCode: input.checklistItemCode,
      expectedVersion: input.expectedVersion,
      correlationId: context.correlationId,
    }),
  targets: (input) => [{ kind: "DOCUMENT", documentId: input.documentId }],
  card: (input) => ({
    summary: "Change who can see this document",
    preview: LEVEL_WORDS[input.level],
  }),
  done: (out) => (out.outcome === "OK" ? "Done. The data room shows it that way now." : failedWords(out)),
  succeeded,
  http: {
    method: "POST",
    path: DATA_ROOM_DOCUMENT_LEVEL_PATH,
    fromRequest: (params, body) => ({
      ...(typeof body === "object" && body !== null ? body : {}),
      documentId: params["documentId"],
    }),
    problem,
    notFound,
    respond: (out) =>
      out.outcome === "OK"
        ? DataRoomLevelResultSchema.parse({
            documentId: out.value.documentId,
            level: out.value.level,
            visibilityScope:
              out.value.level === "PUBLIC"
                ? "network_visible"
                : out.value.level === "PRIVATE"
                  ? "organisation_private"
                  : "specifically_shared",
            version: out.value.version,
          })
        : undefined,
  },
  tool: {
    name: "set_data_room_level",
    description:
      "Sets who can see one of the person's own company documents in their data room: PUBLIC, ON_REQUEST, SHARED_ONLY or PRIVATE, exactly as the data room's choice does. Prepared for their approval; nothing changes until they approve exactly it.",
    input: SetLevelTool,
    references: { document: "UPLOAD" },
    scopes: ["COMPANY_PROFILE"],
    purposes: ["OWN_COMPANY_QUESTION", "ACTION_PREPARATION"],
    eval: {
      say: ["Put {name} on request in my data room.", "Make {name} private again."],
      names: "UPLOAD",
    },
    toCanonical: (input) => Promise.resolve({ documentId: input.document, level: input.level }),
  },
});

// --- ask for access (investor) ------------------------------------------------

const Ask = z
  .object({
    companyId: UuidSchema,
    idempotencyKey: IdempotencyKeyHeaderSchema,
    input: RequestDataRoomAccessRequestSchema,
  })
  .strict();

const AskTool = z
  .object({
    company: z.string().trim().min(1).max(200).describe("The company as the person named it."),
    document: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .optional()
      .describe("The on-request document as they named it; leave out to ask for everything on request."),
    note: z.string().trim().min(1).max(1000).optional().describe("An optional note to the founders."),
  })
  .strict();

export const REQUEST_DATA_ROOM_ACCESS = defineAppAction<
  z.infer<typeof Ask>,
  DataRoomOutcome<{ readonly requestId: string; readonly status: "OPEN" }>,
  z.infer<typeof AskTool>
>({
  name: "data_room.access.request",
  short: "ask for a data-room document",
  area: "discovery",
  classification: "CONSEQUENTIAL",
  does: "Asks a company for access to one of its on-request data-room documents, or to all of them, with an optional note, as the data room's Request button does.",
  input: Ask,
  output: z.custom<DataRoomOutcome<{ readonly requestId: string; readonly status: "OPEN" }>>(),
  authorize: servicesDecide,
  run: (ports, context, input) =>
    room(ports).requestAccess({
      actor: context.actor,
      companyId: input.companyId,
      documentId: input.input.documentId,
      note: input.input.note ?? null,
      idempotencyKey: input.idempotencyKey,
      correlationId: context.correlationId,
    }),
  targets: (input) => [{ kind: "COMPANY", companyId: input.companyId }],
  card: (input) => ({
    summary: input.input.documentId === null ? "Ask for everything on request" : "Ask for this document",
    preview:
      input.input.note === undefined || input.input.note === null
        ? "The founders see your name, your firm and the request. You'll hear when they answer."
        : `With your note: "${input.input.note}"`,
  }),
  done: (out) => (out.outcome === "OK" ? "Asked. You'll hear when they answer." : failedWords(out)),
  succeeded,
  http: {
    method: "POST",
    path: COMPANY_DATA_ROOM_REQUESTS_PATH,
    fromRequest: (params, body, headers) => ({
      companyId: params["companyId"],
      idempotencyKey: headers[IDEMPOTENCY_KEY_HEADER],
      input: body,
    }),
    status: 201,
    problem,
    notFound,
    respond: (out) => (out.outcome === "OK" ? DataRoomRequestResultSchema.parse(out.value) : undefined),
  },
  tool: {
    name: "request_data_room_access",
    description:
      "Prepares, for the investor's approval, a request to a company for one of its on-request data-room documents (by the title the data room lists) or for everything on request. Only titles the data room already shows them can be asked for. Nothing is sent until they approve exactly it.",
    input: AskTool,
    references: { company: "COMPANY" },
    purposes: ["COUNTERPARTY_COMPANY_QUESTION", "ACTION_PREPARATION", "RELATIONSHIP_QUESTION"],
    eval: {
      say: ["Ask {name} for their cap table.", "Request everything on request from {name}."],
      names: "COMPANY",
      orSays: "isn't available|on request",
    },
    toCanonical: async (tool, context, ports) => {
      const companyId = tool.company;
      let documentId: string | null = null;
      if (tool.document !== undefined) {
        const view = await ports.dataRoom?.view(context.actor, companyId).catch(() => null);
        if (view === null || view === undefined || view.viewer !== "INVESTOR") return null;
        const wanted = tool.document.toLowerCase();
        const candidates = view.documents.filter((d) => d.access === "REQUESTABLE");
        const match =
          candidates.find((d) => d.title.toLowerCase() === wanted) ??
          candidates.find((d) => d.title.toLowerCase().includes(wanted) || wanted.includes(d.title.toLowerCase()));
        if (match === undefined) return refusal("That document isn't listed as on request in their data room.");
        documentId = match.documentId;
      }
      return {
        companyId,
        idempotencyKey: context.idempotencyKey,
        input: { documentId, ...(tool.note === undefined ? {} : { note: tool.note }) },
      };
    },
  },
});

// --- answer a request (founder) -------------------------------------------------

const Decide = z
  .object({
    requestId: UuidSchema,
    /** The relationship the request came through: what the approval binds to. */
    relationshipId: UuidSchema.optional(),
    input: DecideDataRoomRequestSchema,
  })
  .strict();

const DecideTool = z
  .object({
    request: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .describe("Whose request, or for which document, as the person said it (\"Northbound's cap table request\")."),
    decision: z.enum(["APPROVE", "DECLINE"]),
    days: z.number().int().optional().describe("APPROVE: how long they keep access: 7, 14, 30 (default) or 90 days."),
  })
  .strict();

export const DECIDE_DATA_ROOM_REQUEST = defineAppAction<
  z.infer<typeof Decide>,
  DataRoomOutcome<{ readonly requestId: string; readonly status: "APPROVED" | "DECLINED" }>,
  z.infer<typeof DecideTool>
>({
  name: "data_room.request.decide",
  short: "answer a data-room request",
  area: "documents",
  classification: "CONSEQUENTIAL",
  does: "Approves an investor's data-room request until a date, or declines it, as the data room's request card does.",
  input: Decide,
  output: z.custom<DataRoomOutcome<{ readonly requestId: string; readonly status: "APPROVED" | "DECLINED" }>>(),
  authorize: servicesDecide,
  run: (ports, context, input) =>
    room(ports).decide({
      actor: context.actor,
      requestId: input.requestId,
      relationshipId: input.relationshipId,
      decision: input.input.decision,
      ...(input.input.decision === "APPROVE" ? { days: input.input.days } : {}),
      correlationId: context.correlationId,
    }),
  targets: (input) => relationshipTarget(input.relationshipId ?? ""),
  card: (input) =>
    input.input.decision === "APPROVE"
      ? {
          summary: "Share what they asked for",
          preview: `They can open it, view only, for ${String(input.input.days)} days. You can take it back at any time.`,
        }
      : { summary: "Say no to this request", preview: "They see that it wasn't shared. Nothing else changes." },
  done: (out) =>
    out.outcome === "OK"
      ? out.value.status === "APPROVED"
        ? "Shared. They can open it until the date you chose."
        : "Declined."
      : failedWords(out),
  succeeded,
  http: {
    method: "POST",
    path: DATA_ROOM_REQUEST_DECISION_PATH,
    fromRequest: (params, body) => ({ requestId: params["requestId"], input: body }),
    problem,
    notFound,
    respond: (out) => (out.outcome === "OK" ? DataRoomRequestResultSchema.parse(out.value) : undefined),
  },
  tool: {
    name: "answer_data_room_request",
    description:
      "Prepares, for the founder's approval, an answer to an investor's data-room request: approve (view only, until a date: 7, 14, 30 or 90 days) or decline. Name the request by who asked or what for. Nothing changes until they approve exactly it.",
    input: DecideTool,
    references: {},
    scopes: ["COMPANY_PROFILE"],
    purposes: ["OWN_COMPANY_QUESTION", "ACTION_PREPARATION", "RELATIONSHIP_QUESTION"],
    eval: {
      say: ["Approve Northbound's request for 30 days.", "Decline the cap table request."],
      orSays: "no open request|isn't",
    },
    toCanonical: async (tool, context, ports) => {
      const companyId = await ports.ownCompanyId?.(context.actor).catch(() => null);
      if (companyId === null || companyId === undefined) return null;
      const view = await ports.dataRoom?.view(context.actor, companyId).catch(() => null);
      if (view === null || view === undefined || view.viewer !== "OWNER") return null;
      const open = view.requests.filter((r) => r.status === "OPEN");
      const said = tool.request.toLowerCase();
      const hit = (text: string | null) => text !== null && (said.includes(text.toLowerCase()) || text.toLowerCase().includes(said));
      const matches = open.filter(
        (r) => hit(r.requesterOrganisationName) || hit(r.requesterName) || hit(r.documentTitle),
      );
      const request = matches.length === 1 ? matches[0] : open.length === 1 ? open[0] : undefined;
      if (request === undefined) return refusal("There's no single open request matching that.");
      const days = [7, 14, 30, 90].includes(tool.days ?? -1) ? (tool.days ?? DATA_ROOM_GRANT_DEFAULT_DAYS) : DATA_ROOM_GRANT_DEFAULT_DAYS;
      return {
        requestId: request.requestId,
        relationshipId: request.relationshipId,
        input: tool.decision === "APPROVE" ? { decision: "APPROVE", days } : { decision: "DECLINE" },
      };
    },
  },
});

// --- confirm Q's reading of the deck (founder; the Write Gate) -------------------

const Confirm = z
  .object({ companyId: UuidSchema, documentId: UuidSchema, extractionId: UuidSchema })
  .strict();
const ConfirmTool = z.object({}).strict();
type ConfirmOut =
  | { readonly outcome: "OK"; readonly value: { readonly extractionId: string; readonly confirmed: true } }
  | { readonly outcome: "REFUSED"; readonly code: "NOT_FOUND" | "STALE" };

export const CONFIRM_DECK_READING = defineAppAction<
  z.infer<typeof Confirm>,
  ConfirmOut,
  z.infer<typeof ConfirmTool>
>({
  name: "deck.extraction.confirm",
  short: "confirm the deck reading",
  area: "documents",
  classification: "CONSEQUENTIAL",
  does: "Confirms what Q read from the company's current pitch deck, so investors who can see the deck also see the twelve sections.",
  input: Confirm,
  output: z.custom<ConfirmOut>(),
  authorize: servicesDecide,
  run: (ports, context, input) =>
    deck(ports).confirm({
      actor: context.actor,
      companyId: input.companyId,
      documentId: input.documentId,
      extractionId: input.extractionId,
      correlationId: context.correlationId,
    }),
  targets: (input) => [{ kind: "DOCUMENT", documentId: input.documentId }],
  card: () => ({
    summary: "Show Q's read of your deck to investors",
    preview:
      "Investors who can see your deck will also see the twelve sections as Q read them, marked as your claims. Coaching notes stay yours.",
  }),
  done: (out) =>
    out.outcome === "OK" ? "Done. Investors who can see your deck now see the sections too." : "That reading is out of date; Q will read the new version.",
  succeeded: (out) => out.outcome === "OK",
  http: {
    method: "POST",
    path: DECK_EXTRACTION_CONFIRM_PATH,
    fromRequest: (params, body) => ({
      companyId: typeof body === "object" && body !== null ? (body as Record<string, unknown>)["companyId"] : undefined,
      documentId: params["documentId"],
      extractionId: params["extractionId"],
    }),
    problem: (out) =>
      out.outcome === "OK"
        ? null
        : out.code === "STALE"
          ? { code: "RESOURCE_CONFLICT", detail: "That reading is out of date." }
          : { code: "RESOURCE_NOT_FOUND", detail: "Not found." },
    notFound: (out) => out.outcome === "REFUSED" && out.code === "NOT_FOUND",
    respond: (out) => (out.outcome === "OK" ? DeckExtractionConfirmResultSchema.parse(out.value) : undefined),
  },
  tool: {
    name: "confirm_deck_reading",
    description:
      "Prepares, for the founder's approval, confirming Q's reading of their current pitch deck so investors who can see the deck also see the twelve sections. Nothing changes until they approve.",
    input: ConfirmTool,
    references: {},
    scopes: ["COMPANY_PROFILE"],
    purposes: ["OWN_COMPANY_QUESTION", "ACTION_PREPARATION"],
    eval: {
      say: ["Show investors your read of my deck.", "Confirm the deck sections."],
      orSays: "no deck|hasn't read",
    },
    toCanonical: async (_tool, context, ports) => {
      const companyId = await ports.ownCompanyId?.(context.actor).catch(() => null);
      if (companyId === null || companyId === undefined) return null;
      const view = await ports.companyDeck?.view(context.actor, companyId).catch(() => null);
      if (view?.deck === null || view?.deck === undefined || view.extraction === null) {
        return refusal("Q hasn't read a deck of yours yet.");
      }
      return { companyId, documentId: view.deck.documentId, extractionId: view.extraction.extractionId };
    },
  },
});

export const DATA_ROOM_ACTIONS: readonly AnyAppAction[] = [
  SET_DATA_ROOM_LEVEL,
  REQUEST_DATA_ROOM_ACCESS,
  DECIDE_DATA_ROOM_REQUEST,
  CONFIRM_DECK_READING,
];
