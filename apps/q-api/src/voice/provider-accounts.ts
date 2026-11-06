import type {
  ModelFailureClass,
  ModelProviderCode,
} from "@capital-q/contracts";
import type { ProviderHealthPort } from "@capital-q/model-gateway";

/**
 * DECISIONS 68 (owner, 6 Nov 2026): voice falls back to ElevenLabs when the
 * OpenAI account is exhausted, with Q's own brain answering. The Model
 * Gateway already knows when a provider's ACCOUNT cannot serve (credit or
 * quota): its health port is told so with every refusal and every success.
 * This watches the same records, at composition, so the voice routes can
 * ask "is OpenAI's account out right now?" without a second probe, a
 * provider call, or a change to the gateway.
 *
 * It mirrors the gateway's own account block (policy/health.ts): opened by
 * an exhausted refusal, lapsing after the same ten minutes unless refused
 * again, and closed as soon as any request on the account is answered --
 * the gateway's 30-second probe succeeding is what ends it.
 */

/** As the gateway's ACCOUNT_EXHAUSTED_OPEN_MS. */
export const ACCOUNT_EXHAUSTED_WATCH_MS = 10 * 60_000;

/** As the gateway's ACCOUNT_ANSWERED: the account answered, so it serves. */
const ACCOUNT_ANSWERED: ReadonlySet<ModelFailureClass> = new Set([
  "INVALID_MODEL_OUTPUT",
  "INVALID_REQUEST",
  "CONTEXT_LIMIT",
  "RATE_LIMIT",
]);

export type ProviderAccounts = {
  /** The health port to hand the gateway: the same one, watched. */
  readonly health: ProviderHealthPort;
  /** Whether this provider's account is known to be exhausted now. */
  readonly exhausted: (code: ModelProviderCode, at?: Date) => boolean;
};

export function watchProviderAccounts(
  health: ProviderHealthPort,
  options: { readonly openForMs?: number; readonly now?: () => Date } = {},
): ProviderAccounts {
  const openForMs = options.openForMs ?? ACCOUNT_EXHAUSTED_WATCH_MS;
  const now = options.now ?? (() => new Date());
  const until = new Map<ModelProviderCode, number>();
  return {
    health: {
      ...health,
      recordFailure: (
        code,
        model,
        failureClass,
        at,
        elapsedMs,
        accountExhausted,
        retryAfterMs,
      ) => {
        if (accountExhausted === true) {
          until.set(code, at.getTime() + openForMs);
        } else if (ACCOUNT_ANSWERED.has(failureClass)) {
          until.delete(code);
        }
        health.recordFailure(
          code,
          model,
          failureClass,
          at,
          elapsedMs,
          accountExhausted,
          retryAfterMs,
        );
      },
      recordSuccess: (code, model, at) => {
        until.delete(code);
        health.recordSuccess(code, model, at);
      },
    },
    exhausted: (code, at = now()) => {
      const open = until.get(code);
      if (open === undefined) return false;
      if (open > at.getTime()) return true;
      until.delete(code);
      return false;
    },
  };
}
