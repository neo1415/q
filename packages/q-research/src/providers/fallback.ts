import {
  isResearchProviderFailure,
  type PublicWebResearchProvider,
} from "../ports.js";

/**
 * One provider over several: search tries each index in turn until one
 * answers; a page is read by the first provider that can read pages. So a
 * rate-limited or unreachable index costs a second search, not the answer.
 * The code reported on evidence is the provider that actually answered.
 */
export function createFallbackResearchProvider(input: {
  readonly providers: readonly PublicWebResearchProvider[];
}): PublicWebResearchProvider {
  const providers = input.providers;
  const first = providers[0];
  if (first === undefined) {
    throw new Error("a fallback research provider needs at least one provider");
  }
  let lastSearch: PublicWebResearchProvider = first;
  return {
    get code() {
      return lastSearch.code;
    },
    search: async (request, context) => {
      let failure: unknown = null;
      for (const provider of providers) {
        try {
          const result = await provider.search(request, context);
          lastSearch = provider;
          return result;
        } catch (error: unknown) {
          if (!isResearchProviderFailure(error)) throw error;
          failure = error;
          if (context.signal?.aborted === true) throw error;
        }
      }
      throw failure;
    },
    extract: async (request, context) => {
      let failure: unknown = null;
      for (const provider of providers) {
        try {
          return await provider.extract(request, context);
        } catch (error: unknown) {
          if (!isResearchProviderFailure(error)) throw error;
          failure = error;
          if (context.signal?.aborted === true) throw error;
        }
      }
      throw failure;
    },
  };
}
