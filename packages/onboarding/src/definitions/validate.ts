import { OnboardingDefinitionInvalidError } from "../domain/errors.js";
import { branchDepth, referencedStepKeys } from "../runtime/branch.js";
import { compareDecimal } from "../runtime/validate-response.js";
import {
  BRANCH_MAX_DEPTH,
  OnboardingDefinitionManifestSchema,
  type BranchExpression,
  type BranchScalar,
  type OnboardingDefinitionManifest,
  type OnboardingStepManifest,
} from "./schema.js";

/**
 * Publication-time graph validation. Beyond the Zod shape: unique keys and
 * sequence, known phases, branch references to earlier steps only (no
 * cycles by construction), branch values that exist as options, bounded
 * depth, coherent configuration bounds and an unconditional first step so
 * every session has somewhere to begin. Errors name manifest step keys
 * only.
 */

function scalarsOf(expression: BranchExpression): {
  readonly stepKey: string;
  readonly value: BranchScalar;
}[] {
  switch (expression.op) {
    case "EQUALS":
    case "CONTAINS":
      return [{ stepKey: expression.stepKey, value: expression.value }];
    case "IN":
      return expression.values.map((value) => ({
        stepKey: expression.stepKey,
        value,
      }));
    case "ALL":
    case "ANY":
      return expression.expressions.flatMap(scalarsOf);
    case "NOT":
      return scalarsOf(expression.expression);
    case "EXISTS":
      return [];
  }
}

function validateConfiguration(
  step: OnboardingStepManifest,
  phaseKeys: ReadonlySet<string>,
  reasons: string[],
): void {
  const { configuration } = step;
  if (
    configuration.phaseKey !== undefined &&
    !phaseKeys.has(configuration.phaseKey)
  ) {
    reasons.push(
      `step ${step.stepKey} references unknown phase ${configuration.phaseKey}`,
    );
  }
  switch (configuration.stepType) {
    case "multi_select": {
      if (configuration.minSelections > configuration.maxSelections) {
        reasons.push(
          `step ${step.stepKey}: minSelections exceeds maxSelections`,
        );
      }
      if (configuration.minSelections > configuration.options.length) {
        reasons.push(
          `step ${step.stepKey}: minSelections exceeds the option count`,
        );
      }
      const known = new Set(configuration.options.map((o) => o.optionKey));
      for (const key of configuration.exclusiveOptionKeys) {
        if (!known.has(key)) {
          reasons.push(
            `step ${step.stepKey}: exclusive option ${key} is not an option`,
          );
        }
      }
      break;
    }
    case "range": {
      if (compareDecimal(configuration.min, configuration.max) >= 0) {
        reasons.push(`step ${step.stepKey}: range min must be below max`);
      }
      if (
        configuration.step !== undefined &&
        compareDecimal(configuration.step, "0") <= 0
      ) {
        reasons.push(`step ${step.stepKey}: range step must be positive`);
      }
      break;
    }
    case "short_text":
    case "long_text": {
      if (configuration.minLength > configuration.maxLength) {
        reasons.push(`step ${step.stepKey}: minLength exceeds maxLength`);
      }
      break;
    }
    case "document_upload":
    case "reference_select": {
      if (configuration.minItems > configuration.maxItems) {
        reasons.push(`step ${step.stepKey}: minItems exceeds maxItems`);
      }
      break;
    }
    case "single_select":
    case "voice_text":
    case "confirmation":
      break;
  }
}

function optionKeysOf(
  step: OnboardingStepManifest,
): ReadonlySet<string> | null {
  const { configuration } = step;
  return configuration.stepType === "single_select" ||
    configuration.stepType === "multi_select"
    ? new Set(configuration.options.map((o) => o.optionKey))
    : null;
}

export function validateOnboardingManifest(
  raw: unknown,
): OnboardingDefinitionManifest {
  const parsed = OnboardingDefinitionManifestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new OnboardingDefinitionInvalidError(
      parsed.error.issues.map(
        (i) => `${i.path.map(String).join(".") || "manifest"}: ${i.message}`,
      ),
    );
  }
  const manifest = parsed.data;
  const reasons: string[] = [];
  const phaseKeys = new Set(manifest.schema.phases.map((p) => p.phaseKey));
  const steps = [...manifest.steps].sort(
    (a, b) => a.sequenceOrder - b.sequenceOrder,
  );

  const byKey = new Map<string, OnboardingStepManifest>();
  const sequences = new Set<number>();
  for (const step of steps) {
    if (byKey.has(step.stepKey)) {
      reasons.push(`duplicate step key ${step.stepKey}`);
    }
    byKey.set(step.stepKey, step);
    if (sequences.has(step.sequenceOrder)) {
      reasons.push(`duplicate sequence order ${step.sequenceOrder}`);
    }
    sequences.add(step.sequenceOrder);
    validateConfiguration(step, phaseKeys, reasons);
  }

  const first = steps[0];
  if (first !== undefined && first.branching !== null) {
    reasons.push(`first step ${first.stepKey} must not branch`);
  }

  for (const step of steps) {
    if (step.branching === null) {
      continue;
    }
    if (branchDepth(step.branching) > BRANCH_MAX_DEPTH) {
      reasons.push(`step ${step.stepKey}: branch expression too deep`);
    }
    for (const referenced of referencedStepKeys(step.branching)) {
      const target = byKey.get(referenced);
      if (target === undefined) {
        reasons.push(
          `step ${step.stepKey} branches on unknown step ${referenced}`,
        );
      } else if (target.sequenceOrder >= step.sequenceOrder) {
        reasons.push(
          `step ${step.stepKey} branches on ${referenced}, which is not an earlier step`,
        );
      }
    }
    for (const { stepKey, value } of scalarsOf(step.branching)) {
      const target = byKey.get(stepKey);
      const options = target === undefined ? null : optionKeysOf(target);
      if (
        options !== null &&
        (typeof value !== "string" || !options.has(value))
      ) {
        reasons.push(
          `step ${step.stepKey} compares ${stepKey} against ${String(value)}, which is not one of its options`,
        );
      }
    }
  }

  if (reasons.length > 0) {
    throw new OnboardingDefinitionInvalidError(reasons);
  }
  return { ...manifest, steps };
}
