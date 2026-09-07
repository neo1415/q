import { QActionTypeSchema, type QActionType } from "@capital-q/contracts";

import type { AnyQActionDefinition } from "./definition.js";

/**
 * The registry of consequential action definitions (doc 12 §33; CQ-Q-008
 * §10, §14-§15, §97). Source-controlled, frozen, composed once. In V1 it
 * accepts CONFIRM_REQUIRED definitions only:
 *
 *   SAFE_READ, LOW_RISK_INTERNAL and PREPARE_ONLY work belongs to the Tool
 *   Registry, which never executes a side effect; RESTRICTED needs a policy
 *   stronger than one human approval that does not exist yet; PROHIBITED
 *   is refused everywhere. A proposal naming an unregistered or refused
 *   type has no executor and therefore no path to authority — the Approval
 *   Engine cannot make a prohibited action available.
 */

export type QActionRegistry = {
  readonly get: (actionType: string) => AnyQActionDefinition | undefined;
  readonly list: () => readonly AnyQActionDefinition[];
};

export const Q_ACTION_REGISTRABLE_CLASSES = ["CONFIRM_REQUIRED"] as const;

export function createQActionRegistry(
  definitions: readonly AnyQActionDefinition[],
): QActionRegistry {
  const byType = new Map<QActionType, AnyQActionDefinition>();
  for (const definition of definitions) {
    const actionType = QActionTypeSchema.parse(definition.actionType);
    if (
      !(Q_ACTION_REGISTRABLE_CLASSES as readonly string[]).includes(
        definition.riskClass,
      )
    ) {
      throw new Error(
        `action ${actionType} is ${definition.riskClass}; only ${Q_ACTION_REGISTRABLE_CLASSES.join(", ")} definitions can be registered`,
      );
    }
    if (!Number.isInteger(definition.version) || definition.version < 1) {
      throw new Error(`action ${actionType} has an invalid version`);
    }
    if (byType.has(actionType)) {
      throw new Error(`action ${actionType} is registered twice`);
    }
    byType.set(actionType, Object.freeze(definition));
  }
  const records = Object.freeze([...byType.values()]);
  return {
    get: (actionType) => {
      const parsed = QActionTypeSchema.safeParse(actionType);
      return parsed.success ? byType.get(parsed.data) : undefined;
    },
    list: () => records,
  };
}
