import { z } from "zod";
import {
  APPLICATION_ONLY,
  documentsReading,
  submittedReading,
  type SubmittedDocumentRead,
} from "./gateq-submitted-reading.js";

import {
  GATEQ_INBOX_ARCHIVE_PATH,
  gateqReadingSources,
  GATEQ_INBOX_ASSIGN_PATH,
  GATEQ_INBOX_LABEL_PATH,
  GATEQ_INBOX_NOTES_PATH,
  GATEQ_INBOX_PASS_PATH,
  GATEQ_INBOX_REPLY_PATH,
  GATEQ_INBOX_SETTINGS_PATH,
  GATEQ_INBOX_STAR_PATH,
  GateqInboxArchiveRequestSchema,
  GateqInboxAssignRequestSchema,
  GateqInboxChangedDtoSchema,
  GateqInboxLabelRequestSchema,
  GateqInboxNoteRequestSchema,
  GateqInboxPassRequestSchema,
  GateqInboxReplyRequestSchema,
  GateqInboxSettingsRequestSchema,
  GateqInboxStarRequestSchema,
  GateqOutboundSubjectSchema,
  GateqPassReasonSchema,
  UuidSchema,
  type GateqInboxDetailDto,
  type GateqInboxDto,
  type GateqPassReason,
  type QTaskClass,
} from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

import {
  defineAppAction,
  portMissing,
  readyToSendLine,
  refusal,
  type AnyAppAction,
  type AppActionContext,
  type AppActionRefusal,
} from "../define.js";
import type { AppActionPorts } from "../ports.js";
import type { OwnReadItem } from "../reads.js";

/**
 * F4 (2026-10-06): the investor's GateQ inbox, declared once (ADR 0040).
 * Each action is a route for the inbox screen and a Q tool, through the
 * same inbox service and GateQ's own gateway authority. Reading, starring,
 * labelling, archiving and team notes are the member's own word (INSTANT);
 * a pass or a reply goes to a founder, so it is CONSEQUENTIAL: the screen's
 * Send press, or an approved card, approves exactly those words. Q drafts
 * and proposes; it never passes on anyone's behalf.
 */

type Changed = {
  readonly ok: true;
  readonly changed: number;
  readonly deduplicated: boolean;
};
type Refused = { readonly ok: false };
type Result = Changed | Refused;
/** A pass or a reply not sent, after authorisation: why, for the person. */
type AnswerRefused = {
  readonly ok: false;
  readonly reason: "RECIPIENT_CHANGED" | "KEY_REUSED" | "RATE_LIMITED";
};
type Answered = Changed | Refused | AnswerRefused;
type Outbound = {
  readonly to?: string | undefined;
  readonly subject?: string | undefined;
};
/** What an answer would carry besides its words (the inbox service's read). */
export type GateqOutboundPreview = {
  readonly ok: true;
  readonly companyName: string;
  readonly fund: string;
  readonly to: string | null;
  readonly toName: string | null;
  readonly subject: string;
  readonly replyTo: string | null;
  readonly deliverable: boolean;
};
export type GateqReplyPurpose = "CALL" | "ASK" | "THANKS";

/** The inbox service, as the actions call it. The app composes it. */
export type GateqInboxPort = {
  readonly star: (
    actor: ActorContext,
    gatewayId: string,
    input: {
      readonly applicationIds: readonly string[];
      readonly starred: boolean;
    },
  ) => Promise<Result>;
  readonly archive: (
    actor: ActorContext,
    gatewayId: string,
    input: {
      readonly applicationIds: readonly string[];
      readonly archived: boolean;
    },
  ) => Promise<Result>;
  readonly label: (
    actor: ActorContext,
    gatewayId: string,
    input: {
      readonly applicationIds: readonly string[];
      readonly label: string;
      readonly on: boolean;
    },
  ) => Promise<Result>;
  readonly assign: (
    actor: ActorContext,
    gatewayId: string,
    input: {
      readonly applicationIds: readonly string[];
      readonly assigneeUserId: string | null;
    },
  ) => Promise<Result>;
  readonly note: (
    actor: ActorContext,
    gatewayId: string,
    applicationId: string,
    input: { readonly body: string; readonly clientRequestId: string },
  ) => Promise<Result>;
  readonly pass: (
    actor: ActorContext,
    gatewayId: string,
    applicationId: string,
    input: {
      readonly reasonCode: GateqPassReason;
      readonly message: string;
      readonly clientRequestId: string;
    } & Outbound,
  ) => Promise<Answered>;
  readonly reply: (
    actor: ActorContext,
    gatewayId: string,
    applicationId: string,
    input: {
      readonly message: string;
      readonly clientRequestId: string;
    } & Outbound,
  ) => Promise<Answered>;
  /**
   * The recipient, default subject and reply address an answer to this
   * applicant would carry, for the approval card. Optional: older
   * compositions lack it (and then Q offers the screen instead).
   */
  readonly outboundPreview?:
    | ((
        actor: ActorContext,
        gatewayId: string,
        applicationId: string,
        kind: "PASS" | "REPLY",
      ) => Promise<GateqOutboundPreview | Refused>)
    | undefined;
  /** A first draft of a reply, for a person to change. Sends nothing. */
  readonly draftReply?:
    | ((
        actor: ActorContext,
        gatewayId: string,
        applicationId: string,
        purpose?: GateqReplyPurpose,
      ) => Promise<
        | {
            readonly ok: true;
            readonly purpose: GateqReplyPurpose;
            readonly message: string;
            readonly companyName: string;
          }
        | Refused
      >)
    | undefined;
  readonly setReplyPromise: (
    actor: ActorContext,
    gatewayId: string,
    input: { readonly replyWithinDays: number | null },
  ) => Promise<Result>;
  readonly triage: (
    actor: ActorContext,
    gatewayId: string,
  ) => Promise<
    | {
        readonly ok: true;
        readonly proposals: readonly {
          readonly applicationId: string;
          readonly companyName: string;
          readonly propose: string;
          readonly why: string;
          readonly suggestedReason: GateqPassReason | null;
        }[];
      }
    | Refused
  >;
  readonly draftPass: (
    actor: ActorContext,
    gatewayId: string,
    applicationId: string,
    reason?: GateqPassReason,
  ) => Promise<
    | {
        readonly ok: true;
        readonly reasonCode: GateqPassReason;
        readonly message: string;
        readonly companyName: string;
      }
    | Refused
  >;
  readonly detail: (
    actor: ActorContext,
    gatewayId: string,
    applicationId: string,
  ) => Promise<GateqInboxDetailDto | Refused>;
  /**
   * The documents the founder attached to this submission, read (or each
   * one not read, with why). Null when the composition cannot read them.
   * Optional: older compositions lack it.
   */
  readonly submittedDocuments?:
    | ((
        actor: ActorContext,
        gatewayId: string,
        applicationId: string,
      ) => Promise<readonly SubmittedDocumentRead[] | null | Refused>)
    | undefined;
  /** The actor's organisation's active gateway, for Q, which has no screen. */
  readonly ownGatewayId: (actor: ActorContext) => Promise<string | null>;
  /**
   * Q room (read_my "gateq"): the inbox as the page lists it, under the
   * service's own gateway authority. Optional: older compositions lack it.
   */
  readonly list?:
    | ((
        actor: ActorContext,
        gatewayId: string,
        view: "INBOX",
      ) => Promise<GateqInboxDto | Refused>)
    | undefined;
  /**
   * An application at that gateway by the company's name as said. One clear
   * match only: several are asked about, none is nothing done.
   */
  readonly findApplication: (
    actor: ActorContext,
    gatewayId: string,
    companyName: string,
  ) => Promise<
    | { readonly applicationId: string; readonly companyName: string }
    | { readonly ambiguous: readonly string[] }
    | null
  >;
  /** The colleague by name, among the gateway organisation's members. */
  readonly findMember: (
    actor: ActorContext,
    gatewayId: string,
    name: string,
  ) => Promise<string | null>;
};

const port = (ports: AppActionPorts) =>
  ports.gateqInbox ?? portMissing("gateqInbox");

/** GateQ's own authority decides inside the service; refusals are one 404. */
const serviceDecides = () => Promise.resolve({ ok: true as const });

const PURPOSES: readonly QTaskClass[] = [
  "ACTION_PREPARATION",
  "RELATIONSHIP_QUESTION",
];

/**
 * Reading ONE application in the investor's own inbox (a READ under GateQ's
 * own gateway authority) is also offered when the turn is classified as a
 * question about their own organisation, a company or nothing in
 * particular. Live 2026-10-15: with the selected dossier on screen, an
 * "explain this founder's business" turn was classified INVESTOR_QUESTION,
 * the tool was not offered, the on-screen prefetch skipped it, and Q said
 * the authorised dossier was unavailable. Consequential inbox actions keep
 * the narrower PURPOSES.
 */
const SUMMARY_PURPOSES: readonly QTaskClass[] = [
  ...PURPOSES,
  "INVESTOR_QUESTION",
  "COUNTERPARTY_COMPANY_QUESTION",
  "GENERAL_QUESTION",
];

const respond = (out: Result) =>
  GateqInboxChangedDtoSchema.parse(
    out.ok
      ? { changed: out.changed, deduplicated: out.deduplicated }
      : { changed: 0, deduplicated: false },
  );
const notFound = (out: Result) => !out.ok;
const answerNotFound = (out: Answered) => !out.ok && !("reason" in out);
const ANSWER_PROBLEMS = {
  RECIPIENT_CHANGED: {
    code: "RESOURCE_CONFLICT",
    detail:
      "The applicant's contact changed since you approved this. Nothing was sent; check the recipient and approve again.",
  },
  KEY_REUSED: {
    code: "IDEMPOTENCY_CONFLICT",
    detail:
      "This request was already used for different words. Nothing new was sent; approve the changed message as a new one.",
  },
  RATE_LIMITED: {
    code: "RATE_LIMITED",
    detail:
      "Too many emails to applicants in a short time. Nothing was sent; try again later.",
  },
} as const;
const answerProblem = (out: Answered) =>
  !out.ok && "reason" in out ? ANSWER_PROBLEMS[out.reason] : null;
const answerRespond = (out: Answered) =>
  GateqInboxChangedDtoSchema.parse(
    out.ok
      ? { changed: out.changed, deduplicated: out.deduplicated }
      : { changed: 0, deduplicated: false },
  );
/** Q's words for an answer that did not go. */
const answerDone = (out: Answered, sent: string, refused: string) =>
  out.ok
    ? sent
    : "reason" in out
      ? ANSWER_PROBLEMS[out.reason].detail
      : refused;

const Gateway = { gatewayId: UuidSchema };
const Application = { gatewayId: UuidSchema, applicationId: UuidSchema };

const withParams = (
  params: Record<string, string>,
  body: unknown,
  keys: readonly string[],
) => ({
  ...Object.fromEntries(keys.map((key) => [key, params[key]])),
  input: body,
});

/** Q's tool input: the company as the investor said it. */
const CompanyTool = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .describe("The applying company's name, as the person said it.");

async function resolveApplication(
  ports: AppActionPorts,
  context: AppActionContext,
  company: string,
): Promise<{ gatewayId: string; applicationId: string } | AppActionRefusal> {
  const inbox = port(ports);
  const gatewayId = await inbox.ownGatewayId(context.actor);
  if (gatewayId === null) return refusal("You don't have a GateQ gate yet.");
  const found = await inbox.findApplication(context.actor, gatewayId, company);
  if (found === null)
    return refusal(`No application from "${company}" in your GateQ inbox.`);
  if ("ambiguous" in found) {
    return refusal(
      `More than one application matches: ${found.ambiguous.join(", ")}. Which one?`,
    );
  }
  return { gatewayId, applicationId: found.applicationId };
}

const isRefusal = (value: object): value is AppActionRefusal =>
  "refused" in value;

// ---------------------------------------------------------------------------
// INSTANT: the member's own word
// ---------------------------------------------------------------------------

const Star = z
  .object({ ...Gateway, input: GateqInboxStarRequestSchema })
  .strict();
const STAR = defineAppAction<
  z.infer<typeof Star>,
  Result,
  { company: string; starred: boolean }
>({
  name: "gateq.inbox.star",
  short: "star a GateQ application",
  area: "gateway",
  classification: "INSTANT",
  does: "Stars or unstars applications in their GateQ inbox. A star is personal.",
  input: Star,
  output: z.custom<Result>(),
  authorize: serviceDecides,
  run: (ports, context, input) =>
    port(ports).star(context.actor, input.gatewayId, input.input),
  targets: () => [],
  card: () => ({ summary: "Star", preview: "" }),
  done: (out, input) =>
    out.ok
      ? input.input.starred
        ? "Starred."
        : "Unstarred."
      : "That isn't in your GateQ inbox.",
  succeeded: (out) => out.ok,
  http: {
    method: "POST",
    path: GATEQ_INBOX_STAR_PATH,
    fromRequest: (params, body) => withParams(params, body, ["gatewayId"]),
    respond,
    notFound,
  },
  tool: {
    name: "gateq_inbox_star",
    description:
      "Stars (or unstars) one application in the investor's own GateQ inbox, by the company's name.",
    input: z
      .object({
        company: CompanyTool,
        starred: z.boolean().describe("true to star, false to remove the star"),
      })
      .strict(),
    references: {},
    purposes: PURPOSES,
    eval: {
      say: ["Star Sunline Energy in my GateQ inbox.", "Unstar Kora Health."],
    },
    toCanonical: async (tool, context, ports) => {
      const found = await resolveApplication(ports, context, tool.company);
      return isRefusal(found)
        ? found
        : {
            gatewayId: found.gatewayId,
            input: {
              applicationIds: [found.applicationId],
              starred: tool.starred,
            },
          };
    },
  },
});

const Archive = z
  .object({ ...Gateway, input: GateqInboxArchiveRequestSchema })
  .strict();
const ARCHIVE = defineAppAction<
  z.infer<typeof Archive>,
  Result,
  { company: string; archived: boolean }
>({
  name: "gateq.inbox.archive",
  short: "archive a GateQ application",
  area: "gateway",
  classification: "INSTANT",
  does: "Archives applications out of their GateQ inbox, or moves them back. Nothing is sent to the founder.",
  input: Archive,
  output: z.custom<Result>(),
  authorize: serviceDecides,
  run: (ports, context, input) =>
    port(ports).archive(context.actor, input.gatewayId, input.input),
  targets: () => [],
  card: () => ({ summary: "Archive", preview: "" }),
  done: (out, input) =>
    out.ok
      ? input.input.archived
        ? "Archived."
        : "Back in your inbox."
      : "That isn't in your GateQ inbox.",
  succeeded: (out) => out.ok,
  http: {
    method: "POST",
    path: GATEQ_INBOX_ARCHIVE_PATH,
    fromRequest: (params, body) => withParams(params, body, ["gatewayId"]),
    respond,
    notFound,
  },
  tool: {
    name: "gateq_inbox_archive",
    description:
      "Archives one application out of the investor's own GateQ inbox (or restores it), by the company's name. The founder is told nothing.",
    input: z
      .object({
        company: CompanyTool,
        archived: z
          .boolean()
          .describe("true to archive, false to move back to the inbox"),
      })
      .strict(),
    references: {},
    purposes: PURPOSES,
    eval: {
      say: [
        "Archive Mosaic's application.",
        "Move Okra Finance back to my GateQ inbox.",
      ],
    },
    toCanonical: async (tool, context, ports) => {
      const found = await resolveApplication(ports, context, tool.company);
      return isRefusal(found)
        ? found
        : {
            gatewayId: found.gatewayId,
            input: {
              applicationIds: [found.applicationId],
              archived: tool.archived,
            },
          };
    },
  },
});

const Label = z
  .object({ ...Gateway, input: GateqInboxLabelRequestSchema })
  .strict();
const LABEL = defineAppAction<
  z.infer<typeof Label>,
  Result,
  { company: string; label: string; on: boolean }
>({
  name: "gateq.inbox.label",
  short: "label a GateQ application",
  area: "gateway",
  classification: "INSTANT",
  does: "Adds or removes one of the firm's labels on applications in their GateQ inbox.",
  input: Label,
  output: z.custom<Result>(),
  authorize: serviceDecides,
  run: (ports, context, input) =>
    port(ports).label(context.actor, input.gatewayId, input.input),
  targets: () => [],
  card: () => ({ summary: "Label", preview: "" }),
  done: (out, input) =>
    out.ok
      ? `${input.input.on ? "Labelled" : "Removed"} "${input.input.label}".`
      : "That isn't in your GateQ inbox.",
  succeeded: (out) => out.ok,
  http: {
    method: "POST",
    path: GATEQ_INBOX_LABEL_PATH,
    fromRequest: (params, body) => withParams(params, body, ["gatewayId"]),
    respond,
    notFound,
  },
  tool: {
    name: "gateq_inbox_label",
    description:
      'Adds (or removes) a label such as "IC next week" on one application in the investor\'s own GateQ inbox.',
    input: z
      .object({
        company: CompanyTool,
        label: z.string().trim().min(1).max(40).describe("The label's words."),
        on: z.boolean().describe("true to add, false to remove"),
      })
      .strict(),
    references: {},
    purposes: PURPOSES,
    eval: {
      say: [
        'Label Sunline Energy "IC next week".',
        "Take the Fintech label off Bazaar Box.",
      ],
    },
    toCanonical: async (tool, context, ports) => {
      const found = await resolveApplication(ports, context, tool.company);
      return isRefusal(found)
        ? found
        : {
            gatewayId: found.gatewayId,
            input: {
              applicationIds: [found.applicationId],
              label: tool.label,
              on: tool.on,
            },
          };
    },
  },
});

const Assign = z
  .object({ ...Gateway, input: GateqInboxAssignRequestSchema })
  .strict();
const ASSIGN = defineAppAction<
  z.infer<typeof Assign>,
  Result,
  { company: string; colleague?: string | undefined }
>({
  name: "gateq.inbox.assign",
  short: "assign a GateQ application",
  area: "gateway",
  classification: "INSTANT",
  does: "Assigns applications in their GateQ inbox to a colleague in their firm, or unassigns them.",
  input: Assign,
  output: z.custom<Result>(),
  authorize: serviceDecides,
  run: (ports, context, input) =>
    port(ports).assign(context.actor, input.gatewayId, input.input),
  targets: () => [],
  card: () => ({ summary: "Assign", preview: "" }),
  done: (out, input) =>
    out.ok
      ? input.input.assigneeUserId === null
        ? "Unassigned."
        : "Assigned."
      : "That couldn't be assigned.",
  succeeded: (out) => out.ok,
  http: {
    method: "POST",
    path: GATEQ_INBOX_ASSIGN_PATH,
    fromRequest: (params, body) => withParams(params, body, ["gatewayId"]),
    respond,
    notFound,
  },
  tool: {
    name: "gateq_inbox_assign",
    description:
      "Assigns one application in the investor's GateQ inbox to a colleague in their firm by name, or unassigns it when no colleague is named.",
    input: z
      .object({
        company: CompanyTool,
        colleague: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .optional()
          .describe("The colleague's name; omit to unassign."),
      })
      .strict(),
    references: {},
    purposes: PURPOSES,
    eval: { say: ["Give Kora Health to Sara.", "Unassign Tally Pay."] },
    toCanonical: async (tool, context, ports) => {
      const found = await resolveApplication(ports, context, tool.company);
      if (isRefusal(found)) return found;
      const assigneeUserId =
        tool.colleague === undefined
          ? null
          : await port(ports).findMember(
              context.actor,
              found.gatewayId,
              tool.colleague,
            );
      if (tool.colleague !== undefined && assigneeUserId === null) {
        return refusal(`No one called "${tool.colleague}" in your firm.`);
      }
      return {
        gatewayId: found.gatewayId,
        input: { applicationIds: [found.applicationId], assigneeUserId },
      };
    },
  },
});

const Note = z
  .object({ ...Application, input: GateqInboxNoteRequestSchema })
  .strict();
const NOTE = defineAppAction<
  z.infer<typeof Note>,
  Result,
  { company: string; note: string }
>({
  name: "gateq.inbox.note",
  short: "add a team note",
  area: "gateway",
  classification: "INSTANT",
  does: "Adds an internal team note to an application in their GateQ inbox. Only their firm sees it.",
  input: Note,
  output: z.custom<Result>(),
  authorize: serviceDecides,
  run: (ports, context, input) =>
    port(ports).note(
      context.actor,
      input.gatewayId,
      input.applicationId,
      input.input,
    ),
  targets: () => [],
  card: () => ({ summary: "Team note", preview: "" }),
  done: (out) =>
    out.ok ? "Noted for your team." : "That isn't in your GateQ inbox.",
  succeeded: (out) => out.ok,
  http: {
    method: "POST",
    path: GATEQ_INBOX_NOTES_PATH,
    fromRequest: (params, body) =>
      withParams(params, body, ["gatewayId", "applicationId"]),
    status: (out) => (out.ok && !out.deduplicated ? 201 : 200),
    respond,
    notFound,
    idempotencyKeyOf: (input) => input.input.clientRequestId,
  },
  tool: {
    name: "gateq_inbox_note",
    description:
      "Adds an internal team note to one application in the investor's GateQ inbox. The founder never sees it.",
    input: z
      .object({
        company: CompanyTool,
        note: z
          .string()
          .trim()
          .min(1)
          .max(2000)
          .describe("The note, in their words."),
      })
      .strict(),
    references: {},
    purposes: PURPOSES,
    eval: {
      say: [
        "Note on Sunline: sharp on unit economics.",
        "Add a team note to Kora Health that we met them at the summit.",
      ],
    },
    toCanonical: async (tool, context, ports) => {
      const found = await resolveApplication(ports, context, tool.company);
      return isRefusal(found)
        ? found
        : {
            gatewayId: found.gatewayId,
            applicationId: found.applicationId,
            input: {
              body: tool.note,
              clientRequestId: `q:${context.idempotencyKey}`
                .slice(0, 128)
                .replace(/[^A-Za-z0-9:_-]/g, "-"),
            },
          };
    },
  },
});

const Settings = z
  .object({ ...Gateway, input: GateqInboxSettingsRequestSchema })
  .strict();
const SETTINGS = defineAppAction<
  z.infer<typeof Settings>,
  Result,
  { replyWithinDays: number | null }
>({
  name: "gateq.inbox.reply_promise",
  short: "set the reply promise",
  area: "gateway",
  classification: "INSTANT",
  does: "Sets the promise their gate shows founders: we reply within N working days (or no promise).",
  input: Settings,
  output: z.custom<Result>(),
  authorize: serviceDecides,
  run: (ports, context, input) =>
    port(ports).setReplyPromise(context.actor, input.gatewayId, input.input),
  targets: () => [],
  card: () => ({ summary: "Reply promise", preview: "" }),
  done: (out, input) =>
    out.ok
      ? input.input.replyWithinDays === null
        ? "Your gate no longer promises a reply time."
        : `Your gate now promises a reply within ${input.input.replyWithinDays} working days.`
      : "Only an admin of your firm can change the gate.",
  succeeded: (out) => out.ok,
  http: {
    method: "PUT",
    path: GATEQ_INBOX_SETTINGS_PATH,
    fromRequest: (params, body) => withParams(params, body, ["gatewayId"]),
    respond,
    notFound,
  },
  tool: {
    name: "gateq_reply_promise",
    description:
      "Sets how many working days the investor's gate promises founders for a reply, or removes the promise.",
    input: z
      .object({
        replyWithinDays: z
          .number()
          .int()
          .min(1)
          .max(60)
          .nullable()
          .describe("Working days, or null for no promise."),
      })
      .strict(),
    references: {},
    purposes: PURPOSES,
    eval: {
      say: [
        "Promise founders a reply within 10 working days.",
        "Remove the reply promise from my gate.",
      ],
    },
    toCanonical: async (tool, context, ports) => {
      const gatewayId = await port(ports).ownGatewayId(context.actor);
      return gatewayId === null
        ? refusal("You don't have a GateQ gate yet.")
        : { gatewayId, input: { replyWithinDays: tool.replyWithinDays } };
    },
  },
});

// ---------------------------------------------------------------------------
// CONSEQUENTIAL: words to a founder, approved exactly
// ---------------------------------------------------------------------------

const Pass = z
  .object({ ...Application, input: GateqInboxPassRequestSchema })
  .strict();
const PASS = defineAppAction<
  z.infer<typeof Pass>,
  Answered,
  { company: string; reason: GateqPassReason; message?: string | undefined }
>({
  name: "gateq.inbox.pass",
  short: "pass on a GateQ application",
  area: "gateway",
  classification: "CONSEQUENTIAL",
  does: "Passes on an application in their GateQ inbox, sending the founder the approved message with a reason.",
  input: Pass,
  output: z.custom<Answered>(),
  authorize: serviceDecides,
  run: (ports, context, input) =>
    port(ports).pass(
      context.actor,
      input.gatewayId,
      input.applicationId,
      input.input,
    ),
  targets: () => [],
  card: (input) => ({
    summary: "Pass, and send the founder this message",
    preview: outboundPreviewText(input.input),
  }),
  done: (out) =>
    answerDone(
      out,
      "Passed, and the founder has your message.",
      "Only an admin of your firm can pass.",
    ),
  succeeded: (out) => out.ok,
  http: {
    method: "POST",
    path: GATEQ_INBOX_PASS_PATH,
    fromRequest: (params, body) =>
      withParams(params, body, ["gatewayId", "applicationId"]),
    status: (out) => (out.ok && !out.deduplicated ? 201 : 200),
    respond: answerRespond,
    problem: answerProblem,
    notFound: answerNotFound,
    idempotencyKeyOf: (input) => input.input.clientRequestId,
  },
  // Words to a founder are approved on the inbox screen, exactly as
  // shown; Q drafts (gateq_inbox_draft_pass, gateq_inbox_summarise) and
  // offers the screen.
  qCapability: "offer.gateq_inbox",
});

const Reply = z
  .object({
    ...Application,
    input: GateqInboxReplyRequestSchema,
    /**
     * Q's card only: the proposing person's own organisation, the gateway's
     * owner, which the approval names as its subject. Set from the actor,
     * never from a model or a request body; the service ignores it.
     */
    organisationId: UuidSchema.optional(),
  })
  .strict();
const REPLY = defineAppAction<
  z.infer<typeof Reply>,
  Answered,
  { company: string; message: string; subject?: string | undefined }
>({
  name: "gateq.inbox.reply",
  short: "reply to a GateQ founder",
  area: "gateway",
  classification: "CONSEQUENTIAL",
  does: "Emails the founder of an application in their GateQ inbox the approved reply: the exact recipient, subject and words on the card. They need not be on Capital Q.",
  input: Reply,
  output: z.custom<Answered>(),
  authorize: serviceDecides,
  run: (ports, context, input) =>
    port(ports).reply(
      context.actor,
      input.gatewayId,
      input.applicationId,
      input.input,
    ),
  // The Approval Engine binds a proposal to its subject: the firm's own
  // organisation, whose gateway it is.
  targets: (input) =>
    input.organisationId === undefined
      ? []
      : [{ kind: "ORGANISATION", organisationId: input.organisationId }],
  // Who gets it, under what subject, and the words: the card is what they
  // approve, and a changed word is a new card (the payload is the approval).
  card: (input) => ({
    summary: "Email the founder this reply",
    preview: outboundPreviewText(input.input),
  }),
  proposed: (input, summary) =>
    readyToSendLine(
      summary,
      `${input.input.subject === undefined ? "" : `Subject: ${input.input.subject}\n\n`}${input.input.message}`,
    ),
  done: (out) =>
    answerDone(out, "Sent.", "Only an admin of your firm can reply."),
  succeeded: (out) => out.ok,
  http: {
    method: "POST",
    path: GATEQ_INBOX_REPLY_PATH,
    fromRequest: (params, body) =>
      withParams(params, body, ["gatewayId", "applicationId"]),
    status: (out) => (out.ok && !out.deduplicated ? 201 : 200),
    respond: answerRespond,
    problem: answerProblem,
    notFound: answerNotFound,
    idempotencyKeyOf: (input) => input.input.clientRequestId,
  },
  tool: {
    name: "gateq_inbox_reply",
    description:
      "Prepares an email to the founder of one application in the investor's own GateQ inbox (they may not be on Capital Q), for the investor to approve on a card: the recipient is the application's contact, the subject and words are exactly what they approve. Write the message in the investor's voice; gateq_inbox_draft_reply gives a first draft. Nothing is sent until they approve.",
    input: z
      .object({
        company: CompanyTool,
        message: z
          .string()
          .trim()
          .min(1)
          .max(2000)
          .describe("The email's words, exactly as it should be sent."),
        subject: GateqOutboundSubjectSchema.optional().describe(
          "A subject line, if the investor asked for one; otherwise the usual one is used.",
        ),
      })
      .strict(),
    references: {},
    purposes: PURPOSES,
    eval: {
      say: [
        "Email Sunline and ask for a call next week.",
        "Reply to Kora Health: thanks, we'll come back to them on Friday.",
      ],
    },
    toCanonical: async (tool, context, ports) => {
      const found = await resolveApplication(ports, context, tool.company);
      if (isRefusal(found)) return found;
      const inbox = port(ports);
      if (inbox.outboundPreview === undefined) {
        return refusal(
          "Open the application in your GateQ inbox to reply; I can draft the words.",
        );
      }
      const preview = await inbox.outboundPreview(
        context.actor,
        found.gatewayId,
        found.applicationId,
        "REPLY",
      );
      if (!preview.ok) return refusal("Only an admin of your firm can reply.");
      if (preview.to === null) {
        return refusal(
          `${preview.companyName}'s application has no contact email, so there's no one to email.`,
        );
      }
      if (!preview.deliverable) {
        return refusal(
          "Email to applicants isn't connected here, so nothing can be sent yet.",
        );
      }
      const organisationId = context.actor.organisationId;
      if (organisationId === undefined || organisationId === null) {
        return refusal("Only an admin of your firm can reply.");
      }
      return {
        gatewayId: found.gatewayId,
        applicationId: found.applicationId,
        organisationId,
        input: {
          message: tool.message,
          clientRequestId: `q:${context.idempotencyKey}`
            .slice(0, 128)
            .replace(/[^A-Za-z0-9:_-]/g, "-"),
          // The card binds who gets it and the subject, as well as the words.
          to: preview.to,
          subject: tool.subject ?? preview.subject,
        },
      };
    },
  },
});

/** The card's text: recipient and subject when bound, then the words. */
function outboundPreviewText(input: {
  readonly message: string;
  readonly to?: string | undefined;
  readonly subject?: string | undefined;
}): string {
  const head = [
    input.to === undefined ? null : `To: ${input.to}`,
    input.subject === undefined ? null : `Subject: ${input.subject}`,
  ].filter((line) => line !== null);
  return head.length === 0
    ? input.message
    : `${head.join("\n")}\n\n${input.message}`;
}

// ---------------------------------------------------------------------------
// READ: Q's triage and drafts. Proposals, never decisions.
// ---------------------------------------------------------------------------

type TriageOut = Awaited<ReturnType<GateqInboxPort["triage"]>>;
const TriageIn = z.object({ gatewayId: UuidSchema }).strict();
const TRIAGE = defineAppAction<
  z.infer<typeof TriageIn>,
  TriageOut,
  Record<string, never>
>({
  name: "gateq.inbox.triage",
  short: "triage the GateQ inbox",
  area: "gateway",
  classification: "READ",
  does: "Reads their GateQ inbox and proposes what to look at first, what to ask for, and which to prepare a pass for. Proposals only; Q never passes on anyone's behalf.",
  input: TriageIn,
  output: z.custom<TriageOut>(),
  authorize: serviceDecides,
  run: (ports, context, input) =>
    port(ports).triage(context.actor, input.gatewayId),
  targets: () => [],
  card: () => ({ summary: "Triage", preview: "" }),
  done: (out) =>
    out.ok
      ? out.proposals.length === 0
        ? "Your GateQ inbox is clear."
        : out.proposals
            .map(
              (p) =>
                `${p.companyName}: ${p.propose === "PREPARE_PASS" ? "prepare a pass" : p.propose === "ASK_FOR_MORE" ? "ask for more" : "look at first"} (${p.why})`,
            )
            .join("\n")
      : "You don't have a GateQ inbox.",
  tool: {
    name: "gateq_inbox_triage",
    description:
      'Reads the investor\'s own GateQ inbox and proposes, for each open application, whether to look at it first, ask the founder for more, or prepare a pass (from their gate\'s rules and reply promise). Use for "triage my GateQ inbox" or "what came through my gate?".',
    input: z.object({}).strict(),
    references: {},
    purposes: PURPOSES,
    eval: {
      say: ["Triage my GateQ inbox.", "What came through my gate this week?"],
    },
    toCanonical: async (_tool, context, ports) => {
      const gatewayId = await port(ports).ownGatewayId(context.actor);
      return gatewayId === null
        ? refusal("You don't have a GateQ gate yet.")
        : { gatewayId };
    },
  },
});

type DraftOut = Awaited<ReturnType<GateqInboxPort["draftPass"]>>;
const DraftIn = z
  .object({
    gatewayId: UuidSchema,
    applicationId: UuidSchema,
    reason: GateqPassReasonSchema.optional(),
  })
  .strict();
const DRAFT_PASS = defineAppAction<
  z.infer<typeof DraftIn>,
  DraftOut,
  { company: string; reason?: GateqPassReason | undefined }
>({
  name: "gateq.inbox.draft_pass",
  short: "draft a GateQ pass",
  area: "gateway",
  classification: "READ",
  does: "Drafts a respectful, specific pass for one application, with a reason from their gate's rules. A draft only: nothing is sent.",
  input: DraftIn,
  output: z.custom<DraftOut>(),
  authorize: serviceDecides,
  run: (ports, context, input) =>
    port(ports).draftPass(
      context.actor,
      input.gatewayId,
      input.applicationId,
      input.reason,
    ),
  targets: () => [],
  card: () => ({ summary: "Draft", preview: "" }),
  done: (out) =>
    out.ok
      ? `Draft (${out.reasonCode.toLowerCase().replace(/_/g, " ")}):\n${out.message}`
      : "That isn't in your GateQ inbox.",
  tool: {
    name: "gateq_inbox_draft_pass",
    description:
      "Drafts a pass message for one application in the investor's GateQ inbox, for them to read and change. Sends nothing.",
    input: z
      .object({
        company: CompanyTool,
        reason: GateqPassReasonSchema.optional(),
      })
      .strict(),
    references: {},
    purposes: PURPOSES,
    eval: {
      say: [
        "Draft a pass for Mosaic.",
        "How would we say no to Harvest Ledger?",
      ],
    },
    toCanonical: async (tool, context, ports) => {
      const found = await resolveApplication(ports, context, tool.company);
      return isRefusal(found)
        ? found
        : {
            gatewayId: found.gatewayId,
            applicationId: found.applicationId,
            ...(tool.reason === undefined ? {} : { reason: tool.reason }),
          };
    },
  },
});

type DraftReplyOut =
  | {
      readonly ok: true;
      readonly purpose: GateqReplyPurpose;
      readonly message: string;
      readonly companyName: string;
    }
  | Refused;
const ReplyPurposeSchema = z.enum(["CALL", "ASK", "THANKS"]);
const DraftReplyIn = z
  .object({
    gatewayId: UuidSchema,
    applicationId: UuidSchema,
    purpose: ReplyPurposeSchema.optional(),
  })
  .strict();
const DRAFT_REPLY = defineAppAction<
  z.infer<typeof DraftReplyIn>,
  DraftReplyOut,
  { company: string; purpose?: GateqReplyPurpose | undefined }
>({
  name: "gateq.inbox.draft_reply",
  short: "draft a GateQ reply",
  area: "gateway",
  classification: "READ",
  does: "Drafts a reply to the founder of one application (ask for a call, ask for more, or a thank-you). A draft only: nothing is sent.",
  input: DraftReplyIn,
  output: z.custom<DraftReplyOut>(),
  authorize: serviceDecides,
  run: (ports, context, input) => {
    const inbox = port(ports);
    return inbox.draftReply === undefined
      ? Promise.resolve({ ok: false as const })
      : inbox.draftReply(
          context.actor,
          input.gatewayId,
          input.applicationId,
          input.purpose,
        );
  },
  targets: () => [],
  card: () => ({ summary: "Draft", preview: "" }),
  done: (out) =>
    out.ok
      ? `Draft reply to ${out.companyName}:\n${out.message}`
      : "That isn't in your GateQ inbox.",
  tool: {
    name: "gateq_inbox_draft_reply",
    description:
      "Drafts a reply to the founder of one application in the investor's GateQ inbox: CALL asks for times for a call, ASK asks for what the application left open, THANKS acknowledges it. For them to read and change; sends nothing. To send, prepare it with gateq_inbox_reply.",
    input: z
      .object({
        company: CompanyTool,
        purpose: ReplyPurposeSchema.optional(),
      })
      .strict(),
    references: {},
    purposes: PURPOSES,
    eval: {
      say: [
        "Draft a reply to Sunline asking for a call.",
        "How would we ask Harvest Ledger for more information?",
      ],
    },
    toCanonical: async (tool, context, ports) => {
      const found = await resolveApplication(ports, context, tool.company);
      return isRefusal(found)
        ? found
        : {
            gatewayId: found.gatewayId,
            applicationId: found.applicationId,
            ...(tool.purpose === undefined ? {} : { purpose: tool.purpose }),
          };
    },
  },
});

type SummaryOut =
  | (GateqInboxDetailDto & {
      readonly documentsRead?: readonly SubmittedDocumentRead[] | null;
    })
  | Refused;
const SummaryIn = z
  .object({ gatewayId: UuidSchema, applicationId: UuidSchema })
  .strict();
const STAND_WORDS = {
  MEETS: "meets",
  DOES_NOT_MEET: "doesn't meet",
  NOT_ANSWERED: "needs clarification",
  // Decision 91: the founder's own answers disagree; never "not answered".
  UNRESOLVED: "needs your judgement: the founder's answers disagree",
} as const;
const SUMMARISE = defineAppAction<
  z.infer<typeof SummaryIn>,
  SummaryOut,
  { company?: string | undefined; applicationId?: string | undefined }
>({
  name: "gateq.inbox.summarise",
  short: "summarise a GateQ application",
  area: "gateway",
  classification: "READ",
  does: "Reads one application in their GateQ inbox: the founder's answers, how it stands against each of their gate's rules, what was shared and their team's notes.",
  input: SummaryIn,
  output: z.custom<SummaryOut>(),
  authorize: serviceDecides,
  run: async (ports, context, input) => {
    const inbox = port(ports);
    const detail = await inbox.detail(
      context.actor,
      input.gatewayId,
      input.applicationId,
    );
    if (!("item" in detail) || inbox.submittedDocuments === undefined)
      return detail;
    const read = await inbox
      .submittedDocuments(context.actor, input.gatewayId, input.applicationId)
      .catch(() => null);
    return {
      ...detail,
      documentsRead: read === null || !Array.isArray(read) ? null : read,
    };
  },
  targets: () => [],
  card: () => ({ summary: "Summary", preview: "" }),
  succeeded: (out) => "item" in out,
  done: (out) =>
    "item" in out
      ? `${out.item.companyName}${out.item.oneLiner === null ? "" : `: ${out.item.oneLiner.length > 150 ? `${out.item.oneLiner.slice(0, 149)}…` : out.item.oneLiner}`}. Mandate: ${{ FITS: "meets the published mandate", PARTIAL: "more information needed", NOT_A_FIT: "outside the published mandate" }[out.item.fit]}. Applicant claims are not independently verified; mandate fit is not an investment decision.`
      : "That isn’t in your GateQ inbox.",
  reading: (out, input) => {
    if (!("item" in out) || out.item.applicationId !== input.applicationId)
      return undefined;
    if (
      out.dossier &&
      (out.dossier.application.reference !== out.item.reference ||
        out.dossier.application.submittedAt !== out.item.submittedAt)
    )
      return undefined;
    const text = [
      `${out.item.companyName}${out.item.oneLiner === null ? "" : `: ${out.item.oneLiner}`}`,
      submittedReading(out.dossier),
      out.dossier
        ? "Form and interview findings are included above; no duplicate or live company profile is substituted."
        : `Their answers (their own claims, not verified): ${out.answers.map((a) => `${a.label} ${a.value}`).join("; ") || "none"}.`,
      `Your gate's rules: ${out.rules.map((r) => `${r.label} ${STAND_WORDS[r.standing]}`).join("; ") || "none published"}.`,
      out.note === null ? "No note." : `Their note: "${out.note}"`,
      `Shared: ${out.shared.map((d) => d.title).join(", ") || "nothing beyond the form"}.`,
      APPLICATION_ONLY,
      documentsReading(out.shared, out.documentsRead),
      out.notes.length === 0
        ? "No team notes."
        : `Team notes: ${out.notes.map((n) => `${n.author.name}: ${n.body}`).join(" | ")}`,
      out.messages.length === 0
        ? "Not answered yet."
        : `Already ${out.messages.some((m) => m.kind === "PASS") ? "passed" : "replied"}.`,
    ].join("\n");
    return {
      v: 1,
      subject: {
        kind: "GATEQ_SUBMISSION",
        gatewayId: input.gatewayId,
        applicationId: out.item.applicationId,
        reference: out.item.reference,
        submittedAt: out.item.submittedAt,
        dossierSchemaVersion: out.dossier?.schemaVersion ?? null,
      },
      text,
      // Each cited fact with its own source (slice 3): the form, the
      // interview, a document, or the company profile, never assumed.
      sources: (out.dossier ? gateqReadingSources(out.dossier) : []).filter(
        (source) => text.includes(source.factId),
      ),
    };
  },
  tool: {
    name: "gateq_inbox_summarise",
    description:
      "Reads one application in the investor's own GateQ inbox, by exact application id or the company's name: the founder's answers (their claims, not verified), each gate rule's standing, what was shared, and the firm's team notes. Use to summarise a submission or before drafting a reply in their style; a reply or a pass is then sent from the inbox screen, where they approve the exact words.",
    input: z
      .object({
        company: CompanyTool.optional(),
        applicationId: UuidSchema.optional(),
      })
      .strict()
      .refine(
        (value) =>
          (value.company !== undefined) !== (value.applicationId !== undefined),
        "Provide a company name or an exact application id, not both.",
      ),
    references: {},
    purposes: SUMMARY_PURPOSES,
    eval: {
      say: [
        "Summarise Sunline Energy's application.",
        "Draft a reply to Kora Health asking for a call.",
      ],
    },
    toCanonical: async (tool, context, ports) => {
      if (tool.applicationId !== undefined) {
        const gatewayId = await port(ports).ownGatewayId(context.actor);
        return gatewayId === null
          ? refusal("That isn’t in your GateQ inbox.")
          : { gatewayId, applicationId: tool.applicationId };
      }
      if (tool.company === undefined)
        return refusal("Which application do you mean?");
      const found = await resolveApplication(ports, context, tool.company);
      return isRefusal(found)
        ? found
        : { gatewayId: found.gatewayId, applicationId: found.applicationId };
    },
  },
});

export const GATEQ_INBOX_ACTIONS: readonly AnyAppAction[] = [
  STAR,
  ARCHIVE,
  LABEL,
  ASSIGN,
  NOTE,
  SETTINGS,
  PASS,
  REPLY,
  TRIAGE,
  DRAFT_PASS,
  DRAFT_REPLY,
  SUMMARISE,
];

/**
 * read_my("gateq") (Q room): the applications in the investor's GateQ
 * inbox, as the inbox lists them, through the inbox service's own gateway
 * authority. Applicant claims stay claims. Null where there is no inbox
 * (a founder, or a composition without the read).
 */
export async function gateqItems(
  ports: AppActionPorts,
  actor: ActorContext,
): Promise<readonly OwnReadItem[] | null> {
  const inbox = ports.gateqInbox;
  if (inbox?.list === undefined) return null;
  const gatewayId = await inbox.ownGatewayId(actor).catch(() => null);
  if (gatewayId === null) return null;
  const listed = await inbox.list(actor, gatewayId, "INBOX").catch(() => null);
  if (listed === null || "ok" in listed) return null;
  return listed.items.slice(0, 50).map((item) => ({
    id: item.applicationId,
    title: item.companyName,
    status: [
      item.folder === "INBOX"
        ? item.unread
          ? "unread"
          : "read"
        : item.folder.toLowerCase(),
      item.replyState.toLowerCase().replace(/_/g, " "),
    ].join("; "),
    at: item.submittedAt,
    facts: {
      oneLiner: item.oneLiner,
      stage: item.stage,
      sector: item.sector,
      country: item.country,
      fit: item.fit,
      rulesMet: `${String(item.rules.met)} of ${String(item.rules.total)}`,
      starred: item.starred,
      daysLeftToReply: item.daysLeft,
    },
  }));
}
