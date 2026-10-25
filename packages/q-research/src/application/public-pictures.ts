import { composeEgressQuery, namesShown } from "../domain/egress.js";
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
    /**
     * For a person: the organisation a public lookup placed them at. Public
     * already, so it may travel with their name; a picture's page may name
     * either (a company's page about its founder).
     */
    readonly organisation?: string | undefined;
    readonly userText: string;
    readonly earlierUserText?: readonly string[] | undefined;
    /**
     * What Q said to them earlier in this conversation: a name in it of
     * whom they pointed at may be searched (`namesShown`).
     */
    readonly shownText?: readonly string[] | undefined;
    readonly max?: number | undefined;
    readonly signal?: AbortSignal | undefined;
    /**
     * The run asking: one image search a run reaches the index (owner's
     * spend rule 2026-10-25); a second is answered from the cache or not
     * at all.
     */
    readonly runId?: string | undefined;
  }) => Promise<readonly PublicPicture[]>;
};

/** How long one entity's image results are kept, and how many entities. */
export const PICTURE_CACHE = { ttlMs: 6 * 60 * 60_000, max: 500 } as const;

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
  /(^|\.)(dribbble\.com|behance\.net|pinterest\.[a-z.]+|pin\.it|shutterstock\.com|istockphoto\.com|gettyimages\.[a-z.]+|alamy\.com|dreamstime\.com|depositphotos\.com|freepik\.com|vecteezy\.com|123rf\.com|stock\.adobe\.com|unsplash\.com|pexels\.com|pixabay\.com|canva\.com|google\.[a-z.]+|bing\.com|yandex\.[a-z.]+|duckduckgo\.com|logowik\.com|seeklogo\.com|worldvectorlogo\.com|brandfetch\.com|ftcdn\.net|rawpixel\.com|pngtree\.com|stocksy\.com|wallpapers\.com|wallpaperaccess\.com|softonic\.com|sftcdn\.net|apkpure\.com|uptodown\.com)$/u;

/** A title that is only an image's file name ("2298efc2-….jpg"). */
const FILENAME = /^[\w.-]+\.(jpe?g|png|webp|gif|avif)$/iu;

/** A page address as words: "/2022/09/zino-aviation-takes-off" → "zino aviation takes off". */
function addressWords(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname} ${parsed.pathname}`.replace(/[/._-]+/gu, " ");
  } catch {
    return "";
  }
}

/** A gallery, listing or search page rather than one about them. */
const SEARCH_PAGE =
  /\/(search|tags?|explore|images)(\/|\?|$)|[?&](q|query|search)=/iu;

/**
 * Which pictures to show first: the entity's own site, then reference and
 * professional pages (Wikipedia, LinkedIn), then everything else (news
 * and the rest), each in the index's order.
 */
/**
 * What a picture shows, as its title and addresses describe it, for its
 * place among the pictures of one site (owner 2026-10-24, QO-33: Zino
 * Aviation's own site gave a cabin-crew marketing shot first): their logo,
 * then their people, then their product, then anything else, and generic
 * marketing imagery last. It orders pictures already shown to be of them;
 * it never decides whether one is shown.
 */
const LOGO = /\b(?:logo|logos|logotype|wordmark|brandmark|emblem)\b/iu;
const PEOPLE =
  /\b(?:founders?|co-?founders?|ceo|cto|coo|chief|managing director|leadership|leaders|executives?|team|management|board|headshots?|portraits?)\b/iu;
const PRODUCT =
  /\b(?:products?|app|apps|platform|dashboard|screenshots?|device)\b/iu;
const GENERIC_MARKETING =
  /\b(?:banner|hero|slider|slide|background|bg|stock|welcome|crew|smiling|happy|lifestyle|placeholder|cover)\b/iu;

/** The image file's own path words ("/assets/img/crew-cabin-welcome.jpeg"). */
function imagePathWords(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname).replace(
      /[^\p{L}\p{N}]+/gu,
      " ",
    );
  } catch {
    return "";
  }
}

export function subjectRank(
  picture: Pick<PublicPicture, "imageUrl" | "title">,
): number {
  const described = `${picture.title} ${imagePathWords(picture.imageUrl)}`;
  if (LOGO.test(described)) return 0;
  if (PEOPLE.test(described)) return 1;
  if (GENERIC_MARKETING.test(described)) return 4;
  return PRODUCT.test(described) ? 2 : 3;
}

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
  readonly now?: (() => number) | undefined;
  readonly logger?:
    | {
        readonly warn: (
          fields: Readonly<Record<string, unknown>>,
          message: string,
        ) => void;
      }
    | undefined;
}): PublicPictureSearch {
  const now = input.now ?? Date.now;
  /**
   * Owner's spend rule 2026-10-25: an entity's image results are paid for
   * once in a while, not on every turn that names them. By the composed
   * query (the name as it leaves); failures are never kept.
   */
  const cache = new Map<
    string,
    { readonly at: number; readonly hits: readonly PublicImageHit[] }
  >();
  const searchedRuns = new Set<string>();
  const RUNS_MAX = 2_000;
  return {
    find: async ({
      name,
      organisation,
      userText,
      earlierUserText,
      shownText,
      max,
      signal,
      runId,
    }) => {
      const org = organisation?.trim() ?? "";
      const composed = composeEgressQuery({
        requestedQuery: org.length > 0 ? `${name} ${org}` : name,
        userText,
        earlierUserText,
        publicIdentity: org.length > 0 ? [org] : [],
        shownNames: namesShown([name], shownText),
      });
      // Only a name made wholly of the person's own words, or one Q showed
      // them and they pointed at, is searched.
      if (!composed.ok || composed.droppedTokens > 0) return [];
      const key = composed.query.toLowerCase();
      const kept = cache.get(key);
      let hits: readonly PublicImageHit[];
      if (kept !== undefined && now() - kept.at < PICTURE_CACHE.ttlMs) {
        hits = kept.hits;
      } else if (runId !== undefined && searchedRuns.has(runId)) {
        // This run already paid for its one image search.
        return [];
      } else {
        if (runId !== undefined) {
          if (searchedRuns.size >= RUNS_MAX) searchedRuns.clear();
          searchedRuns.add(runId);
        }
        try {
          hits = await input.provider.searchImages(composed.query, {
            signal,
          });
        } catch (error: unknown) {
          input.logger?.warn(
            { provider: input.provider.code, err: error },
            "public picture search failed; the answer goes without pictures",
          );
          return [];
        }
        cache.delete(key);
        if (cache.size >= PICTURE_CACHE.max) {
          const oldest = cache.keys().next().value;
          if (oldest !== undefined) cache.delete(oldest);
        }
        cache.set(key, { at: now(), hits });
      }
      const candidates: (PublicPicture & {
        readonly rank: number;
        readonly shows: number;
      })[] = [];
      const images = new Set<string>();
      for (const hit of hits) {
        const page = judgePublicUrl(hit.pageUrl);
        if (!page.ok) continue;
        // The page's title and its address both say whom it is about (live
        // 2026-10-23: a ThisDay photo had no title, the company's own
        // photos had filenames, while their addresses named them).
        const title = hit.title?.trim() ?? "";
        const about = `${title} ${addressWords(page.url)}`;
        if (!(
          textNamesEntity(name, about, page.domain) ||
          (org.length > 0 && textNamesEntity(org, about, page.domain))
        )) {
          continue;
        }
        const image = https(hit.imageUrl) ?? https(hit.thumbnailUrl);
        if (!page.url.startsWith("https://") || image === null) continue;
        if (NOT_OF_THEM.test(page.domain) || SEARCH_PAGE.test(page.url)) {
          continue;
        }
        const imageHost = judgePublicUrl(image);
        if (imageHost.ok && NOT_OF_THEM.test(imageHost.domain)) continue;
        // One showing of an image: the same photo on two of their sites
        // (live 2026-10-23: one Wix image on academy. and www. showed twice).
        const sameImage = image.split("?")[0] ?? image;
        if (images.has(sameImage)) continue;
        images.add(sameImage);
        const candidate = {
          imageUrl: image,
          pageUrl: page.url,
          domain: page.domain,
          // A filename or no title is no description of the picture.
          title: (FILENAME.test(title) || title.length === 0
            ? `${org.length > 0 ? org : name}, from ${page.domain}`
            : title
          ).slice(0, 200),
          rank: preference(page.domain, org.length > 0 ? org : name),
        };
        // One picture a site, its best: their logo or people before a
        // marketing shot (QO-33), the search's order otherwise.
        const shows = subjectRank({ ...candidate, title });
        const same = candidates.findIndex(
          (known) => known.domain === page.domain,
        );
        if (same < 0) candidates.push({ ...candidate, shows });
        else if (shows < (candidates[same]?.shows ?? Infinity)) {
          candidates[same] = { ...candidate, shows };
        }
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
