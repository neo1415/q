import { z } from "zod";

import { TaskFrameSchema } from "./common.js";

/**
 * Standing instructions (ADR 0043): Q plans, code decides. The planner
 * names declared actions and their arguments; nothing it writes is
 * authority -- every step is validated against the approved grant before
 * anything runs, and a step the grant does not allow is refused or asked.
 *
 * Trust: the goal and the grant are the person's own (trusted); the
 * people and their states come from Capital Q's records, but names are
 * UNTRUSTED text. No message bodies reach the planner (ADR 0043 §6).
 */

export const INSTRUCTION_PLAN_SCHEMA_NAME = "InstructionPlanResult";
export const INSTRUCTION_PLAN_SCHEMA_VERSION = 1;

export const InstructionPlanVariablesSchema = z
  .object({
    ...TaskFrameSchema,
    principalName: z.string().max(120),
    /** The goal in the person's words. Trusted. */
    goal: z.string().max(2_000),
    /** The grant in plain lines: actions with mode, hours, tone, topics, cap. Trusted. */
    grant: z.string().max(4_000),
    /** The declared actions this plan may name, each with its argument schema. Trusted. */
    actions: z.string().max(12_000),
    /** Now, as an ISO instant, and the person's time zone. Trusted. */
    now: z.string().max(80),
    /** Their relationships and candidates: ids, states, counts. Names UNTRUSTED. */
    people: z.string().max(12_000),
    /** What Q already did under this instruction, newest last. Trusted. */
    history: z.string().max(6_000),
    /** Why code refused steps of the previous plan, when re-planning. Trusted. */
    refusals: z.string().max(3_000),
  })
  .strict();
export type InstructionPlanVariables = z.infer<
  typeof InstructionPlanVariablesSchema
>;
export const INSTRUCTION_PLAN_UNTRUSTED = ["people"] as const;

export const InstructionPlanResultSchema = z
  .object({
    steps: z
      .array(
        z
          .object({
            /** A declared action name from the list, exactly. */
            action: z.string().min(1).max(80),
            /** The action's arguments as JSON text, matching its schema. */
            argumentsJson: z.string().min(2).max(4_000),
            /** For a message: which approved topic it is about; else null. */
            topic: z.string().max(120).nullable(),
            /** True when the step touches terms, valuation, money or a commitment. */
            touchesTermsOrMoney: z.boolean(),
            /** One plain sentence for the person: what and why. */
            words: z.string().trim().min(3).max(300),
          })
          .strict(),
      )
      .max(10),
    /** Parts of the goal no declared action can do, each with what Q can do instead. */
    cannot: z
      .array(
        z
          .object({
            what: z.string().trim().min(3).max(200),
            reason: z.string().trim().min(3).max(300),
            instead: z.string().trim().min(3).max(300),
          })
          .strict(),
      )
      .max(5),
  })
  .strict();
export type InstructionPlanResult = z.infer<typeof InstructionPlanResultSchema>;
