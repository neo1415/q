import { RESEARCH_BOUNDS } from "../contracts.js";
import { judgePublicUrl } from "../domain/url-safety.js";
import {
  ResearchProviderFailure,
  type PublicWebResearchProvider,
} from "../ports.js";
import { createVettedHttp, type VettedHttp } from "../vetted-http.js";
import { htmlToText } from "./scrapingbee.js";

/**
 * Reading a public page ourselves (23 Oct 2026: every paid reader in
 * production was out of credit or refused, so Q answered from one-line
 * snippets). Only the pages a search already surfaced reach here, through
 * the research service's own choice; each is fetched by the vetted client
 * (every resolved address public, every redirect vetted again, time and
 * size capped), side by side, and reduced to its visible text. It reads
 * no page behind a sign-in: it sends no cookies and no credentials, so a
 * page that needs them returns its sign-in wall, which is no source.
 * It does not search.
 */

const MAX_BYTES = 1_500_000;

export function createDirectPageReader(
  options: { readonly http?: VettedHttp | undefined } = {},
): PublicWebResearchProvider {
  const http = options.http ?? createVettedHttp({ timeoutMs: 6_000 });
  return {
    code: "direct",
    canSearch: false,
    search: () =>
      Promise.reject(
        new ResearchProviderFailure({
          providerCode: "direct",
          failureClass: "VALIDATION",
        }),
      ),
    extract: async (request, context) => {
      const started = Date.now();
      const urls = request.urls
        .filter((url) => judgePublicUrl(url).ok)
        .slice(0, RESEARCH_BOUNDS.maxExtractCount);
      const read = await Promise.all(
        urls.map(async (url) => {
          if (context.signal?.aborted === true) return { url, page: null };
          const response = await http
            .get(url, {
              accept: "text/html,application/xhtml+xml",
              maxBytes: MAX_BYTES,
            })
            .catch(() => null);
          if (
            response === null ||
            !/html|xml|text\/plain/iu.test(response.contentType)
          ) {
            return { url, page: null };
          }
          const parsed = htmlToText(
            new TextDecoder("utf-8", { fatal: false }).decode(response.body),
          );
          // A sign-in wall or an empty shell is not a page about anyone.
          if (
            parsed.text.length < 200 ||
            SIGN_IN_WALL.test(parsed.title ?? "")
          ) {
            return { url, page: null };
          }
          return { url, page: { url, title: parsed.title, text: parsed.text } };
        }),
      );
      const pages = read.flatMap((entry) =>
        entry.page === null ? [] : [entry.page],
      );
      if (pages.length === 0) {
        throw new ResearchProviderFailure({
          providerCode: "direct",
          failureClass: "UNAVAILABLE",
        });
      }
      return {
        pages,
        failedUrls: read
          .filter((entry) => entry.page === null)
          .map((entry) => entry.url),
        latencyMs: Math.max(0, Date.now() - started),
      };
    },
  };
}

/** Titles of pages that only ask to sign in. */
const SIGN_IN_WALL =
  /^(sign in|log in|login|sign up|join linkedin|linkedin: log in|access denied|just a moment)/iu;
