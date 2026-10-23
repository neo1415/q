import { FitProfileDtoSchema } from "@capital-q/contracts";

/**
 * Owner QA I7 (23 Oct 2026, runs 4bee6070 and ec2d3741): "Does my cheque
 * fit Ajopot's round?" (EUR cheque, NGN round) was answered from the
 * profile's words, "I can't confirm without an exchange rate": fit_profile
 * was never called, so the dated FX estimate Capital Q computes never
 * reached the answer. A cheque question about a named company reads that
 * company's computed fit first, and its cheque row is the fact.
 */

const ASKS_CHEQUE =
  /\b(?:cheques?|checks?|tickets?|ticket\s+size|check\s+size|cheque\s+size|allocation|how\s+much\s+(?:can|could|should)\s+I\s+(?:put|invest|write))\b/iu;
const ASKS_FIT =
  /\b(?:fit|fits|within|match|matches|work|works|compatible|too\s+(?:big|small|large)|enough|room|size)\b/iu;

/** They ask whether their cheque fits a company's round. */
export function asksChequeFit(text: string): boolean {
  return ASKS_CHEQUE.test(text) && ASKS_FIT.test(text);
}

/**
 * The cheque row of a computed fit, as one fact: its outcome, its
 * template reason (an estimate says its rate and date), and the declared
 * amounts beside it. Null when the outcome is not a fit profile.
 */
export function chequeFitStatement(name: string, data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  if (Reflect.get(data, "status") !== "OK") return null;
  const profile = FitProfileDtoSchema.safeParse(Reflect.get(data, "profile"));
  if (!profile.success) return null;
  const row = profile.data.parameters.find(
    (parameter) => parameter.parameter === "CHEQUE_SIZE",
  );
  if (row === undefined) return null;
  const context =
    row.context === undefined ? "" : ` ${JSON.stringify(row.context)}`;
  const estimate =
    row.estimate === undefined
      ? ""
      : ` This is an ESTIMATE across currencies, at the ${
          row.estimate.method === "ECB_REFERENCE_RATE"
            ? "ECB reference rate"
            : "market rate"
        } of ${row.estimate.rateDate}: say "approximately" and the rate's date, never exact.`;
  return `CHEQUE FIT FOR ${name} (computed by Capital Q just now from their declared cheque and the round ${name} shares with them): ${row.outcome}. ${row.reason}${estimate}${context} Lead the answer with this result. Never say an exchange rate is missing when an estimate is given here.`.slice(
    0,
    1_500,
  );
}
