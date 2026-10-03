import { z } from "zod";

import type { ChatSafetyService, ChatService } from "@capital-q/communication";
import {
  ChatReportResultDtoSchema,
  IDEMPOTENCY_KEY_HEADER,
  IdempotencyKeyHeaderSchema,
  RELATIONSHIP_CHAT_BLOCK_PATH,
  RELATIONSHIP_CHAT_REPORTS_PATH,
  RELATIONSHIP_CHAT_UNBLOCK_PATH,
  RELATIONSHIP_MESSAGE_UNSEND_PATH,
  RELATIONSHIP_MESSAGES_PATH,
  ReportChatRequestSchema,
  SendChatMessageRequestSchema,
  SendChatMessageResultDtoSchema,
} from "@capital-q/contracts";

import {
  defineAppAction,
  portMissing,
  relationshipTarget,
  type AnyAppAction,
} from "../define.js";
import type { AppActionPorts } from "../ports.js";

/**
 * Relationship chat (ADR 0040 checklist): send, unsend, block, unblock and
 * report, each declared once with its generated route (R34, ADR 0019).
 *
 * Sending is Q's through its chat tool (`legacyTool`) until this area's
 * second step. Unsend, block, unblock and report stay the person's own:
 * the screen offers them and Q never takes them for anyone
 * (`qCapability` names the offer), so they have no Q tool at all.
 */

const missing = portMissing;

const serviceResult = <T>(): z.ZodType<T> => z.custom<T>();

/** The communication service asks Network whether this person is a party. */
const servicesDecide = () => Promise.resolve({ ok: true as const });

const chat = (ports: AppActionPorts) => ports.chat ?? missing("chat");
const safety = (ports: AppActionPorts) =>
  ports.chatSafety ?? missing("chatSafety");

const keyOf = (headers: Readonly<Record<string, unknown>>) =>
  headers[IDEMPOTENCY_KEY_HEADER];

const Relationship = {
  relationshipId: z.string().max(64),
  idempotencyKey: IdempotencyKeyHeaderSchema,
};

const Send = z
  .object({ ...Relationship, input: SendChatMessageRequestSchema })
  .strict();

const SEND = defineAppAction<
  z.infer<typeof Send>,
  Awaited<ReturnType<ChatService["send"]>>
>({
  name: "chat.message.send",
  short: "send a chat message",
  area: "chat",
  classification: "CONSEQUENTIAL",
  does: "Sends a message in a connected relationship's chat, as the chat screen does.",
  input: Send,
  output: serviceResult(),
  authorize: servicesDecide,
  run: (ports, context, input) =>
    chat(ports).send({
      actor: context.actor,
      relationshipId: input.relationshipId,
      request: input.input,
      idempotencyKey: input.idempotencyKey,
    }),
  targets: (input) => relationshipTarget(input.relationshipId),
  // The words themselves and who gets them: the card is what they approve.
  card: (input, names) => ({
    summary:
      names?.counterpart == null
        ? "Send this message"
        : `Send ${names.counterpart} this message`,
    preview:
      input.input.kind === "TEXT"
        ? input.input.body
        : input.input.kind === "ATTACHMENT"
          ? (input.input.body ?? "An attachment, as written.")
          : "A voice note.",
  }),
  done: () => "Sent.",
  http: {
    method: "POST",
    path: RELATIONSHIP_MESSAGES_PATH,
    fromRequest: (params, body, headers) => ({
      relationshipId: params["relationshipId"],
      idempotencyKey: keyOf(headers),
      input: body,
    }),
    status: (out) => (out.deduplicated ? 200 : 201),
    respond: (out) => SendChatMessageResultDtoSchema.parse(out),
  },
  legacyTool: "propose_chat_message",
});

/** The person's own act on their side of a chat; never Q's to take. */
function ownAct<In>(definition: {
  readonly name: string;
  readonly short: string;
  readonly does: string;
  readonly input: z.ZodType<In>;
  readonly path: string;
  readonly offer: `offer.${string}`;
  readonly fromRequest: (
    params: Record<string, string>,
    body: unknown,
    headers: Readonly<Record<string, unknown>>,
  ) => unknown;
  readonly run: (
    ports: AppActionPorts,
    input: In,
    actor: Parameters<ChatSafetyService["unblock"]>[0]["actor"],
  ) => Promise<unknown>;
}): AnyAppAction {
  return defineAppAction<In, unknown>({
    name: definition.name,
    short: definition.short,
    area: "chat",
    classification: "INSTANT",
    does: definition.does,
    input: definition.input,
    output: z.unknown(),
    authorize: servicesDecide,
    run: (ports, context, input) => definition.run(ports, input, context.actor),
    targets: () => [],
    card: () => ({ summary: definition.short, preview: "" }),
    done: () => "Done.",
    http: {
      method: "POST",
      path: definition.path,
      fromRequest: definition.fromRequest,
      status: 204,
      respond: () => undefined,
    },
    qCapability: definition.offer,
  });
}

const Unsend = z
  .object({ ...Relationship, messageId: z.string().max(64) })
  .strict();
const Block = z.object(Relationship).strict();
const Report = z
  .object({ ...Relationship, input: ReportChatRequestSchema })
  .strict();

const REPORT = defineAppAction<
  z.infer<typeof Report>,
  Awaited<ReturnType<ChatSafetyService["report"]>>
>({
  name: "chat.report",
  short: "report a chat",
  area: "chat",
  classification: "INSTANT",
  does: "Reports a relationship's chat to Capital Q, as the chat screen does; the person's own act.",
  input: Report,
  output: serviceResult(),
  authorize: servicesDecide,
  run: (ports, context, input) =>
    safety(ports).report({
      actor: context.actor,
      relationshipId: input.relationshipId,
      request: input.input,
      idempotencyKey: input.idempotencyKey,
    }),
  targets: () => [],
  card: () => ({ summary: "Report this chat", preview: "" }),
  done: () => "Reported.",
  http: {
    method: "POST",
    path: RELATIONSHIP_CHAT_REPORTS_PATH,
    fromRequest: (params, body, headers) => ({
      relationshipId: params["relationshipId"],
      idempotencyKey: keyOf(headers),
      input: body,
    }),
    status: (out) => (out.deduplicated ? 200 : 201),
    respond: (out) => ChatReportResultDtoSchema.parse(out),
  },
  qCapability: "offer.chat_report",
});

export const CHAT_ACTIONS: readonly AnyAppAction[] = [
  SEND,
  ownAct<z.infer<typeof Unsend>>({
    name: "chat.message.unsend",
    short: "unsend my message",
    does: "Unsends the person's own message, as the chat screen does.",
    input: Unsend,
    path: RELATIONSHIP_MESSAGE_UNSEND_PATH,
    offer: "offer.chat_unsend",
    fromRequest: (params, _body, headers) => ({
      relationshipId: params["relationshipId"],
      messageId: params["messageId"],
      idempotencyKey: keyOf(headers),
    }),
    run: (ports, input, actor) =>
      chat(ports).unsend({
        actor,
        relationshipId: input.relationshipId,
        messageId: input.messageId,
        idempotencyKey: input.idempotencyKey,
      }),
  }),
  ownAct<z.infer<typeof Block>>({
    name: "chat.block",
    short: "block a chat",
    does: "Blocks messages from the other side of a relationship, for the person's own side.",
    input: Block,
    path: RELATIONSHIP_CHAT_BLOCK_PATH,
    offer: "offer.chat_block",
    fromRequest: (params, _body, headers) => ({
      relationshipId: params["relationshipId"],
      idempotencyKey: keyOf(headers),
    }),
    run: (ports, input, actor) =>
      safety(ports).block({
        actor,
        relationshipId: input.relationshipId,
        idempotencyKey: input.idempotencyKey,
      }),
  }),
  ownAct<z.infer<typeof Block>>({
    name: "chat.unblock",
    short: "unblock a chat",
    does: "Lifts the person's own block on a relationship's chat.",
    input: Block,
    path: RELATIONSHIP_CHAT_UNBLOCK_PATH,
    offer: "offer.chat_unblock",
    fromRequest: (params, _body, headers) => ({
      relationshipId: params["relationshipId"],
      idempotencyKey: keyOf(headers),
    }),
    run: (ports, input, actor) =>
      safety(ports).unblock({ actor, relationshipId: input.relationshipId }),
  }),
  REPORT,
];
