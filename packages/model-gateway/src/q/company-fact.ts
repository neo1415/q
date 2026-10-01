import type { AuthorisedFact } from "@capital-q/q-core";

/**
 * The company on the person's screen, read for them before the model is
 * asked (speed sweep 2026-10-01). On Discover, "how does this company
 * compare with Kazikit?" was answered "the company currently on your
 * screen is not identified": the model looked up the other company and
 * not this one, and every question about the company in front of them
 * paid a tool round (~1.4 s) plus a second model call to learn its name.
 *
 * Built from get_company's output, read through the same tool and plan
 * the model would use, so a company the firewall did not admit is never
 * read. What the company declared about itself, said as such.
 */

type CompanyRead = {
  readonly canonicalName?: unknown;
  readonly legalName?: unknown;
  readonly websiteUrl?: unknown;
  readonly foundedDate?: unknown;
  readonly headquartersCountry?: unknown;
  readonly headquartersCity?: unknown;
  readonly currentStageCode?: unknown;
  readonly shortDescription?: unknown;
  readonly primaryDescription?: unknown;
  readonly relationToYou?: unknown;
};

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

export function onScreenCompanyFact(
  data: unknown,
  label = 'The company on their screen (the one they mean by "this company")',
): AuthorisedFact | null {
  if (typeof data !== "object" || data === null) return null;
  const read = data as CompanyRead;
  const name = text(read.canonicalName);
  if (name === null) return null;
  const where = [text(read.headquartersCity), text(read.headquartersCountry)]
    .filter((part): part is string => part !== null)
    .join(", ");
  const parts = [
    ...(text(read.currentStageCode) === null
      ? []
      : [`stage ${text(read.currentStageCode) ?? ""}`]),
    ...(where.length === 0 ? [] : [`based in ${where}`]),
    ...(text(read.foundedDate) === null
      ? []
      : [`founded ${text(read.foundedDate) ?? ""}`]),
    ...(text(read.websiteUrl) === null
      ? []
      : [`website ${text(read.websiteUrl) ?? ""}`]),
  ];
  const description =
    text(read.primaryDescription) ?? text(read.shortDescription);
  const own = read.relationToYou === "OWN";
  return {
    scope: "COMPANY_PROFILE",
    statement: `${own ? "Their own company" : label}: ${name}${
      parts.length === 0 ? "" : ` -- ${parts.join("; ")}`
    }.${description === null ? "" : ` As the company describes itself: ${description}`}`.slice(
      0,
      2_000,
    ),
    truthClass: "USER_CLAIM",
    evidenceStatus: "SELF_REPORTED",
    source: "Capital Q canonical company profile",
  };
}
