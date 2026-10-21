import { z } from "zod";

import {
  MEMORY_CORRECT_PATH,
  QMemoryCorrectionDtoSchema,
  QMemoryCorrectionRequestSchema,
  UuidSchema,
} from "@capital-q/contracts";

import {
  definePersonAction,
  portMissing,
  type AnyPersonAction,
} from "../define.js";
import type { MemoryCorrectionOutcome } from "../ports.js";

/**
 * What Q remembers (ADR 0012; chosen design "Grouped, forget in place",
 * 2026-10-21): the person corrects one memory in their own words. It is
 * declared once here (ADR 0040), so its route is generated; the memory
 * service puts it through the Write Gate, where the new item supersedes
 * the old one, which stays in history marked superseded. Only the
 * person's own live memory: anything else is the same 404.
 *
 * It is the person's own act on their own memory, never Q's: Q offers the
 * What Q remembers page instead of taking it.
 */

const Correct = z
  .object({
    memoryItemId: UuidSchema,
    input: QMemoryCorrectionRequestSchema,
  })
  .strict();

const CORRECT = definePersonAction<
  z.infer<typeof Correct>,
  MemoryCorrectionOutcome
>({
  name: "memory.correct",
  short: "correct what Q remembers",
  area: "memory",
  classification: "CONSEQUENTIAL",
  does: "Replaces one thing Q remembers about the person with their own words; the old one stays in history, superseded.",
  input: Correct,
  output: z.enum(["CORRECTED", "NOT_FOUND", "SENSITIVE", "REFUSED"]),
  run: (ports, context, input) => {
    const port = ports.memoryCorrection ?? portMissing("memoryCorrection");
    // Memory belongs to the person in their organisation's tenant: with no
    // organisation context there is no memory of theirs to correct.
    if (context.person.context === null) {
      return Promise.resolve("NOT_FOUND" as const);
    }
    return port.correct(
      context.person.context,
      input.memoryItemId,
      input.input.content,
    );
  },
  http: {
    method: "POST",
    path: MEMORY_CORRECT_PATH,
    fromRequest: (params, body) => ({
      memoryItemId: params["memoryItemId"],
      input: body,
    }),
    respond: () => QMemoryCorrectionDtoSchema.parse({ corrected: true }),
    notFound: (out) => out === "NOT_FOUND",
    problem: (out) =>
      out === "SENSITIVE"
        ? {
            code: "VALIDATION_FAILED",
            detail: "Q doesn't keep passwords, account numbers or ID numbers.",
          }
        : out === "REFUSED"
          ? {
              code: "VALIDATION_FAILED",
              detail: "That couldn't be remembered. Try different words.",
            }
          : null,
  },
  qCapability: "offer.memory_correction",
});

export const MEMORY_PERSON_ACTIONS: readonly AnyPersonAction[] = [CORRECT];
