import { z } from "zod";

import {
  ConnectionRequestAnswerDtoSchema,
  ConnectionRequestRequestSchema,
  ConnectionRequestResultDtoSchema,
  ExpressInterestRequestSchema,
  ExpressInterestResultDtoSchema,
  IDEMPOTENCY_KEY_HEADER,
  IdempotencyKeyHeaderSchema,
  InterestResponseResultDtoSchema,
  NETWORK_COMPANY_EXPRESS_INTEREST_PATH,
  NETWORK_CONNECTION_REQUEST_ACCEPT_PATH,
  NETWORK_CONNECTION_REQUEST_DECLINE_PATH,
  NETWORK_INTEREST_ACCEPT_PATH,
  NETWORK_INTEREST_DECLINE_PATH,
  NETWORK_INVESTOR_CONNECTION_REQUEST_PATH,
  RespondToInterestRequestSchema,
  type QSubjectRef,
} from "@capital-q/contracts";
import {
  toConnectionRequestDto,
  toIncomingConnectionRequestDto,
  toIncomingInterestDto,
  toInterestDto,
  type ConnectionService,
  type InterestService,
} from "@capital-q/network";

import { defineAppAction, portMissing, type AnyAppAction } from "../define.js";
import type { AppActionPorts } from "../ports.js";

/**
 * Interest and connection requests (ADR 0040 checklist, relationships).
 * Express Interest, the company's answer to it, a founder's Connection
 * Request and the investor's answer: each declared once, its route
 * generated, server-confirmed and idempotent as before (201 when it
 * happened, 200 when the key had already done it).
 *
 * Step 1 only: Q still takes these through its relationship tools
 * (`legacyTool`), which errands, the pending-decision path and the parity
 * log all build on; moving them to generated tools is this area's second
 * step, coordinated with their owner. The verb stays in the path, never
 * a body field.
 */

const missing = portMissing;

const serviceResult = <T>(): z.ZodType<T> => z.custom<T>();

/** The network services authorise; every refusal is their one 404. */
const servicesDecide = () => Promise.resolve({ ok: true as const });

const interests = (ports: AppActionPorts) =>
  ports.interests ?? missing("interests");
const connections = (ports: AppActionPorts) =>
  ports.connections ?? missing("connections");

const Key = IdempotencyKeyHeaderSchema;
const keyOf = (headers: Readonly<Record<string, unknown>>) =>
  headers[IDEMPOTENCY_KEY_HEADER];
const createdOrReplayed = (out: { readonly deduplicated: boolean }) =>
  out.deduplicated ? (200 as const) : (201 as const);

const ExpressInterest = z
  .object({
    companyId: z.string().max(64),
    idempotencyKey: Key,
    input: ExpressInterestRequestSchema,
  })
  .strict();

const EXPRESS_INTEREST = defineAppAction<
  z.infer<typeof ExpressInterest>,
  Awaited<ReturnType<InterestService["expressInterest"]>>
>({
  name: "relationship.interest.express",
  short: "express interest in company",
  area: "relationships",
  classification: "CONSEQUENTIAL",
  does: "Expresses interest in a company, as the feed's and profile's Express Interest does: the company is told.",
  input: ExpressInterest,
  output: serviceResult(),
  authorize: servicesDecide,
  run: (ports, context, input) =>
    interests(ports).expressInterest({
      actor: context.actor,
      companyId: input.companyId,
      surface: input.input.surface,
      idempotencyKey: input.idempotencyKey,
      correlationId: context.correlationId,
    }),
  targets: (input): readonly QSubjectRef[] => [
    { kind: "COMPANY", companyId: input.companyId },
  ],
  card: () => ({
    summary: "Express interest",
    preview: "The company is told you're interested.",
  }),
  done: () => "Done. They know you're interested.",
  http: {
    method: "POST",
    path: NETWORK_COMPANY_EXPRESS_INTEREST_PATH,
    fromRequest: (params, body, headers) => ({
      companyId: params["companyId"],
      idempotencyKey: keyOf(headers),
      input: body,
    }),
    status: createdOrReplayed,
    respond: (out) =>
      ExpressInterestResultDtoSchema.parse({
        interest: toInterestDto(out.interest),
        deduplicated: out.deduplicated,
      }),
  },
  legacyTool: "propose_express_interest",
});

const Answer = z
  .object({
    interestId: z.string().max(64),
    idempotencyKey: Key,
    input: RespondToInterestRequestSchema,
  })
  .strict();

function answerInterest(decision: "ACCEPTED" | "DECLINED"): AnyAppAction {
  const accept = decision === "ACCEPTED";
  return defineAppAction<
    z.infer<typeof Answer>,
    Awaited<ReturnType<InterestService["respondToInterest"]>>
  >({
    name: accept
      ? "relationship.interest.accept"
      : "relationship.interest.decline",
    // ADR 0043: a decision on a relationship is never Q's alone.
    consequence: "COMMITMENT",
    short: accept
      ? "accept an investor's interest"
      : "decline an investor's interest",
    area: "relationships",
    classification: "CONSEQUENTIAL",
    does: accept
      ? "Accepts an investor's interest in their company, from the inbox."
      : "Declines an investor's interest in their company, from the inbox.",
    input: Answer,
    output: serviceResult(),
    authorize: servicesDecide,
    run: (ports, context, input) =>
      interests(ports).respondToInterest({
        actor: context.actor,
        interestId: input.interestId,
        decision,
        surface: "INBOX",
        idempotencyKey: input.idempotencyKey,
        correlationId: context.correlationId,
      }),
    targets: () => [],
    card: () => ({
      summary: accept ? "Accept their interest" : "Decline their interest",
      preview: "They are told your answer.",
    }),
    done: () => (accept ? "Done. You accepted." : "Done. You declined."),
    http: {
      method: "POST",
      path: accept
        ? NETWORK_INTEREST_ACCEPT_PATH
        : NETWORK_INTEREST_DECLINE_PATH,
      fromRequest: (params, body, headers) => ({
        interestId: params["interestId"],
        idempotencyKey: keyOf(headers),
        input: body ?? {},
      }),
      status: createdOrReplayed,
      respond: (out) =>
        InterestResponseResultDtoSchema.parse({
          interest: toIncomingInterestDto(out.interest, out.investor),
          deduplicated: out.deduplicated,
        }),
    },
    legacyTool: "propose_interest_answer",
  });
}

const Request = z
  .object({
    investorOrganisationId: z.string().max(64),
    idempotencyKey: Key,
    input: ConnectionRequestRequestSchema,
  })
  .strict();

const CONNECTION_REQUEST = defineAppAction<
  z.infer<typeof Request>,
  Awaited<ReturnType<ConnectionService["requestConnection"]>>
>({
  name: "relationship.connection_request.send",
  short: "ask an investor to connect",
  area: "relationships",
  classification: "CONSEQUENTIAL",
  does: "Sends an investor a Connection Request from their company, where the investor takes requests.",
  input: Request,
  output: serviceResult(),
  authorize: servicesDecide,
  run: (ports, context, input) =>
    connections(ports).requestConnection({
      actor: context.actor,
      investorOrganisationId: input.investorOrganisationId,
      idempotencyKey: input.idempotencyKey,
      correlationId: context.correlationId,
    }),
  targets: (input): readonly QSubjectRef[] => [
    {
      kind: "INVESTOR_ORGANISATION",
      investorOrganisationId: input.investorOrganisationId,
    },
  ],
  card: () => ({
    summary: "Send a connection request",
    preview: "The investor is asked to connect.",
  }),
  done: () => "Done. Your request is sent.",
  http: {
    method: "POST",
    path: NETWORK_INVESTOR_CONNECTION_REQUEST_PATH,
    fromRequest: (params, body, headers) => ({
      investorOrganisationId: params["investorOrganisationId"],
      idempotencyKey: keyOf(headers),
      input: body ?? {},
    }),
    status: createdOrReplayed,
    respond: (out) =>
      ConnectionRequestResultDtoSchema.parse({
        request: toConnectionRequestDto(out.interest),
        deduplicated: out.deduplicated,
      }),
  },
  legacyTool: "propose_connection_request",
});

function answerConnection(decision: "ACCEPTED" | "DECLINED"): AnyAppAction {
  const accept = decision === "ACCEPTED";
  return defineAppAction<
    z.infer<typeof Answer>,
    Awaited<ReturnType<ConnectionService["respondToConnectionRequest"]>>
  >({
    name: accept
      ? "relationship.connection_request.accept"
      : "relationship.connection_request.decline",
    // ADR 0043: a decision on a relationship is never Q's alone.
    consequence: "COMMITMENT",
    short: accept
      ? "accept a connection request"
      : "decline a connection request",
    area: "relationships",
    classification: "CONSEQUENTIAL",
    does: accept
      ? "Accepts a founder's Connection Request, from the investor's inbox."
      : "Declines a founder's Connection Request, from the investor's inbox.",
    input: Answer,
    output: serviceResult(),
    authorize: servicesDecide,
    run: (ports, context, input) =>
      connections(ports).respondToConnectionRequest({
        actor: context.actor,
        interestId: input.interestId,
        decision,
        surface: "INBOX",
        idempotencyKey: input.idempotencyKey,
        correlationId: context.correlationId,
      }),
    targets: () => [],
    card: () => ({
      summary: accept ? "Accept their request" : "Decline their request",
      preview: "The founder is told your answer.",
    }),
    done: () => (accept ? "Done. You accepted." : "Done. You declined."),
    http: {
      method: "POST",
      path: accept
        ? NETWORK_CONNECTION_REQUEST_ACCEPT_PATH
        : NETWORK_CONNECTION_REQUEST_DECLINE_PATH,
      fromRequest: (params, body, headers) => ({
        interestId: params["interestId"],
        idempotencyKey: keyOf(headers),
        input: body ?? {},
      }),
      status: createdOrReplayed,
      respond: (out) =>
        ConnectionRequestAnswerDtoSchema.parse({
          request: toIncomingConnectionRequestDto(out.interest, out.company),
          deduplicated: out.deduplicated,
        }),
    },
    legacyTool: "propose_connection_request_answer",
  });
}

export const INTEREST_ACTIONS: readonly AnyAppAction[] = [
  EXPRESS_INTEREST,
  answerInterest("ACCEPTED"),
  answerInterest("DECLINED"),
  CONNECTION_REQUEST,
  answerConnection("ACCEPTED"),
  answerConnection("DECLINED"),
];
