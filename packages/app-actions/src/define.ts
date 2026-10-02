import type { z } from "zod";

import type { CorrelationId, QSubjectRef } from "@capital-q/contracts";
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
};

export type AppActionVerdict =
  | { readonly ok: true }
  | {
      readonly ok: false;
      /** Plain words for Q; a route answers the one 404 for every refusal. */
      readonly reason: string;
    };

export type AppActionHttp<In, Out> = {
  readonly method: "POST" | "PUT" | "PATCH" | "DELETE";
  /** The route's own path, with :params. Never a catch-all. */
  readonly path: string;
  /** The canonical input from the URL params and the body (still unknown). */
  readonly fromRequest: (
    params: Record<string, string>,
    body: unknown,
  ) => unknown;
  /** The wire answer, in the route's existing response contract. */
  readonly respond: (out: Out, input: In, ports: AppActionPorts) => unknown;
  /** The idempotency key the screen sent, from the parsed input. */
  readonly idempotencyKeyOf?: ((input: In) => string) | undefined;
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
  ) => Promise<In | null>;
  /**
   * How a person asks for it, for the parity eval (scripts/evals/q-parity):
   * two phrasings, `{name}` standing for the record it names. The eval adds
   * a misheard variant of the name itself.
   */
  readonly eval: {
    readonly say: readonly [string, string];
    /** The kind of record `{name}` is filled from on the eval account. */
    readonly names?: ReferenceKind | undefined;
  };
};

export type AppActionCard = {
  readonly summary: string;
  readonly preview: string;
};

export type AppActionDefinition<In, Out, ToolIn = In> = {
  /** Stable, dotted: the Approval Engine's action type is `app.<name>`. */
  readonly name: string;
  /** The area the migration checklist sizes by (pitch, discovery, ...). */
  readonly area: string;
  readonly classification: AppActionClass;
  /** One line for the capability registry and the parity doc. */
  readonly does: string;
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
  /** What the approval card says (CONSEQUENTIAL), and Q's line after. */
  readonly card: (input: In) => AppActionCard;
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
};

/** Erased for the registry; per-action types stay with the action (as q-tools does). */
export type AnyAppAction = AppActionDefinition<unknown, unknown, unknown>;

export function defineAppAction<In, Out, ToolIn = In>(
  definition: AppActionDefinition<In, Out, ToolIn>,
): AnyAppAction {
  return Object.freeze(definition) as unknown as AnyAppAction;
}
