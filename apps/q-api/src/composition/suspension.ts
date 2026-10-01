import type { ActorContextResolver } from "@capital-q/security";

/**
 * ADR 0033: an account a Capital Q operator suspended gets no actor
 * context in Q either -- no conversation, no tool, no errand step runs for
 * it. The api answers ACCOUNT_SUSPENDED; here the refusal is the ordinary
 * "not accessible", which every Q route already turns into a denial.
 * Answers are cached briefly per person.
 */
export function withSuspension(
  resolver: ActorContextResolver,
  isSuspended: (userId: string) => Promise<boolean>,
  options: { readonly ttlMs?: number; readonly now?: () => number } = {},
): ActorContextResolver {
  const ttl = options.ttlMs ?? 10_000;
  const now = options.now ?? Date.now;
  const cache = new Map<string, { suspended: boolean; at: number }>();
  return {
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
      return suspended ? { status: "CONTEXT_NOT_ACCESSIBLE" } : resolution;
    },
  };
}
