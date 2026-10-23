import {
  createPexelsPictureProvider,
  type StockPictureProvider,
} from "@capital-q/model-gateway/images/stock";
import type {
  QPicturePort,
  QPublicPicturePort,
} from "@capital-q/model-gateway/q";
import {
  composeEgressQuery,
  createPublicPictureSearch,
  isConnective,
  tokenise,
} from "@capital-q/q-research";
import { createBraveImageSearch } from "@capital-q/q-research/providers/brave";
import {
  createDetectingImageSearch,
  createMergedImageSearch,
} from "@capital-q/q-research/providers/images";

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

/**
 * Owner 2026-10-23: pictures of the company or person a turn names, from
 * public pages, through the image results of the indexes the web search
 * already uses (the SERP key, and Brave beside it). Unlike a stock
 * illustration this search is about them, so it carries their name -- the
 * same name, through the same egress policy, that the turn's web search
 * already sends to the same vendors. Undefined without a usable key:
 * answers go without these pictures.
 */
export function createPublicQPictures(
  keys: {
    readonly serp?: string | undefined;
    readonly brave?: string | undefined;
  },
  logger?: {
    readonly warn: (
      fields: Readonly<Record<string, unknown>>,
      message: string,
    ) => void;
  },
  fetchImpl: typeof fetch = fetch,
): QPublicPicturePort | undefined {
  const usable = (key: string | undefined): string | null => {
    const trimmed = key?.trim();
    return trimmed === undefined ||
      trimmed.length < 16 ||
      trimmed.startsWith("disabled")
      ? null
      : trimmed;
  };
  const serp = usable(keys.serp);
  const brave = usable(keys.brave);
  const providers = [
    ...(serp === null
      ? []
      : [createDetectingImageSearch({ apiKey: serp, fetch: fetchImpl })]),
    ...(brave === null
      ? []
      : [createBraveImageSearch({ apiKey: brave, fetch: fetchImpl })]),
  ];
  if (providers.length === 0) return undefined;
  const search = createPublicPictureSearch({
    provider:
      providers.length === 1 && providers[0] !== undefined
        ? providers[0]
        : createMergedImageSearch(providers),
    ...(logger === undefined ? {} : { logger }),
  });
  return { find: (input) => search.find(input) };
}
