import type { ActorContextResolver } from "@capital-q/security";
import type { ApplicationIdentityLookup } from "@capital-q/security/postgres";

/**
 * ADR 0033: an account a Capital Q operator suspended resolves to no actor
 * at all -- every authenticated route answers ACCOUNT_SUSPENDED. The check
 * wraps the actor-context resolver, so no route can forget it. Answers are
 * cached briefly per person; a suspension takes effect within seconds.
 */

export class AccountSuspendedError extends Error {
  constructor() {
    super("This account is suspended.");
    this.name = "AccountSuspendedError";
  }
}

export function withSuspension(
  resolver: ActorContextResolver,
  isSuspended: (userId: string) => Promise<boolean>,
  options: { readonly ttlMs?: number; readonly now?: () => number } = {},
): ActorContextResolver {
  const ttl = options.ttlMs ?? 10_000;
  const now = options.now ?? Date.now;
  const cache = new Map<string, { suspended: boolean; at: number }>();
  return {
    ...resolver,
    resolveHumanContext: async (input) => {
      const resolution = await resolver.resolveHumanContext(input);
      if (resolution.status !== "RESOLVED") return resolution;
      const userId = resolution.context.userId;
      const hit = cache.get(userId);
      let suspended: boolean;
      if (hit !== undefined && now() - hit.at < ttl) {
        suspended = hit.suspended;
      } else {
        suspended = await isSuspended(userId);
        if (cache.size > 10_000) cache.clear();
        cache.set(userId, { suspended, at: now() });
      }
      if (suspended) throw new AccountSuspendedError();
      return resolution;
    },
  };
}

/**
 * The same refusal for the routes that work before an organisation exists
 * (sign-up onboarding, /v1/me): the person's identity lookup refuses.
 */
export function withSuspendedIdentity(
  identities: ApplicationIdentityLookup,
  isSuspended: (userId: string) => Promise<boolean>,
): ApplicationIdentityLookup {
  return {
    lookup: async (principal) => {
      const identity = await identities.lookup(principal);
      if (identity !== null && (await isSuspended(identity.userId))) {
        throw new AccountSuspendedError();
      }
      return identity;
    },
  };
}
