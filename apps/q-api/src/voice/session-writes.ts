import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

import {
  completeOnboardingSession,
  getOnboardingSession,
  resolveOnboardingSuggestion,
  sayToOnboarding,
  skipOnboardingStep,
  submitOnboardingResponse,
  submitOnboardingResponses,
  withdrawOnboardingResponse,
  type ApiSession,
} from "@capital-q/api-client";
import type { Logger } from "@capital-q/observability";

/**
 * Every write q-api makes to an onboarding session, in one place (live
 * recheck 2026-10-30: saves for one session went out on the same version
 * and the later one was lost to a 409). A write is applied after every
 * write to the same session made before it in this process, on the
 * version the one before it returned, and a version conflict with a write
 * from elsewhere (the browser, another tab, another instance) is made
 * again on the fresh version, a bounded number of times.
 *
 * This module is the only caller of the onboarding API's version-bumping
 * operations in q-api; a test fails if any other module calls one.
 */

type Unversioned<T> = Omit<T, "expectedSessionVersion">;
type RequestOf<
  F extends (...args: never[]) => unknown,
  I extends number,
> = Unversioned<Parameters<F>[I]>;

export type SessionWrite =
  | {
      readonly kind: "SUBMIT";
      readonly request: RequestOf<typeof submitOnboardingResponse, 2>;
    }
  | {
      readonly kind: "SUBMIT_MANY";
      readonly request: RequestOf<typeof submitOnboardingResponses, 2>;
    }
  | {
      readonly kind: "SKIP";
      readonly stepKey: string;
      readonly request: RequestOf<typeof skipOnboardingStep, 3>;
    }
  | {
      readonly kind: "WITHDRAW";
      readonly stepKey: string;
      readonly request: RequestOf<typeof withdrawOnboardingResponse, 3>;
    }
  | {
      readonly kind: "COMPLETE";
      readonly request: RequestOf<typeof completeOnboardingSession, 2>;
    }
  | {
      readonly kind: "RESOLVE";
      readonly suggestionId: string;
      readonly request: RequestOf<typeof resolveOnboardingSuggestion, 3>;
    }
  | {
      readonly kind: "SAY";
      readonly request: RequestOf<typeof sayToOnboarding, 2>;
    };

/** The kinds, for the test that no write path bypasses this module. */
export const SESSION_WRITE_KINDS = [
  "SUBMIT",
  "SUBMIT_MANY",
  "SKIP",
  "WITHDRAW",
  "COMPLETE",
  "RESOLVE",
  "SAY",
] as const satisfies readonly SessionWrite["kind"][];

type ResultOf<W extends SessionWrite> = W["kind"] extends "SUBMIT_MANY"
  ? Awaited<ReturnType<typeof submitOnboardingResponses>>
  : W["kind"] extends "SAY"
    ? Awaited<ReturnType<typeof sayToOnboarding>>
    : Awaited<ReturnType<typeof submitOnboardingResponse>>;

/** How many times a write is made again after a version conflict. */
export const FRESH_VERSION_ATTEMPTS = 3;

export function isVersionConflict(error: unknown): boolean {
  const failed = error as {
    readonly status?: unknown;
    readonly code?: unknown;
  };
  return failed.status === 409 && failed.code === "VERSION_CONFLICT";
}

/** Each onboarding session's writes from this process, chained in order. */
const chains = new Map<string, Promise<unknown>>();
/** The sessions whose chain the current async context already holds. */
const holding = new AsyncLocalStorage<ReadonlySet<string>>();

/**
 * Runs `work` after every write to the same onboarding session made
 * before it in this process. A write made while the chain is already held
 * by this same operation (a preselection settled while re-reading the
 * session) runs inside it: it is part of that write, and waiting for the
 * chain would wait for itself.
 */
export function inSessionOrder<T>(
  onboardingSessionId: string,
  work: () => Promise<T>,
): Promise<T> {
  const held = holding.getStore();
  if (held?.has(onboardingSessionId) === true) return work();
  const run = () =>
    holding.run(new Set([...(held ?? []), onboardingSessionId]), work);
  const before = chains.get(onboardingSessionId) ?? Promise.resolve();
  const next = before.then(run, run);
  const tail = next.then(
    () => undefined,
    () => undefined,
  );
  chains.set(onboardingSessionId, tail);
  void tail.then(() => {
    if (chains.get(onboardingSessionId) === tail) {
      chains.delete(onboardingSessionId);
    }
  });
  return next;
}

/** Waits for the writes made before now, without holding the chain. */
function afterEarlierWrites(onboardingSessionId: string): Promise<void> {
  return inSessionOrder(onboardingSessionId, () => Promise.resolve());
}

export type SessionWriteContext = {
  readonly session: ApiSession;
  readonly onboardingSessionId: string;
  /** The version to try first; the session is read when absent. */
  readonly version?: (() => Promise<number>) | undefined;
  /** The version after a conflict; the session is read when absent. */
  readonly fresh?: (() => Promise<number>) | undefined;
  /** The idempotency key for an attempt on a version; a new one by default. */
  readonly idempotencyKey?: ((version: number) => string) | undefined;
  readonly logger?: Pick<Logger, "info"> | undefined;
};

function dispatch(
  context: SessionWriteContext,
  write: SessionWrite,
  version: number,
): Promise<unknown> {
  const { session, onboardingSessionId: id } = context;
  const key = context.idempotencyKey?.(version) ?? randomUUID();
  const at = { expectedSessionVersion: version };
  switch (write.kind) {
    case "SUBMIT":
      return submitOnboardingResponse(
        session,
        id,
        { ...write.request, ...at },
        key,
      );
    case "SUBMIT_MANY":
      return submitOnboardingResponses(
        session,
        id,
        { ...write.request, ...at },
        key,
      );
    case "SKIP":
      return skipOnboardingStep(
        session,
        id,
        write.stepKey,
        { ...write.request, ...at },
        key,
      );
    case "WITHDRAW":
      return withdrawOnboardingResponse(
        session,
        id,
        write.stepKey,
        { ...write.request, ...at },
        key,
      );
    case "COMPLETE":
      return completeOnboardingSession(session, id, {
        ...write.request,
        ...at,
      });
    case "RESOLVE":
      return resolveOnboardingSuggestion(
        session,
        id,
        write.suggestionId,
        { ...write.request, ...at },
        key,
      );
    case "SAY":
      return sayToOnboarding(session, id, { ...write.request, ...at }, key);
  }
}

/**
 * One write to an onboarding session: in order with this process's other
 * writes to it, made again on the fresh version after a conflict.
 */
export async function writeSession<W extends SessionWrite>(
  context: SessionWriteContext,
  write: W,
): Promise<ResultOf<W>> {
  const read = async () =>
    (await getOnboardingSession(context.session, context.onboardingSessionId))
      .session.version;
  const attempts = async (): Promise<ResultOf<W>> => {
    let version = await (context.version ?? read)();
    for (let tries = 0; ; tries += 1) {
      try {
        return (await dispatch(context, write, version)) as ResultOf<W>;
      } catch (error: unknown) {
        if (!isVersionConflict(error) || tries >= FRESH_VERSION_ATTEMPTS) {
          throw error;
        }
        context.logger?.info(
          {
            onboardingSessionId: context.onboardingSessionId,
            write: write.kind,
            attempt: tries + 1,
          },
          "onboarding write made again on the session's fresh version",
        );
        version = await (context.fresh ?? read)();
      }
    }
  };
  if (write.kind === "SAY") {
    // A turn said to the onboarding service can come back to this process
    // as writes of its own (the service delegates the turn to Q): it waits
    // for the writes before it, but never holds the chain while it runs,
    // or those writes would wait for it.
    await afterEarlierWrites(context.onboardingSessionId);
    return attempts();
  }
  return inSessionOrder(context.onboardingSessionId, attempts);
}
