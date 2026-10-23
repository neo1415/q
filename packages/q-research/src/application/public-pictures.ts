import { composeEgressQuery } from "../domain/egress.js";
import { textNamesEntity } from "../domain/names.js";
import { judgePublicUrl } from "../domain/url-safety.js";
import type { ResearchExecutionContext } from "../ports.js";

/**
 * Pictures of a named company or person from public pages (owner
 * 2026-10-23: "if we're talking about somebody, find their picture … or
 * pictures of their company … smooth and fast, not excuses").
 *
 * An image index's results (Google Images through the configured SERP key)
 * are public pages' own images: a news interview's photograph, a company's
 * logo or site. Only the name the person said leaves Capital Q, through
 * the same egress policy as a web search. A picture is kept only when the
 * page it comes from names every word of that name, and only with that
 * page, so it is always shown as "from <site>" -- what a public page shows,
 * never a verified identity. Nothing found is no picture, never an error.
 */

export type PublicImageHit = {
  /** The image itself. */
  readonly imageUrl: string;
  /** A smaller copy the index serves, when it gives one. */
  readonly thumbnailUrl: string | null;
  /** The page the image appears on. */
  readonly pageUrl: string;
  /** That page's title. */
  readonly title: string | null;
};

export type PublicImageSearchProvider = {
  readonly code: string;
  readonly searchImages: (
    query: string,
    context: ResearchExecutionContext,
  ) => Promise<readonly PublicImageHit[]>;
};

export type PublicPicture = {
  readonly imageUrl: string;
  readonly pageUrl: string;
  /** The page's site, as shown: "nairametrics.com". */
  readonly domain: string;
  readonly title: string;
};

export type PublicPictureSearch = {
  readonly find: (input: {
    /** The company or person, as the person named them. */
    readonly name: string;
    readonly userText: string;
    readonly earlierUserText?: readonly string[] | undefined;
    readonly max?: number | undefined;
    readonly signal?: AbortSignal | undefined;
  }) => Promise<readonly PublicPicture[]>;
};

const DEFAULT_MAX = 2;

const https = (url: string | null): string | null => {
  if (url === null) return null;
  const verdict = judgePublicUrl(url);
  return verdict.ok && verdict.url.startsWith("https://") ? verdict.url : null;
};

/**
 * Sites whose pictures are not of the company or person (production
 * 2026-10-23: "latest news on Flutterwave" showed Dribbble design shots):
 * design galleries, stock libraries, pin boards and search pages.
 */
const NOT_OF_THEM =
  /(^|\.)(dribbble\.com|behance\.net|pinterest\.[a-z.]+|pin\.it|shutterstock\.com|istockphoto\.com|gettyimages\.[a-z.]+|alamy\.com|dreamstime\.com|depositphotos\.com|freepik\.com|vecteezy\.com|123rf\.com|stock\.adobe\.com|unsplash\.com|pexels\.com|pixabay\.com|canva\.com|google\.[a-z.]+|bing\.com|yandex\.[a-z.]+|duckduckgo\.com|logowik\.com|seeklogo\.com|worldvectorlogo\.com|brandfetch\.com)$/u;

/** A gallery, listing or search page rather than one about them. */
const SEARCH_PAGE =
  /\/(search|tags?|explore|images)(\/|\?|$)|[?&](q|query|search)=/iu;

/**
 * Which pictures to show first: the entity's own site, then reference and
 * professional pages (Wikipedia, LinkedIn), then everything else (news
 * and the rest), each in the index's order.
 */
function preference(domain: string, name: string): number {
  if (textNamesEntity(name, "", domain)) return 0;
  if (
    /(^|\.)(wikipedia\.org|wikimedia\.org|linkedin\.com|licdn\.com)$/u.test(
      domain,
    )
  ) {
    return 1;
  }
  return 2;
}

export function createPublicPictureSearch(input: {
  readonly provider: PublicImageSearchProvider;
  readonly logger?:
    | {
        readonly warn: (
          fields: Readonly<Record<string, unknown>>,
          message: string,
        ) => void;
      }
    | undefined;
}): PublicPictureSearch {
  return {
    find: async ({ name, userText, earlierUserText, max, signal }) => {
      const composed = composeEgressQuery({
        requestedQuery: name,
        userText,
        earlierUserText,
        publicIdentity: [],
      });
      // Only a name made wholly of the person's own words is searched.
      if (!composed.ok || composed.droppedTokens > 0) return [];
      let hits: readonly PublicImageHit[];
      try {
        hits = await input.provider.searchImages(composed.query, { signal });
      } catch (error: unknown) {
        input.logger?.warn(
          { provider: input.provider.code, err: error },
          "public picture search failed; the answer goes without pictures",
        );
        return [];
      }
      const candidates: (PublicPicture & { readonly rank: number })[] = [];
      const pages = new Set<string>();
      for (const hit of hits) {
        const title = hit.title?.trim() ?? "";
        if (title.length === 0 || !textNamesEntity(name, title)) continue;
        const page = judgePublicUrl(hit.pageUrl);
        const image = https(hit.imageUrl) ?? https(hit.thumbnailUrl);
        if (!page.ok || !page.url.startsWith("https://") || image === null) {
          continue;
        }
        if (NOT_OF_THEM.test(page.domain) || SEARCH_PAGE.test(page.url)) {
          continue;
        }
        const imageHost = judgePublicUrl(image);
        if (imageHost.ok && NOT_OF_THEM.test(imageHost.domain)) continue;
        // One picture a site: two from the same page say the same thing.
        if (pages.has(page.domain)) continue;
        pages.add(page.domain);
        candidates.push({
          imageUrl: image,
          pageUrl: page.url,
          domain: page.domain,
          title: title.slice(0, 200),
          rank: preference(page.domain, name),
        });
      }
      return candidates
        .map((candidate, order) => ({ candidate, order }))
        .sort(
          (a, b) => a.candidate.rank - b.candidate.rank || a.order - b.order,
        )
        .slice(0, max ?? DEFAULT_MAX)
        .map(({ candidate }) => ({
          imageUrl: candidate.imageUrl,
          pageUrl: candidate.pageUrl,
          domain: candidate.domain,
          title: candidate.title,
        }));
    },
  };
}
