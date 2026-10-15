import { z } from "zod";

import { UuidSchema } from "../common/ids.js";
import { MoneySchema } from "../common/money.js";
import { UtcTimestampSchema } from "../common/time.js";
import {
  EvidenceStatusSchema,
  TruthClassSchema,
} from "../evidence/vocabulary.js";

import { MarketplaceVisibilitySchema } from "./companies.js";

/**
 * A company's raise as ONE reader may see it: the single read model every
 * surface renders (Discover card, company profile, Q's company card and
 * tool). Built by `raiseFor(viewer, companyId)` in the discovery context;
 * no surface computes its own.
 *
 *   DISCLOSED_OBJECTIVE  the company's canonical capital objective, shown
 *                        because disclosure lets this reader view it (the
 *                        owner always sees their own). Founder-declared:
 *                        USER_CLAIM / SELF_REPORTED, never "verified".
 *   PITCH_CLAIM          what a pitch this reader may play says about the
 *                        raise, where no objective is disclosed to them and
 *                        the founder has not hidden the raise. The
 *                        company's own words: labelled as said in the
 *                        pitch, never as the disclosed objective.
 *   NONE                 nothing this reader may see. Unknown, never zero
 *                        and never "not raising".
 *
 * `visibility` is the ADR-001 scope under which this reader holds the
 * figure; `asOf` is when the objective started, or null for a pitch claim
 * and for NONE.
 */
export const COMPANY_RAISE_SOURCES = [
  "DISCLOSED_OBJECTIVE",
  "PITCH_CLAIM",
  "NONE",
] as const;
export const CompanyRaiseSourceSchema = z.enum(COMPANY_RAISE_SOURCES);
export type CompanyRaiseSource = z.infer<typeof CompanyRaiseSourceSchema>;

export const CompanyRaiseViewSchema = z
  .object({
    source: CompanyRaiseSourceSchema,
    money: MoneySchema.nullable(),
    truthClass: TruthClassSchema,
    evidenceStatus: EvidenceStatusSchema,
    visibility: MarketplaceVisibilitySchema.nullable(),
    asOf: UtcTimestampSchema.nullable(),
    /** PITCH_CLAIM only: where the figure is said. */
    pitch: z
      .object({
        pitchId: UuidSchema,
        atSeconds: z.number().int().min(0).max(86_400),
      })
      .strict()
      .nullable(),
  })
  .strict()
  .superRefine((view, ctx) => {
    // The axes follow the source; a pitch claim can never pass as anything
    // stronger than the company's own statement.
    const none = view.source === "NONE";
    if (none !== (view.money === null)) {
      ctx.addIssue({ code: "custom", message: "money iff source is not NONE" });
    }
    if ((view.source === "PITCH_CLAIM") !== (view.pitch !== null)) {
      ctx.addIssue({ code: "custom", message: "pitch iff PITCH_CLAIM" });
    }
    if (
      !none &&
      (view.truthClass !== "USER_CLAIM" ||
        view.evidenceStatus !== "SELF_REPORTED")
    ) {
      ctx.addIssue({
        code: "custom",
        message: "a raise is the company's own statement",
      });
    }
  });
export type CompanyRaiseView = z.infer<typeof CompanyRaiseViewSchema>;

export const NO_RAISE_VIEW: CompanyRaiseView = {
  source: "NONE",
  money: null,
  truthClass: "UNKNOWN",
  evidenceStatus: "NO_EVIDENCE",
  visibility: null,
  asOf: null,
  pitch: null,
};
