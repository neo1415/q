import {
  DisclosureResourceRefSchema,
  type DisclosureResourceType,
} from "../contracts/index.js";
import type { DisclosureResourceDescriptor } from "../contracts/index.js";
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
    resolveMany: async (resources) => {
      const out = new Map<string, DisclosureResourceDescriptor>();
      const byKind = new Map<DisclosureResourceType, Set<string>>();
      for (const resource of resources) {
        const parsed = DisclosureResourceRefSchema.safeParse(resource);
        if (!parsed.success) continue;
        const ids = byKind.get(parsed.data.type) ?? new Set<string>();
        ids.add(parsed.data.id);
        byKind.set(parsed.data.type, ids);
      }
      await Promise.all(
        [...byKind.entries()].map(async ([type, ids]) => {
          const resolver = byType.get(type);
          if (resolver === undefined) return;
          const found =
            resolver.resolveMany !== undefined
              ? await resolver.resolveMany([...ids])
              : (
                  await Promise.all([...ids].map((id) => resolver.resolve(id)))
                ).flatMap((d) => (d === null ? [] : [d]));
          for (const descriptor of found) {
            // A descriptor for a resource that was not asked for is dropped.
            if (descriptor.resource.type !== type) continue;
            if (!ids.has(descriptor.resource.id)) continue;
            out.set(
              `${descriptor.resource.type}:${descriptor.resource.id}`,
              descriptor,
            );
          }
        }),
      );
      return out;
    },
    has: (resourceType) => byType.has(resourceType as DisclosureResourceType),
    types: () => [...byType.keys()],
  };
}
