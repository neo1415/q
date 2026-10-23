import {
  isResearchProviderFailure,
  type PublicWebResearchProvider,
  type ResearchProviderFailure,
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
 * switches to SerpApi when Serper refuses the key or cannot read the
 * request with it (never on a spent account), and keeps whichever
 * answered. A key the vendor refuses in both places fails as it would
 * anywhere. Once an answer has confirmed a vendor, it is never re-guessed.
 */
/**
 * A failure that may only mean the key belongs to the other vendor: a
 * refusal, or (production 2026-10-23) Serper's 400 to a request it could
 * not read with that key. A spent account is not one of them.
 */
function wrongVendor(error: ResearchProviderFailure): boolean {
  return (
    error.status !== 402 &&
    (error.failureClass === "AUTHENTICATION" ||
      error.failureClass === "VALIDATION")
  );
}

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
          !wrongVendor(error) ||
          active + 1 >= candidates.length
        ) {
          throw error;
        }
        active += 1;
        try {
          const result = await current().search(request, context);
          confirmed = true;
          return result;
        } catch (second: unknown) {
          // The other vendor refusing the key says it was not theirs: what
          // the first one said (no credit, say) is the truth to report, and
          // the first stays the one asked.
          if (
            isResearchProviderFailure(second) &&
            second.failureClass === "AUTHENTICATION"
          ) {
            active -= 1;
            throw error;
          }
          throw second;
        }
      }
    },
    extract: (request, context) => current().extract(request, context),
  };
}
