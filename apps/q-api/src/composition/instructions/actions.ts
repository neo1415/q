import { z } from "zod";

import { APP_ACTIONS, settleGrant } from "@capital-q/app-actions";
import {
  INSTRUCTION_AUTO_ELIGIBLE_ACTIONS,
  InstructionGrantPayloadSchema,
  Q_INSTRUCTION_GRANT,
  QActionTypeSchema,
  UuidSchema,
  canonicalJsonStringify,
  type InstructionGrant,
  type InstructionGrantPayload,
  type QSubjectRef,
} from "@capital-q/contracts";
import type { Logger } from "@capital-q/observability";
import { defineQAction, type AnyQActionDefinition } from "@capital-q/q-actions";

import type { InstructionStore } from "./store.js";

/**
 * Approving a standing instruction (ADR 0043): ONE card in plain words whose
 * payload IS the grant -- what Q does on its own, what it asks first, what
 * it never does without them, who, the hours, the budget and until when.
 * Approval binds to that exact payload (hash); its execution makes the
 * instruction ACTIVE. Nothing runs before it.
 */

export const INSTRUCTION_GRANT = QActionTypeSchema.parse(Q_INSTRUCTION_GRANT);

const ActivatedSchema = z
  .object({ instructionId: UuidSchema, version: z.number().int().min(1) })
  .strict();

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Plain words for a declared action, from its own declaration. */
function said(action: string): string {
  const declared = APP_ACTIONS.find((entry) => entry.name === action);
  const words =
    declared?.short ??
    declared?.does.split(/(?<=\.)\s/u)[0]?.replace(/\.$/u, "") ??
    action;
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

function hours(grant: InstructionGrant): string {
  const days = [...grant.workingHours.days].sort((a, b) => a - b);
  const contiguous = days.every(
    (day, index) => index === 0 || day === (days[index - 1] ?? 0) + 1,
  );
  const dayText =
    contiguous && days.length > 2
      ? `${DAY_NAMES[(days[0] ?? 1) - 1] ?? ""}-${DAY_NAMES[(days[days.length - 1] ?? 1) - 1] ?? ""}`
      : days.map((day) => DAY_NAMES[day - 1] ?? "").join(", ");
  return `${dayText} ${grant.workingHours.start}-${grant.workingHours.end} (${grant.workingHours.timeZone})`;
}

export function grantCard(
  payload: InstructionGrantPayload,
  options: { readonly autoEnabled?: boolean | undefined } = {},
): string {
  const grant = payload.grant;
  const auto = grant.actions.filter((entry) => entry.mode === "AUTO");
  const ask = grant.actions.filter((entry) => entry.mode === "ASK");
  const lines: string[] = [`Your goal: "${payload.goal}"`];
  if (auto.length > 0) {
    lines.push(
      `On my own, within ${hours(grant)}:\n${auto
        .map((entry) => {
          const base = `- ${said(entry.action)}`;
          return entry.action === "chat.message.send"
            ? `${base} (up to ${String(grant.maxMessagesPerCounterpart)} per person, then I ask; tone: ${grant.tone}; topics: ${grant.topics.length > 0 ? grant.topics.join(", ") : "none"})`
            : base;
        })
        .join("\n")}`,
    );
  }
  if (auto.length > 0 && options.autoEnabled !== true) {
    lines.push("Q will ask for each step until autonomy is switched on.");
  }
  if (ask.length > 0) {
    lines.push(
      `I ask you first:\n${ask.map((entry) => `- ${said(entry.action)}`).join("\n")}`,
    );
  }
  lines.push(
    "Never without your explicit yes: terms, money, commitments, signing, passing or declining.",
  );
  lines.push(
    grant.counterparts.scope === "ALL_MY_RELATIONSHIPS"
      ? grant.counterparts.includeNewCompanies
        ? "Who: everyone you're already in touch with, and new companies from your feed and saved list (never ones you passed)."
        : "Who: everyone you're already in touch with."
      : `Who: ${String(grant.counterparts.relationshipIds.length)} relationships you chose.`,
  );
  lines.push(
    `Budget: $${grant.budgetUsdMonth} a month of Q's work; then I pause and ask.`,
  );
  lines.push(
    `Until: ${String(grant.expiresInDays)} days from now, or when you say stop.`,
  );
  lines.push(
    grant.digest === "OFF"
      ? "Updates: anything that needs you comes at once; no summaries."
      : `Updates: anything that needs you comes at once, and a summary of what I did ${grant.digest === "WEEKLY" ? "weekly" : "daily"}.`,
  );
  return lines.join("\n\n");
}

/** Whether a grant is exactly what code allows (no drops, no downgrades). */
export function grantIsSettled(grant: InstructionGrant): boolean {
  const settled = settleGrant(grant, APP_ACTIONS);
  return (
    settled.dropped.length === 0 &&
    settled.askedInstead.length === 0 &&
    canonicalJsonStringify(settled.grant) === canonicalJsonStringify(grant)
  );
}

export function createInstructionActions(dependencies: {
  readonly store: InstructionStore;
  /**
   * Called once an approved grant is current: the first firing, so what Q
   * does -- and what it can't -- is said at once. Never awaited here.
   */
  readonly onActivated?:
    ((instructionId: string, version: number) => void) | undefined;
  /** CQ_INSTRUCTIONS_AUTO: the card says when Q still asks for each step. */
  readonly autoEnabled?: boolean | undefined;
  readonly logger?: Logger | undefined;
}): readonly AnyQActionDefinition[] {
  const { store, logger } = dependencies;
  return [
    defineQAction<InstructionGrantPayload, z.infer<typeof ActivatedSchema>>({
      actionType: INSTRUCTION_GRANT,
      version: 1,
      riskClass: "CONFIRM_REQUIRED",
      owner: "q-api",
      description: `Starts (or changes) a standing instruction: Q works toward the person's goal over time inside exactly this grant. On its own only ${INSTRUCTION_AUTO_ELIGIBLE_ACTIONS.join(", ")} within the hours, people, tone, topics and message cap approved; everything else is a card first; terms, money and commitments never without an explicit yes.`,
      payload: InstructionGrantPayloadSchema,
      result: ActivatedSchema,
      targets: (payload): readonly QSubjectRef[] => [
        { kind: "USER", userId: payload.ownerUserId },
      ],
      describe: (payload) => ({
        summary:
          payload.continuation === "BUDGET"
            ? `I've used this month's budget for this. Continue at $${payload.grant.budgetUsdMonth} a month?`
            : payload.instructionId === undefined
              ? "Q works on this for you, inside these limits"
              : "Change what Q may do for this instruction",
        preview: grantCard(payload, {
          autoEnabled: dependencies.autoEnabled,
        }),
      }),
      confirm: () =>
        "On it. I'll tell you what I do, and ask before anything outside this.",
      authorize: (payload, actor) => {
        if (actor.actorType !== "HUMAN") {
          return Promise.resolve({ outcome: "DENY", code: "NOT_A_PERSON" });
        }
        // Only the person themself gives Q their standing authority.
        if (payload.ownerUserId !== actor.userId) {
          return Promise.resolve({ outcome: "DENY", code: "NOT_YOURS" });
        }
        return Promise.resolve(
          grantIsSettled(payload.grant)
            ? { outcome: "ALLOW" }
            : { outcome: "DENY", code: "GRANT_NOT_ALLOWED" },
        );
      },
      executor: {
        execute: async (action, context) => {
          if (context.approver.userId !== action.payload.ownerUserId) {
            return {
              outcome: "FAILED",
              failureCode: "NOT_YOURS",
              retryable: false,
            };
          }
          try {
            const activated = await store.activate({
              owner: {
                tenantId: context.approver.tenantId,
                userId: context.approver.userId,
                organisationId: context.approver.organisationId ?? null,
              },
              qActionId: action.actionId,
              instructionId: action.payload.instructionId,
              goal: action.payload.goal,
              grant: action.payload.grant,
            });
            if (activated === null) {
              return {
                outcome: "FAILED",
                failureCode: "NOT_LIVE",
                retryable: false,
              };
            }
            dependencies.onActivated?.(
              activated.instructionId,
              activated.version,
            );
            return { outcome: "EXECUTED", result: activated };
          } catch (error: unknown) {
            logger?.warn(
              { err: error, actionId: action.actionId },
              "standing instruction not activated",
            );
            return {
              outcome: "FAILED",
              failureCode: "NOT_FILED",
              retryable: true,
            };
          }
        },
      },
    }),
  ];
}
