import { z } from "zod";

import type {
  CorrelationId,
  KnownErrorCode,
  QKnowledgeScopeKind,
  QSubjectRef,
  QTaskClass,
} from "@capital-q/contracts";
import type { OnboardingActor } from "@capital-q/onboarding";
import type { ActorContext } from "@capital-q/security";

import type { AppActionPorts } from "./ports.js";
import type { ReferenceKind } from "./references.js";

/**
 * ADR 0040 (Proposed): one declaration per user-initiated action.
 *
 * The declaration is the action: its canonical input, the authorize step
 * the screen's route already applied, the service call, how Q may take it
 * (READ / INSTANT / CONSEQUENTIAL, which needs the person's approval), and
 * the words on the approval card. The HTTP route (apps/api) and the Q tool
 * (q-tools) are generated from it, so neither can drift from the other:
 * whatever the screen does, Q does the same way, as the same person.
 *
 * Q never calls HTTP: its tool runs in-process through the same service,
 * typed and authorised (CLAUDE.md tool rules). Fields typed as references
 * accept a name as the person said it; one shared coercion resolves it.
 */

export type AppActionClass = "READ" | "INSTANT" | "CONSEQUENTIAL";

/** Who is acting and under which key. A route and a tool both build one. */
export type AppActionContext = {
  readonly actor: ActorContext;
  /** Idempotency: the client's event id on a screen, derived from the run for Q. */
  readonly idempotencyKey: string;
  readonly correlationId: CorrelationId;
  readonly surface: "SCREEN" | "Q";
  /**
   * Recovery D-07: what Q sent is marked as Q's. Set only by trusted
   * server code when Q acts: the approved card's action id, or the
   * delegation (or standing instruction) Q acted under. A message carrying
   * either shows the other side it was sent by Q (viaQ).
   */
  readonly qActionId?: string | undefined;
  readonly qDelegationId?: string | undefined;
};

export type AppActionVerdict =
  | { readonly ok: true }
  | {
      readonly ok: false;
      /** Plain words for Q; a route answers the one 404 for every refusal. */
      readonly reason: string;
    };

/** A success status a route answers; 202 when work was started, 204 with no body. */
export type AppActionStatus = 200 | 201 | 202 | 204;

export type AppActionHttp<In, Out> = {
  readonly method: "POST" | "PUT" | "PATCH" | "DELETE";
  /** The route's own path, with :params. Never a catch-all. */
  readonly path: string;
  /**
   * The canonical input from the URL params, the body and the headers
   * (all still unknown; a header such as Idempotency-Key is input too).
   */
  readonly fromRequest: (
    params: Record<string, string>,
    body: unknown,
    headers: Readonly<Record<string, string | string[] | undefined>>,
  ) => unknown;
  /** The success status the route always answered with (default 200). */
  readonly status?:
    AppActionStatus | ((out: Out) => AppActionStatus) | undefined;
  /** The Location of what it created, for a 201. */
  readonly location?: ((out: Out, input: In) => string) | undefined;
  /** The wire answer, in the route's existing response contract. */
  readonly respond: (out: Out, input: In, ports: AppActionPorts) => unknown;
  /** The idempotency key the screen sent, from the parsed input. */
  readonly idempotencyKeyOf?: ((input: In) => string) | undefined;
  /**
   * An outcome the route answers as a problem (RFC 9457), with the code
   * and the person's words; null: it succeeded.
   */
  readonly problem?:
    | ((
        out: Out,
      ) => { readonly code: KnownErrorCode; readonly detail: string } | null)
    | undefined;
  /** An outcome the route answers as a 404 (a refusal that must not leak). */
  readonly notFound?: ((out: Out) => boolean) | undefined;
};

export type AppActionTool<In, ToolIn> = {
  /** The provider name the model sees, e.g. save_company. */
  readonly name: string;
  readonly description: string;
  /** What the model fills: names allowed where `references` says so. */
  readonly input: z.ZodType<ToolIn>;
  /** Fields that name a record; each may be an id or a name as said. */
  readonly references: Partial<Record<keyof ToolIn & string, ReferenceKind>>;
  /**
   * From the model's input (references already resolved to ids) to the
   * canonical input; may read through the ports (e.g. their own company).
   * Null: not theirs to act on.
   */
  readonly toCanonical: (
    input: ToolIn,
    context: AppActionContext,
    ports: AppActionPorts,
  ) => Promise<In | AppActionRefusal | null>;
  /**
   * A check only Q's path needs before preparing a card, in the person's
   * words (a handle already taken): the screen's route gets the service's
   * own answer instead. Null: nothing to refuse.
   */
  readonly refuse?:
    | ((
        input: In,
        ports: AppActionPorts,
        context: AppActionContext,
      ) => Promise<string | null>)
    | undefined;
  /**
   * The conversation scopes it is offered under (any of them): a founder's
   * conversation is not offered an investor organisation's tools. Default:
   * every conversation of their own.
   */
  readonly scopes?: readonly QKnowledgeScopeKind[] | undefined;
  /**
   * The kinds of turn it is offered on. A run offers at most
   * MODEL_TOOLS_MAX tools, ranked by how few purposes each serves, so a
   * tool declared for every purpose is the first one cut. Default: all.
   */
  readonly purposes?: readonly QTaskClass[] | undefined;
  /**
   * How a person asks for it, for the parity eval (scripts/evals/q-parity):
   * two phrasings, `{name}` standing for the record it names. The eval adds
   * a misheard variant of the name itself.
   */
  readonly eval: {
    readonly say: readonly [string, string];
    /** The kind of record `{name}` is filled from on the eval account. */
    readonly names?: ReferenceKind | undefined;
    /**
     * A refusal that is the right answer on an eval account whose state
     * does not allow the action (a case-insensitive pattern Q's answer
     * matches): it passes instead of a prepared card. Never a product
     * rule; the eval only.
     */
    readonly orSays?: string | undefined;
  };
};

export type AppActionCard = {
  readonly summary: string;
  readonly preview: string;
};

/**
 * Names for the approval card, resolved by the composition for the card's
 * first target as the proposing person may see it. Null: not known (the
 * card still reads, without a name).
 */
export type AppActionCardNames = {
  readonly counterpart: string | null;
};

const RELATIONSHIP_ID = z.string().uuid();

/**
 * The relationship an action acts in, as its card's target: what the
 * Approval Engine binds and names (and refuses without). An id that is not
 * a relationship id has none, and the engine refuses the card.
 */
export function relationshipTarget(id: string): readonly QSubjectRef[] {
  return RELATIONSHIP_ID.safeParse(id).success
    ? [{ kind: "RELATIONSHIP", relationshipId: id }]
    : [];
}

/** ADR 0043: what is never delegated to Q on its own. */
export const APP_ACTION_CONSEQUENCES = [
  "TERMS",
  "MONEY",
  "COMMITMENT",
] as const;
export type AppActionConsequence = (typeof APP_ACTION_CONSEQUENCES)[number];

export type AppActionDefinition<In, Out, ToolIn = In> = {
  /** Stable, dotted: the Approval Engine's action type is `app.<name>`. */
  readonly name: string;
  /** The area the migration checklist sizes by (pitch, discovery, ...). */
  readonly area: string;
  readonly classification: AppActionClass;
  /** One line for the capability registry and the parity doc. */
  readonly does: string;
  /**
   * 3-5 words for the turn reader's grouped action list ("save a
   * company"). Optional: absent, it is derived from `does`.
   */
  readonly short?: string | undefined;
  readonly input: z.ZodType<In>;
  readonly output: z.ZodType<Out>;
  /** The route's own authorize step: the same check, whoever calls. */
  readonly authorize: (
    ports: AppActionPorts,
    context: AppActionContext,
    input: In,
  ) => Promise<AppActionVerdict>;
  /** The one service call. */
  readonly run: (
    ports: AppActionPorts,
    context: AppActionContext,
    input: In,
  ) => Promise<Out>;
  /** The canonical records it acts on: the approval binds to them (CONSEQUENTIAL). */
  readonly targets: (input: In) => readonly QSubjectRef[];
  /**
   * A setter: a newer waiting value for the same target replaces the older
   * card (lead 2026-10-03). Absent: additive, cards coexist.
   */
  readonly supersedes?: boolean | undefined;
  /**
   * ADR 0043: terms, money or a commitment. Never taken by Q on its own
   * under a standing instruction, whatever the grant says: always an
   * explicit yes on its card.
   */
  readonly consequence?: AppActionConsequence | undefined;
  /** What the approval card says (CONSEQUENTIAL), and Q's line after. */
  readonly card: (input: In, names?: AppActionCardNames) => AppActionCard;
  /**
   * The card's counterpart by name when its input names no target the
   * composition can name (an interest or a request by id): read through
   * the action's own service, as the proposing person, from their own
   * inbox. Null: not theirs or not found, and the card reads without one.
   */
  readonly counterpartOf?:
    | ((
        ports: AppActionPorts,
        actor: ActorContext,
        input: In,
      ) => Promise<string | null>)
    | undefined;
  /**
   * Q's sentence once it ran (INSTANT) or ran on approval. `names` holds
   * the display names of the references Q resolved, by tool field.
   */
  readonly done: (
    out: Out,
    input: In,
    names: Readonly<Record<string, string>>,
  ) => string;
  /** Whether it did what was asked (a refusal can be an outcome). Default: yes. */
  readonly succeeded?: ((out: Out) => boolean) | undefined;
  readonly http?: AppActionHttp<In, Out> | undefined;
  /**
   * The Q tool generated from this declaration. Absent while the area's
   * hand-written tool still serves Q (`legacyTool` names it); migrating the
   * tool is the second step for that area.
   */
  readonly tool?: AppActionTool<In, ToolIn> | undefined;
  /** The hand-written Q tool that still does this for Q, until migrated. */
  readonly legacyTool?: string | undefined;
  /**
   * The generated tool of the family this action belongs to: one tool for
   * one form's operations (create, update, close...), each still its own
   * declaration and route. Set by `defineAppActionFamily`.
   */
  readonly viaTool?: string | undefined;
  /**
   * The capability that does this for Q when no tool does: a turn-reader
   * hand (`hand.set_visibility`, the reader owner's to retire) or an offer
   * of the screen (`offer.chat_block`: the person's own act, never one Q
   * takes for them). A full capability id from the registry.
   */
  readonly qCapability?: `hand.${string}` | `offer.${string}` | undefined;
};

/**
 * Nothing to act on, said in the person's words (no Q Card yet, no raise
 * yet): Q says why rather than "not available".
 */
export type AppActionRefusal = { readonly refused: string };

export function refusal(words: string): AppActionRefusal {
  return { refused: words };
}

export function isRefusal(value: unknown): value is AppActionRefusal {
  return (
    typeof value === "object" &&
    value !== null &&
    "refused" in value &&
    typeof value.refused === "string" &&
    Object.keys(value).length === 1
  );
}

/** Erased for the registry; per-action types stay with the action (as q-tools does). */
export type AnyAppAction = AppActionDefinition<unknown, unknown, unknown>;

export function defineAppAction<In, Out, ToolIn = In>(
  definition: AppActionDefinition<In, Out, ToolIn>,
): AnyAppAction {
  return Object.freeze(definition) as unknown as AnyAppAction;
}

/** The capability id the registry lists for what does this for Q. */
export function qCapabilityId(
  action: Pick<AnyAppAction, "tool" | "viaTool" | "legacyTool" | "qCapability">,
): string | null {
  if (action.qCapability !== undefined) return action.qCapability;
  const tool = qToolName(action);
  return tool === null ? null : `tool.${tool}`;
}

/** The Q tool that does an action: its own, its family's, or a hand tool. */
export function qToolName(
  action: Pick<AnyAppAction, "tool" | "viaTool" | "legacyTool">,
): string | null {
  return action.tool?.name ?? action.viaTool ?? action.legacyTool ?? null;
}

/**
 * The Q tools code may take a declared action with, one by one: an
 * action's own tool, or the hand-written proposer that still serves a
 * Prepare -> Approve action (`legacyTool` named `propose_*`, which
 * prepares the card and says PREPARED). Other hand tools (the onboarding
 * interview's) keep their own loop; a family's shared tool (`viaTool`)
 * takes an operation, not one action.
 */
export function appActionToolNames(
  actions: readonly Pick<
    AnyAppAction,
    "tool" | "legacyTool" | "classification"
  >[],
): string[] {
  return [
    ...new Set(
      actions.flatMap((action) => {
        if (action.tool !== undefined) return [action.tool.name];
        const legacy = action.legacyTool;
        return legacy !== undefined &&
          action.classification === "CONSEQUENTIAL" &&
          legacy.startsWith("propose_")
          ? [legacy]
          : [];
      }),
    ),
  ];
}

/** What a family's tool prepares: one member, by operation, with its input. */
export type AppActionFamilyInput = {
  readonly operation: string;
  readonly input: unknown;
};

/**
 * One Q tool for one form's operations (ADR 0040). Each operation stays its
 * own declaration -- its own route, authorize step and service call -- and
 * the family is the one action Q prepares: `{ operation, input }`, checked
 * against that member's own input and run through that member, so the
 * screen and Q still share every step. Why one tool, not one per member: a
 * run offers at most MODEL_TOOLS_MAX tools, and a form's operations are
 * one thing to the person ("my raise").
 */
export function defineAppActionFamily<ToolIn>(definition: {
  readonly name: string;
  /** 3-5 words for the reader's compact list. */
  readonly short?: string | undefined;
  readonly area: string;
  readonly does: string;
  readonly members: Readonly<Record<string, AnyAppAction>>;
  readonly tool: AppActionTool<AppActionFamilyInput, ToolIn>;
  /** The family's own card: a setter (see AppActionDefinition.supersedes). */
  readonly supersedes?: boolean | undefined;
  /** ADR 0043: the family's consequence (see AppActionDefinition). */
  readonly consequence?: AppActionConsequence | undefined;
}): readonly AnyAppAction[] {
  const operations = Object.keys(definition.members);
  const memberOf = (operation: string): AnyAppAction => {
    const member = definition.members[operation];
    if (member === undefined)
      throw new Error(`APP_ACTION_OPERATION:${operation}`);
    return member;
  };
  const input = z
    .object({ operation: z.string(), input: z.unknown() })
    .strict()
    .transform((value, context) => {
      const member = definition.members[value.operation];
      if (member === undefined) {
        context.addIssue({
          code: "custom",
          message: `expected one of ${operations.join(", ")}`,
          path: ["operation"],
        });
        return z.NEVER;
      }
      const parsed = member.input.safeParse(value.input);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          context.addIssue({
            code: "custom",
            message: issue.message,
            path: ["input", ...issue.path],
          });
        }
        return z.NEVER;
      }
      return { operation: value.operation, input: parsed.data };
    });
  const family = defineAppAction<AppActionFamilyInput, unknown, ToolIn>({
    name: definition.name,
    ...(definition.short === undefined ? {} : { short: definition.short }),
    area: definition.area,
    classification: "CONSEQUENTIAL",
    does: definition.does,
    input,
    output: z.unknown(),
    authorize: (ports, context, value) =>
      memberOf(value.operation).authorize(ports, context, value.input),
    run: (ports, context, value) =>
      memberOf(value.operation).run(ports, context, value.input),
    targets: (value) => memberOf(value.operation).targets(value.input),
    card: (value, names) => memberOf(value.operation).card(value.input, names),
    done: (out, value, names) =>
      memberOf(value.operation).done(out, value.input, names),
    tool: definition.tool,
    ...(definition.supersedes === true ? { supersedes: true } : {}),
    ...(definition.consequence === undefined
      ? {}
      : { consequence: definition.consequence }),
  });
  return [
    family,
    ...Object.values(definition.members).map((member) =>
      Object.freeze({ ...member, viaTool: definition.tool.name }),
    ),
  ];
}

/**
 * What a deployment says when the service behind an action isn't composed
 * on it: "<feature> isn't available on this deployment yet", never a 500.
 * By port, in the person's words.
 */
const FEATURES: Readonly<Partial<Record<keyof AppActionPorts, string>>> = {
  capital: "Your raise",
  capitalRounds: "Rounds",
  commitments: "Commitments",
  deal: "Deal close",
  chat: "Chat",
  chatSafety: "Blocking and reporting in chat",
  companies: "Company profiles",
  connections: "Connection requests",
  documentUploads: "Document uploads",
  documentUploadLimits: "Document uploads",
  google: "Google",
  interests: "Expressing interest",
  investors: "Investor profiles",
  notificationSettings: "Notification settings",
  people: "Your profile",
  pitchUploads: "Pitch videos",
  profileImages: "Profile photos",
  publicIdentity: "Q Cards",
  reviews: "Reviews",
  schedule: "Calls and reminders",
  verification: "Verification",
  visibility: "Sharing",
  kyb: "Business verification",
  onboarding: "Setup",
  onboardingNudges: "Setup reminders",
  team: "Teams",
};

/** An action's service is not composed on this deployment. */
export class AppActionPortMissingError extends Error {
  readonly port: keyof AppActionPorts;
  readonly detail: string;
  constructor(port: keyof AppActionPorts) {
    super(`APP_ACTION_PORT_MISSING:${String(port)}`);
    this.name = "AppActionPortMissingError";
    this.port = port;
    this.detail = `${FEATURES[port] ?? "That"} isn't available on this deployment yet.`;
  }
}

export function portMissing(port: keyof AppActionPorts): never {
  throw new AppActionPortMissingError(port);
}

/**
 * A person-scoped action: one a person takes before (or without) an
 * organisation, such as their own onboarding answers. Its route is
 * generated under the onboarding actor (the person, and their
 * organisation's context when they have one), never an organisation's
 * actor context; it has no Q tool of its own: Q takes these through the
 * onboarding loop's tools (`legacyTool`) or offers the screen.
 */
export type PersonActionContext = {
  /** The person, and their organisation's context when they have one. */
  readonly person: OnboardingActor;
  readonly correlationId: CorrelationId;
};

export type PersonActionDefinition<In, Out> = {
  readonly name: string;
  readonly short: string;
  readonly area: string;
  readonly classification: AppActionClass;
  readonly does: string;
  readonly input: z.ZodType<In>;
  readonly output: z.ZodType<Out>;
  /** The one service call; the service authorises the person. */
  readonly run: (
    ports: AppActionPorts,
    context: PersonActionContext,
    input: In,
  ) => Promise<Out>;
  readonly http: AppActionHttp<In, Out>;
  readonly legacyTool?: string | undefined;
  readonly qCapability?: `hand.${string}` | `offer.${string}` | undefined;
};

export type AnyPersonAction = PersonActionDefinition<unknown, unknown>;

export function definePersonAction<In, Out>(
  definition: PersonActionDefinition<In, Out>,
): AnyPersonAction {
  return Object.freeze(definition) as unknown as AnyPersonAction;
}
