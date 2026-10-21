import {
  createPexelsPictureProvider,
  type StockPictureProvider,
} from "@capital-q/model-gateway/images/stock";
import type { QPicturePort } from "@capital-q/model-gateway/q";
import { composeEgressQuery } from "@capital-q/q-research";

/**
 * L-13 (owner ask 2026-10-20): pictures for Q's answers, from Pexels (the
 * stock source already approved for decks, founder direction 2026-09-29).
 *
 * The search words pass q-research's outbound Context Firewall exactly as
 * a web search does: only words the person wrote this turn or earlier, and
 * connectives, survive from the model's proposal; figures never leave. No
 * subject identity is supplied, so a company's name is never sent to a
 * picture library, and when nothing of the person's survives there is no
 * search at all.
 */
export function createQPictures(
  provider: StockPictureProvider | undefined,
): QPicturePort | undefined {
  if (provider === undefined) return undefined;
  return {
    find: async (input) => {
      const egress = composeEgressQuery({
        requestedQuery: input.requestedQuery,
        userText: input.userText,
        earlierUserText: input.earlierUserText,
        publicIdentity: [],
      });
      if (!egress.ok) return null;
      const found = await provider.search(egress.query, {
        signal: input.signal,
      });
      return found[0] ?? null;
    },
  };
}

/** Undefined when no usable key is configured: answers go without pictures. */
export function createPexelsQPictures(
  apiKey: string | undefined,
  fetchImpl: typeof fetch = fetch,
): QPicturePort | undefined {
  return createQPictures(createPexelsPictureProvider(apiKey, fetchImpl));
}
