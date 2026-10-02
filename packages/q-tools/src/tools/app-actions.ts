import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import {
  APP_ACTIONS,
  OwnReadItemSchema,
  OwnReadKindSchema,
  readOwn,
  resolveReference,
  type AnyAppAction,
  type AppActionContext,
  type OwnReadPorts,
  type ReferenceCandidates,
  type ReferenceKind,
} from "@capital-q/app-actions";
import {
  CorrelationIdSchema,
  Q_TASK_CLASSES,
  type CorrelationId,
  type PermittedContextPlan,
} from "@capital-q/contracts";
import { CompanyIdSchema } from "@capital-q/companies";
import type { ActorContext } from "@capital-q/security";

import {
  allow,
  defineQTool,
  deny,
  type AnyQToolDefinition,
} from "../definition.js";
import { actorWideScope } from "../plan.js";
import type { QToolPorts } from "../ports.js";
import { nameableRecords } from "./client-actions.js";
import { actionTarget } from "./relationships.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Q tools generated from the app's action registry (ADR 0040, Proposed).
 *
 * One tool per declared action, with the action's own authorize step and
 * service call, in-process as the actor: no HTTP from the model, no second
 * implementation to drift. READ and INSTANT run at once (the person's own
 * word); CONSEQUENTIAL is prepared for the Approval Engine, where the
 * approved payload runs through the same declaration (q-api). Names in
 * reference fields are resolved by the one shared coercion.
 */

/** Hands a CONSEQUENTIAL action to this run's approval board. */
export type AppApprovalPort = {
  readonly prepareForApproval: (entry: {
    readonly runId: string;
    readonly tenantId: string;
    readonly actorUserId: string;
    readonly actionType: string;
    readonly payload: unknown;
  }) => "PREPARED" | "ONE_PER_TURN";
};

export const AppToolOutputSchema = z
  .object({
    status: z.enum(["DONE", "PREPARED", "ONE_PER_TURN", "NOT_DONE"]),
    /** What to tell the person, from the action's own words. */
    says: z.string().max(600),
  })
  .strict();
export type AppToolOutput = z.infer<typeof AppToolOutputSchema>;

type Grant = {
  readonly canonical: unknown;
  readonly names: Readonly<Record<string, string>>;
  readonly context: AppActionContext;
};

function ownConversation(
  actor: ActorContext,
  plan: PermittedContextPlan,
): boolean {
  if (actor.actorType !== "HUMAN") return false;
  const scope = actorWideScope(plan, "OWN_Q_CONVERSATION");
  return scope !== undefined && scope.filter.userId === actor.userId;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
    .join(",")}}`;
}

function correlationOf(value: string): CorrelationId {
  const parsed = CorrelationIdSchema.safeParse(value);
  return parsed.success
    ? parsed.data
    : CorrelationIdSchema.parse(`cor_${randomUUID()}`);
}

/** The fields a value did not fit, in plain words (never the value itself). */
function misfit(error: z.ZodError): string {
  return error.issues
    .slice(0, 4)
    .map((issue) => {
      const field = issue.path
        .filter((part): part is string => typeof part === "string")
        .filter((part) => part !== "input")
        .join(".");
      return field.length === 0 ? issue.message : `${field} ${issue.message}`;
    })
    .join("; ");
}

/** Same run, same action, same words: the same key, so a retry does nothing twice. */
export function appActionKey(
  runId: string,
  name: string,
  input: unknown,
): string {
  return `q-${createHash("sha1")
    .update(`${runId}|${name}|${stableJson(input)}`)
    .digest("hex")}`;
}

/** The records of each kind a person can see, for matching a said name. */
export function referenceCandidates(
  ports: QToolPorts,
  own: OwnReadPorts,
): ReferenceCandidates {
  return async (kind: ReferenceKind, actor, said) => {
    switch (kind) {
      case "COMPANY":
        return nameableRecords(ports, actor, "COMPANY", said);
      case "RELATIONSHIP": {
        const mine = await ports.relationships
          ?.ownRelationships?.(actor)
          .catch(() => null);
        return (mine?.items ?? []).map((item) => ({
          id: item.relationshipId,
          name: item.counterpart.name,
        }));
      }
      case "MEDIA":
      case "DOCUMENT":
      case "REHEARSAL": {
        const items = await readOwn(
          own,
          actor,
          kind === "MEDIA"
            ? "media"
            : kind === "DOCUMENT"
              ? "documents"
              : "rehearsals",
        ).catch(() => null);
        return (items ?? []).map((item) => ({ id: item.id, name: item.title }));
      }
    }
  };
}

function toolFor(
  action: AnyAppAction,
  own: OwnReadPorts,
  candidates: ReferenceCandidates,
  approvals: AppApprovalPort | undefined,
  companyName: (companyId: string) => Promise<string>,
): AnyQToolDefinition | null {
  const declared = action.tool;
  if (declared === undefined) return null;
  if (action.classification === "CONSEQUENTIAL" && approvals === undefined) {
    return null;
  }
  return defineQTool<unknown, AppToolOutput, Grant>({
    id: `app.${action.name}`,
    version: 1,
    status: "ACTIVE",
    providerName: declared.name,
    description: declared.description,
    classification:
      action.classification === "READ" ? "READ_ONLY" : "SIDE_EFFECT",
    riskClass:
      action.classification === "READ" ? "SAFE_READ" : "LOW_RISK_INTERNAL",
    requiredCapabilities: [],
    supportedPurposes: [...(declared.purposes ?? Q_TASK_CLASSES)],
    // Offered where it can apply (a founder's conversation, not an
    // investor organisation's tool); authorize still requires their own.
    requiredScopeKinds: [...(declared.scopes ?? ["OWN_Q_CONVERSATION"])],
    approval: "NONE",
    idempotency: "SAFE_TO_REPEAT",
    owner: "app-actions",
    visibleStage:
      action.classification === "CONSEQUENTIAL" ? "WAITING_FOR_APPROVAL" : null,
    input: declared.input,
    output: AppToolOutputSchema,
    authorize: async (input, execution) => {
      const { actor, plan } = execution;
      if (!ownConversation(actor, plan)) return deny("NOT_AVAILABLE");
      // Names to ids, by the one coercion; anything unclear is not acted on.
      const resolved: Record<string, unknown> = {
        ...(input as Record<string, unknown>),
      };
      const names: Record<string, string> = {};
      const references: Readonly<Record<string, ReferenceKind | undefined>> =
        declared.references;
      for (const [field, kind] of Object.entries(references)) {
        const said = resolved[field];
        if (typeof said !== "string" || kind === undefined) continue;
        // An id from the model is taken only when this run's plan targets
        // it or it is one of their own records of that kind: the model
        // can name, never widen (Context Firewall).
        if (UUID.test(said.trim())) {
          const id = said.trim().toLowerCase();
          // A company by id only when this turn is about it (on screen or
          // asked about, R35); anything else by name. Their own records
          // (a pitch, a document) by id when they are theirs.
          const record =
            kind === "COMPANY"
              ? undefined
              : (await candidates(kind, actor, id).catch(() => [])).find(
                  (candidate) => candidate.id === id,
                );
          if (
            kind === "COMPANY" ? !actionTarget(plan, id) : record === undefined
          ) {
            return deny("NOT_AVAILABLE");
          }
          resolved[field] = id;
          names[field] =
            record?.name ?? (kind === "COMPANY" ? await companyName(id) : "it");
          continue;
        }
        const found = await resolveReference(candidates, kind, actor, said);
        if (found.kind === "SEVERAL") {
          return deny(
            "NOT_AVAILABLE",
            `More than one matches "${said}": ${found.names.slice(0, 5).join(", ")}. Ask which one.`,
          );
        }
        if (found.kind === "NONE") {
          return deny("NOT_AVAILABLE", `Nothing of theirs matches "${said}".`);
        }
        resolved[field] = found.id;
        names[field] =
          (await candidates(kind, actor, said).catch(() => [])).find(
            (candidate) => candidate.id === found.id,
          )?.name ?? said;
      }
      const context: AppActionContext = {
        actor,
        idempotencyKey: appActionKey(execution.runId, action.name, resolved),
        // The run's own correlation id; a malformed one gets a fresh id
        // rather than failing the person's action.
        correlationId: correlationOf(execution.correlationId),
        surface: "Q",
      };
      const canonical = await declared
        .toCanonical(resolved, context, own)
        .catch(() => null);
      if (canonical === null) return deny("NOT_AVAILABLE");
      const parsed = action.input.safeParse(canonical);
      if (!parsed.success) {
        // The declaration's own contract refused a value: say which, so Q
        // can ask for a value that fits instead of going quiet.
        return deny(
          "NOT_AVAILABLE",
          `That doesn't fit: ${misfit(parsed.error)}.`,
        );
      }
      const refused = await declared
        .refuse?.(parsed.data, own)
        .catch(() => null);
      if (refused !== undefined && refused !== null) {
        return deny("NOT_AVAILABLE", refused);
      }
      const verdict = await action
        .authorize(own, context, parsed.data)
        .catch(() => ({ ok: false as const, reason: "" }));
      if (!verdict.ok) {
        return verdict.reason.length > 0
          ? deny("NOT_AVAILABLE", verdict.reason)
          : deny("NOT_AVAILABLE");
      }
      return allow("CONFIDENTIAL", { canonical: parsed.data, names, context });
    },
    execute: async (_input, execution, grant) => {
      if (
        action.classification === "CONSEQUENTIAL" &&
        approvals !== undefined
      ) {
        const status = approvals.prepareForApproval({
          runId: execution.runId,
          tenantId: execution.actor.tenantId,
          actorUserId: execution.actor.userId,
          actionType: `app.${action.name}`,
          payload: grant.canonical,
        });
        return {
          status,
          says:
            status === "PREPARED"
              ? `${action.card(grant.canonical).summary}: it's on the card for your approval; nothing changes until you approve it.`
              : "Another change is already waiting for your approval in this answer; approve or decline it first.",
        };
      }
      const out = await action.run(own, grant.context, grant.canonical);
      return {
        status: (action.succeeded?.(out) ?? true) ? "DONE" : "NOT_DONE",
        says: action.done(out, grant.canonical, grant.names),
      };
    },
  });
}

export const READ_MY = "app.own.read" as const;

export const ReadMyInputSchema = z
  .object({
    kind: OwnReadKindSchema.describe(
      "media (their pitch videos), documents (what Q made for them), rehearsals (their rehearsals with investors Q played), feed (the companies in their Discover feed now, for an investor).",
    ),
    text: z
      .string()
      .trim()
      .max(120)
      .optional()
      .describe("Only records whose title contains this, when they named one."),
  })
  .strict();

export const ReadMyOutputSchema = z
  .object({
    kind: OwnReadKindSchema,
    available: z.boolean(),
    items: z.array(OwnReadItemSchema).max(30),
  })
  .strict();

/**
 * read_my (ADR 0040 §2): their own records of one kind, as the page shows
 * them, through the page's own service and authorization.
 */
export function createReadMyTool(own: OwnReadPorts): AnyQToolDefinition {
  return defineQTool<
    z.infer<typeof ReadMyInputSchema>,
    z.infer<typeof ReadMyOutputSchema>,
    ActorContext
  >({
    id: READ_MY,
    version: 1,
    status: "ACTIVE",
    providerName: "read_my",
    description:
      "Reads the person's own records of one kind exactly as their page shows them: their pitch videos (title, who can watch, whether investors can play it), their documents, their rehearsals, or the companies in their Discover feed now. Use it before saying they have none, or that a company is not in their feed.",
    classification: "READ_ONLY",
    riskClass: "SAFE_READ",
    requiredCapabilities: [],
    supportedPurposes: [...Q_TASK_CLASSES],
    core: true,
    requiredScopeKinds: ["OWN_Q_CONVERSATION"],
    approval: "NONE",
    idempotency: "SAFE_TO_REPEAT",
    owner: "app-actions",
    visibleStage: null,
    input: ReadMyInputSchema,
    output: ReadMyOutputSchema,
    authorize: (_input, { actor, plan }) =>
      Promise.resolve(
        ownConversation(actor, plan)
          ? allow<ActorContext>("CONFIDENTIAL", actor)
          : deny<ActorContext>("NOT_AVAILABLE"),
      ),
    execute: async (input, _context, actor) => {
      const items = await readOwn(own, actor, input.kind);
      const wanted = input.text?.toLowerCase();
      return {
        kind: input.kind,
        available: items !== null,
        items: (items ?? [])
          .filter(
            (item) =>
              wanted === undefined || item.title.toLowerCase().includes(wanted),
          )
          .slice(0, 30)
          .map((item) => ({ ...item })),
      };
    },
  });
}

/** Every registry action as a Q tool, plus read_my, when the ports are composed. */
export function createAppActionTools(
  ports: QToolPorts,
  actions: readonly AnyAppAction[] = APP_ACTIONS,
): readonly AnyQToolDefinition[] {
  const own = ports.appActions;
  if (own === undefined) return [];
  const candidates = referenceCandidates(ports, own);
  // The display name of a company the plan targets, for Q's sentence only.
  const companyName = async (companyId: string): Promise<string> => {
    const parsed = CompanyIdSchema.safeParse(companyId);
    if (!parsed.success) return "the company";
    const profile = await ports.companies
      .findCanonicalCompanyProfile(parsed.data)
      .catch(() => null);
    return profile?.canonicalName ?? "the company";
  };
  return [
    createReadMyTool(own),
    ...actions.flatMap((action) => {
      const tool = toolFor(
        action,
        own,
        candidates,
        ports.appApprovals,
        companyName,
      );
      return tool === null ? [] : [tool];
    }),
  ];
}
