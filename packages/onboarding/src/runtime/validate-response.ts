import {
  ContractValidationError,
  OnboardingResponseInputSchema,
  type OnboardingResponseInput,
  type OnboardingResponseType,
  type OnboardingSourceModality,
  type OnboardingStepType,
  type ValidationIssue,
} from "@capital-q/contracts";

import type {
  OnboardingStepDefinition,
  ValidatedOnboardingResponse,
} from "../contracts/index.js";

/**
 * Authoritative response validation against the exact pinned step
 * definition: response type compatibility, option membership, selection
 * bounds, text bounds, exact-decimal range bounds, resource-type allowlist
 * and confirmation semantics. Frontend validation is UX; this is the rule.
 * Unknown stays unknown: nothing here defaults a missing answer.
 */

const RESPONSE_TYPE_FOR_STEP: Record<
  OnboardingStepType,
  OnboardingResponseType
> = {
  single_select: "SINGLE_SELECT",
  multi_select: "MULTI_SELECT",
  range: "RANGE",
  short_text: "TEXT",
  long_text: "TEXT",
  voice_text: "TEXT",
  document_upload: "RESOURCE_REFERENCE",
  confirmation: "CONFIRMATION",
  reference_select: "RESOURCE_REFERENCE",
};

/** Steps whose answer may also be the person's own words ("Other: ..."). */
const OWN_WORDS_STEP_TYPES: ReadonlySet<OnboardingStepType> = new Set([
  "single_select",
  "multi_select",
  "range",
  "reference_select",
]);
/** The longest own-words answer to a choice, number or category question. */
export const OWN_WORDS_MAX = 500;

/** Whether a response is the person's own words on a structured step. */
export function isOwnWordsAnswer(
  stepType: OnboardingStepType,
  responseType: OnboardingResponseType,
): boolean {
  return responseType === "TEXT" && OWN_WORDS_STEP_TYPES.has(stepType);
}

const ALLOWED_MODALITIES: Record<
  OnboardingResponseType,
  readonly OnboardingSourceModality[]
> = {
  SINGLE_SELECT: ["SELECTION"],
  MULTI_SELECT: ["SELECTION"],
  RANGE: ["SELECTION", "TYPED_TEXT"],
  TEXT: ["TYPED_TEXT", "VOICE_TRANSCRIPT"],
  RESOURCE_REFERENCE: ["DOCUMENT_REFERENCE", "SELECTION"],
  CONFIRMATION: ["SELECTION"],
};

export function expectedResponseType(
  stepType: OnboardingStepType,
): OnboardingResponseType {
  return RESPONSE_TYPE_FOR_STEP[stepType];
}

/** Exact decimal comparison without floats: returns sign of a - b. */
export function compareDecimal(a: string, b: string): number {
  const parse = (value: string) => {
    const negative = value.startsWith("-");
    const [whole = "0", fraction = ""] = (
      negative ? value.slice(1) : value
    ).split(".");
    return { negative, whole, fraction };
  };
  const x = parse(a);
  const y = parse(b);
  const scale = Math.max(x.fraction.length, y.fraction.length);
  const toBig = (p: { negative: boolean; whole: string; fraction: string }) => {
    const digits = BigInt(`${p.whole}${p.fraction.padEnd(scale, "0")}`);
    return p.negative ? -digits : digits;
  };
  const left = toBig(x);
  const right = toBig(y);
  return left === right ? 0 : left < right ? -1 : 1;
}

function issue(path: string, code: string, message: string): ValidationIssue {
  return { path, code, message };
}

export type ValidateResponseOptions = {
  /** Runtime-only modalities (suggestion accept/edit) override the client's declaration. */
  readonly sourceModality?: OnboardingSourceModality | undefined;
};

export function validateOnboardingResponse(
  step: OnboardingStepDefinition,
  rawInput: unknown,
  options: ValidateResponseOptions = {},
): ValidatedOnboardingResponse {
  const parsed = OnboardingResponseInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ContractValidationError(
      "The onboarding response is not valid.",
      parsed.error.issues.map((i) => ({
        path: i.path.map(String).join("."),
        code: i.code,
        message: i.message,
      })),
    );
  }
  const input: OnboardingResponseInput = parsed.data;
  const issues: ValidationIssue[] = [];
  const expected = expectedResponseType(step.stepType);
  const { value } = input;

  // Their own words are an answer to any question that asks for a choice,
  // a number or a category, as ticking "Other" and typing is on a form
  // (owner 2026-10-16: every fact a person gives is saved). Kept verbatim
  // as TEXT; nothing structured is inferred from it here.
  // A taxonomy step holds taxonomy nodes only (live 2026-10-31,
  // "Tidevand": a rambling sentence was saved as the sector and read back
  // as "Sector: basically fishing boats…"). Words no category holds are
  // never its value; they may sit beside the categories as a note.
  if (
    value.type === "TEXT" &&
    step.configuration.stepType === "reference_select" &&
    step.configuration.resourceType === "TAXONOMY_NODE"
  ) {
    throw new ContractValidationError("The onboarding response is not valid.", [
      issue(
        "value.type",
        "taxonomy_nodes_only",
        `Step ${step.stepKey} holds categories only; words are kept as a note beside them.`,
      ),
    ]);
  }
  const ownWords =
    value.type === "TEXT" && OWN_WORDS_STEP_TYPES.has(step.stepType);
  const responseType: OnboardingResponseType = ownWords ? "TEXT" : expected;
  if (value.type !== expected && !ownWords) {
    throw new ContractValidationError("The onboarding response is not valid.", [
      issue(
        "value.type",
        "response_type_mismatch",
        `Step ${step.stepKey} expects a ${expected} response.`,
      ),
    ]);
  }

  const configuration = step.configuration;
  switch (value.type) {
    case "SINGLE_SELECT": {
      if (
        configuration.stepType === "single_select" &&
        !configuration.options.some((o) => o.optionKey === value.optionKey)
      ) {
        issues.push(
          issue("value.optionKey", "unknown_option", "Unknown option."),
        );
      }
      break;
    }
    case "MULTI_SELECT": {
      if (configuration.stepType === "multi_select") {
        const known = new Set(configuration.options.map((o) => o.optionKey));
        for (const key of value.optionKeys) {
          if (!known.has(key)) {
            issues.push(
              issue(
                "value.optionKeys",
                "unknown_option",
                `Unknown option ${key}.`,
              ),
            );
          }
        }
        if (value.optionKeys.length < configuration.minSelections) {
          issues.push(
            issue(
              "value.optionKeys",
              "too_few_selections",
              `Select at least ${configuration.minSelections}.`,
            ),
          );
        }
        if (value.optionKeys.length > configuration.maxSelections) {
          issues.push(
            issue(
              "value.optionKeys",
              "too_many_selections",
              `Select at most ${configuration.maxSelections}.`,
            ),
          );
        }
        const exclusive = value.optionKeys.filter((key) =>
          configuration.exclusiveOptionKeys.includes(key),
        );
        if (exclusive.length > 0 && value.optionKeys.length > 1) {
          issues.push(
            issue(
              "value.optionKeys",
              "exclusive_option",
              "An exclusive option cannot be combined.",
            ),
          );
        }
      }
      break;
    }
    case "RANGE": {
      if (configuration.stepType === "range") {
        if (compareDecimal(value.value, configuration.min) < 0) {
          issues.push(
            issue(
              "value.value",
              "below_minimum",
              `Minimum is ${configuration.min}.`,
            ),
          );
        }
        if (compareDecimal(value.value, configuration.max) > 0) {
          issues.push(
            issue(
              "value.value",
              "above_maximum",
              `Maximum is ${configuration.max}.`,
            ),
          );
        }
      }
      break;
    }
    case "TEXT": {
      const length = value.text.trim().length;
      if (
        configuration.stepType === "short_text" ||
        configuration.stepType === "long_text"
      ) {
        if (length < configuration.minLength) {
          issues.push(
            issue(
              "value.text",
              "too_short",
              `At least ${configuration.minLength} characters.`,
            ),
          );
        }
        if (length > configuration.maxLength) {
          issues.push(
            issue(
              "value.text",
              "too_long",
              `At most ${configuration.maxLength} characters.`,
            ),
          );
        }
      } else if (ownWords) {
        if (length < 1 || length > OWN_WORDS_MAX) {
          issues.push(
            issue(
              "value.text",
              length < 1 ? "too_short" : "too_long",
              `Between 1 and ${String(OWN_WORDS_MAX)} characters.`,
            ),
          );
        }
      } else if (
        configuration.stepType === "voice_text" &&
        length > configuration.maxLength
      ) {
        issues.push(
          issue(
            "value.text",
            "too_long",
            `At most ${configuration.maxLength} characters.`,
          ),
        );
      }
      break;
    }
    case "RESOURCE_REFERENCE": {
      if (configuration.stepType === "reference_select") {
        if (configuration.resourceType !== value.resourceType) {
          issues.push(
            issue(
              "value.resourceType",
              "resource_type_not_allowed",
              "Resource type not allowed.",
            ),
          );
        }
        if (value.resourceIds.length < configuration.minItems) {
          issues.push(
            issue(
              "value.resourceIds",
              "too_few_items",
              `At least ${configuration.minItems} items.`,
            ),
          );
        }
        if (value.resourceIds.length > configuration.maxItems) {
          issues.push(
            issue(
              "value.resourceIds",
              "too_many_items",
              `At most ${configuration.maxItems} items.`,
            ),
          );
        }
      }
      if (configuration.stepType === "document_upload") {
        if (!configuration.allowedResourceTypes.includes(value.resourceType)) {
          issues.push(
            issue(
              "value.resourceType",
              "resource_type_not_allowed",
              "Resource type not allowed.",
            ),
          );
        }
        if (value.resourceIds.length < configuration.minItems) {
          issues.push(
            issue(
              "value.resourceIds",
              "too_few_items",
              `At least ${configuration.minItems} items.`,
            ),
          );
        }
        if (value.resourceIds.length > configuration.maxItems) {
          issues.push(
            issue(
              "value.resourceIds",
              "too_many_items",
              `At most ${configuration.maxItems} items.`,
            ),
          );
        }
      }
      break;
    }
    case "CONFIRMATION": {
      if (
        configuration.stepType === "confirmation" &&
        configuration.requireAffirmative &&
        !value.confirmed
      ) {
        issues.push(
          issue(
            "value.confirmed",
            "confirmation_required",
            "This step needs an explicit confirmation.",
          ),
        );
      }
      break;
    }
  }

  const allowed = ALLOWED_MODALITIES[responseType];
  const defaultModality =
    step.stepType === "voice_text"
      ? "VOICE_TRANSCRIPT"
      : ownWords
        ? "TYPED_TEXT"
        : step.stepType === "reference_select"
          ? "SELECTION"
          : allowed[0];
  let sourceModality: OnboardingSourceModality;
  if (options.sourceModality !== undefined) {
    sourceModality = options.sourceModality;
  } else if (input.sourceModality === undefined) {
    sourceModality = defaultModality ?? "SELECTION";
  } else if (allowed.includes(input.sourceModality)) {
    sourceModality = input.sourceModality;
  } else {
    issues.push(
      issue(
        "sourceModality",
        "modality_not_allowed",
        "This modality does not fit the step.",
      ),
    );
    sourceModality = defaultModality ?? "SELECTION";
  }

  if (issues.length > 0) {
    throw new ContractValidationError(
      "The onboarding response is not valid.",
      issues,
    );
  }

  return {
    stepKey: step.stepKey,
    responseType,
    value,
    rawText: value.type === "TEXT" ? value.text : null,
    note: input.note ?? null,
    sourceModality,
    channel: input.channel ?? null,
  };
}
