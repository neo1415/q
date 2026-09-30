import { COUNTRY_OPTIONS, STAGE_OPTIONS } from "@capital-q/founder-onboarding";

/**
 * A company's declared stage and country in the words the founder chose
 * them by. Codes never reach a reader as codes ("pre_seed", "NG"); the
 * labels come from the same definition the founder answered against.
 */

const STAGE_LABELS: ReadonlyMap<string, string> = new Map(
  STAGE_OPTIONS.map((option) => [option.optionKey, option.label]),
);
const COUNTRY_LABELS: ReadonlyMap<string, string> = new Map(
  COUNTRY_OPTIONS.map((option) => [option.optionKey, option.label]),
);

export function stageLabel(code: string | null): string | null {
  return code === null
    ? null
    : (STAGE_LABELS.get(code) ?? code.replace(/_/g, " "));
}

/** Option keys are lowercase ISO codes; companies store them uppercase. */
export function countryLabel(code: string | null): string | null {
  if (code === null) return null;
  const listed = COUNTRY_LABELS.get(code.toLowerCase());
  if (listed !== undefined) return listed;
  // A country outside the short list (kept in the person's words, stored
  // as its ISO code) is named by the platform's region names.
  try {
    return (
      new Intl.DisplayNames(["en"], { type: "region" }).of(
        code.toUpperCase(),
      ) ?? code
    );
  } catch {
    return code;
  }
}
