import {
  RESULTS_PATH,
  ResultsDtoSchema,
  type ResultsQuery,
} from "@capital-q/contracts";

import { call, type ApiSession } from "./request.js";

/** The person's own results for a range (spec §5). */
export function getResults(
  session: ApiSession,
  query: Omit<ResultsQuery, "format">,
) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === "string" && value.length > 0) search.set(key, value);
  }
  const text = search.toString();
  return call(
    session,
    "GET",
    `${RESULTS_PATH}${text.length === 0 ? "" : `?${text}`}`,
    ResultsDtoSchema,
  );
}
