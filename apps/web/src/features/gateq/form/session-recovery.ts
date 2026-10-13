import { z } from "zod";
import {
  GATEQ_DECLINED,
  GATEQ_INSTRUMENTS,
  GATEQ_LEAD_STATUSES,
} from "@capital-q/contracts";

import type { FormAnswers } from "./form-model";

const text = z.string().max(4000);
const RecoverySchema = z
  .object({
    token: z.string().min(16).max(128),
    step: z.enum(["company", "round", "share", "note", "check", "sent"]),
    interview: z.boolean(),
    answers: z
      .object({
        companyName: text,
        oneLiner: text,
        stage: text,
        sectors: z.union([z.array(text).max(32), z.literal(GATEQ_DECLINED)]),
        otherSector: text,
        country: text,
        band: text,
        currency: text,
        amount: text,
        instrument: z.union([
          z.enum(GATEQ_INSTRUMENTS),
          z.literal(GATEQ_DECLINED),
          z.literal(""),
        ]),
        lead: z.union([
          z.enum(GATEQ_LEAD_STATUSES),
          z.literal(GATEQ_DECLINED),
          z.literal(""),
        ]),
        materials: z.array(text).max(64),
        contactName: text,
        contactEmail: text,
        note: text,
      })
      .strict(),
    pendingTurn: z
      .object({ id: z.string().max(128), text })
      .nullable()
      .default(null),
    submitKey: z.string().max(128).default(""),
  })
  .strict();
export type GateqRecovery = Omit<z.infer<typeof RecoverySchema>, "answers"> & {
  readonly answers: FormAnswers;
};
const storageKey = (gateway: string) => `cq:gateq:${gateway}`;
/** Tab-scoped bearer recovery; never put this credential in a URL or localStorage. */
export function readRecovery(gateway: string): GateqRecovery | null {
  try {
    const raw = sessionStorage.getItem(storageKey(gateway));
    if (raw === null) return null;
    const parsed = RecoverySchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
export function saveRecovery(gateway: string, recovery: GateqRecovery): void {
  try {
    sessionStorage.setItem(storageKey(gateway), JSON.stringify(recovery));
  } catch {
    /* Sandboxed embeds may deny storage; the current page still works. */
  }
}
export function amendRecovery(
  gateway: string,
  update: Partial<GateqRecovery>,
): void {
  const current = readRecovery(gateway);
  if (current !== null) saveRecovery(gateway, { ...current, ...update });
}
