import {
  isResearchProviderFailure,
  type PublicWebResearchProvider,
} from "../ports.js";
import { createSerpApiResearchProvider } from "./serpapi.js";
import { createSerperResearchProvider } from "./serper.js";

/**
 * One Google-results key whose vendor is not known from its name.
 *
 * Production's `SERP_API_KEY` was configured with a Serper.dev key while the
 * adapter behind that name was SerpApi, so every call failed AUTHENTICATION
 * and search ran on one index (W2 live check, 2026-10-10). This provider
 * tries Serper.dev first (the vendor the key turned out to belong to),
 * switches to SerpApi on an authentication failure, and keeps whichever
 * answered. A key the vendor refuses in both places fails as it would
 * anywhere. Once an answer has confirmed a vendor, it is never re-guessed.
 */
export function createDetectingSerpProvider(options: {
  readonly apiKey: string;
  readonly fetch?: typeof globalThis.fetch | undefined;
  readonly timeoutMs?: number | undefined;
}): PublicWebResearchProvider {
  const candidates = [
    createSerperResearchProvider(options),
    createSerpApiResearchProvider(options),
  ];
  let active = 0;
  let confirmed = false;
  const current = (): PublicWebResearchProvider => {
    const provider = candidates[active];
    if (provider === undefined) throw new Error("no serp provider");
    return provider;
  };
  return {
    get code() {
      return current().code;
    },
    search: async (request, context) => {
      try {
        const result = await current().search(request, context);
        confirmed = true;
        return result;
      } catch (error: unknown) {
        if (
          confirmed ||
          !isResearchProviderFailure(error) ||
          error.failureClass !== "AUTHENTICATION" ||
          active + 1 >= candidates.length
        ) {
          throw error;
        }
        active += 1;
        const result = await current().search(request, context);
        confirmed = true;
        return result;
      }
    },
    extract: (request, context) => current().extract(request, context),
  };
}
