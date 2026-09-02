import { ActorContextSchema, type ActorContext } from "./actor-context.js";
import { ActorContextRequiredError } from "./errors.js";

/**
 * Assert that a resolved context is present.
 *
 * Exists so callers never reach for a non-null assertion on an optional
 * context: `request.actorContext!` compiles, and then fails at runtime in the
 * one place where failing open is worst. This fails closed instead.
 *
 * Framework-neutral -- takes the value, not a request.
 */
export function requireActorContext(
  context: ActorContext | undefined,
): ActorContext {
  if (context === undefined) {
    throw new ActorContextRequiredError();
  }

  return context;
}

/** Narrow an unknown value to a structurally valid ActorContext. */
export function isActorContext(value: unknown): value is ActorContext {
  return ActorContextSchema.safeParse(value).success;
}
