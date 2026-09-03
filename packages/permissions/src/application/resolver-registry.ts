import {
  DisclosureResourceRefSchema,
  type DisclosureResourceType,
} from "../contracts/index.js";
import type {
  DisclosureResourceResolver,
  DisclosureResourceResolverRegistry,
} from "./ports.js";

/**
 * The explicit resource resolver registry. One resolver per bounded
 * resource kind; duplicates and unknown kinds fail at construction or
 * lookup, never by falling through to a dynamic table read.
 */
export function createDisclosureResourceResolverRegistry(
  resolvers: readonly DisclosureResourceResolver[],
): DisclosureResourceResolverRegistry {
  const byType = new Map<DisclosureResourceType, DisclosureResourceResolver>();
  for (const resolver of resolvers) {
    if (byType.has(resolver.resourceType)) {
      throw new TypeError(
        `duplicate disclosure resolver for ${resolver.resourceType}`,
      );
    }
    byType.set(resolver.resourceType, resolver);
  }

  return {
    resolve: async (resource) => {
      // Validate even internal input: the ref decides which resolver runs.
      const parsed = DisclosureResourceRefSchema.safeParse(resource);
      if (!parsed.success) {
        return null;
      }
      const resolver = byType.get(parsed.data.type);
      if (resolver === undefined) {
        return null;
      }
      const descriptor = await resolver.resolve(parsed.data.id);
      // A resolver answering for a different resource than asked is a
      // programming error that must not become a permission.
      if (
        descriptor !== null &&
        (descriptor.resource.type !== parsed.data.type ||
          descriptor.resource.id !== parsed.data.id)
      ) {
        return null;
      }
      return descriptor;
    },
    has: (resourceType) => byType.has(resourceType as DisclosureResourceType),
    types: () => [...byType.keys()],
  };
}
