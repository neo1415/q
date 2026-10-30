import { STAGE_OPTIONS } from "@capital-q/founder-onboarding";
import { countryName } from "@capital-q/taxonomy/countries";

/**
 * A company's declared stage and country in the words the founder chose
 * them by. Codes never reach a reader as codes ("pre_seed", "NG"); the
 * labels come from the same definition the founder answered against.
 */

const STAGE_LABELS: ReadonlyMap<string, string> = new Map(
  STAGE_OPTIONS.map((option) => [option.optionKey, option.label]),
);

export function stageLabel(code: string | null): string | null {
  return code === null
    ? null
    : (STAGE_LABELS.get(code) ?? code.replace(/_/g, " "));
}

/** A stored ISO code by its name in the one canonical country list. */
export function countryLabel(code: string | null): string | null {
  if (code === null) return null;
  return countryName(code) ?? code;
}
