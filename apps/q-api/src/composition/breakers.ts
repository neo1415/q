import {
  createCircuitBreaker,
  createDailyCallCap,
  researchDailyCallsFrom,
  type CircuitBreaker,
  type DailyCallCap,
} from "@capital-q/q-research/providers/breaker";

/**
 * One circuit breaker per research credential, for the process (production
 * 2026-10-25: spent keys were asked ~12 times a turn). The web indexes and
 * the picture search take theirs by the credential's name, so the SERP
 * key's web and image searches (and Brave's) rest together. Named by the
 * environment variable's role, never by the key.
 */
export type ResearchCredential =
  | "brightdata"
  | "tavily"
  | "serp"
  | "serper"
  | "brave"
  | "scrapingbee"
  | "direct";

type Warn = (
  fields: Readonly<Record<string, unknown>>,
  message: string,
) => void;

const breakers = new Map<ResearchCredential, CircuitBreaker>();

export function credentialBreaker(
  credential: ResearchCredential,
  warn?: Warn,
): CircuitBreaker {
  const known = breakers.get(credential);
  if (known !== undefined) return known;
  const breaker = createCircuitBreaker({
    onTrip: (trip) =>
      warn?.(
        { ...trip, credential },
        "public research provider resting: its key was refused or its credit is spent",
      ),
  });
  breakers.set(credential, breaker);
  return breaker;
}

const dailyCaps = new Map<ResearchCredential, DailyCallCap>();

/**
 * Launch readiness 8: one daily call ceiling per paid research credential,
 * for the process (`CQ_RESEARCH_DAILY_CALLS`), shared like its breaker.
 * Reaching it is one `alert: "RESEARCH_DAILY_CAP"` line a day.
 */
export function credentialDailyCap(
  credential: ResearchCredential,
  report?: Warn,
): DailyCallCap {
  const known = dailyCaps.get(credential);
  if (known !== undefined) return known;
  const cap = createDailyCallCap({
    limit: researchDailyCallsFrom(process.env),
    onCapReached: (limit) =>
      report?.(
        { alert: "RESEARCH_DAILY_CAP", credential, limit },
        "public research credential reached its daily call cap; refused until 00:00 UTC",
      ),
  });
  dailyCaps.set(credential, cap);
  return cap;
}
