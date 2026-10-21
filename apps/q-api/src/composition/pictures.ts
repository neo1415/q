import {
  createPexelsPictureProvider,
  type StockPictureProvider,
} from "@capital-q/model-gateway/images/stock";
import type { QPicturePort } from "@capital-q/model-gateway/q";
import {
  composeEgressQuery,
  isConnective,
  tokenise,
} from "@capital-q/q-research";

/**
 * L-13 (owner ask 2026-10-20): pictures for Q's answers, from Pexels (the
 * stock source already approved for decks, founder direction 2026-09-29).
 *
 * The search words pass q-research's outbound Context Firewall exactly as
 * a web search does: only words the person wrote this turn or earlier, and
 * connectives, survive from the model's proposal; figures never leave. No
 * subject identity is supplied, and every word of a name this run read
 * (`withheld`) is dropped even when the person typed it, so a company's,
 * investor's or person's name never reaches a picture library. When
 * nothing survives there is no search at all.
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
      const withheld = new Set(
        (input.withheld ?? []).flatMap((name) => tokenise(name).map(bare)),
      );
      const kept = tokenise(egress.query).filter(
        (token) => !withheld.has(bare(token)),
      );
      // Joining words alone ("the of") are no search.
      if (kept.every((token) => isConnective(token))) return null;
      const found = await provider.search(kept.join(" "), {
        signal: input.signal,
      });
      return found[0] ?? null;
    },
  };
}

/** "freight's" and "freight" are the same word to withhold. */
function bare(token: string): string {
  return token.replace(/['’]s$/u, "");
}

/** Undefined when no usable key is configured: answers go without pictures. */
export function createPexelsQPictures(
  apiKey: string | undefined,
  fetchImpl: typeof fetch = fetch,
): QPicturePort | undefined {
  return createQPictures(createPexelsPictureProvider(apiKey, fetchImpl));
}
