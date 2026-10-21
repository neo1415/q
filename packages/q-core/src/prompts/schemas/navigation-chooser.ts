import { z } from "zod";

import {
  QCommunicationProfileSchema,
  QOperatingModeSchema,
} from "@capital-q/contracts";

/**
 * NAVIGATION_CHOOSER -- which ONE of two or three things on their screen a
 * pointing request means ("open their deck", "that one"), when the
 * screen's own reading is torn (Lane 7, owner 2026-10-21). The candidates
 * are only those the person may open (checked as them before this call);
 * code checks the answer against them, and a key not listed is NONE.
 */
export const NAVIGATION_CHOOSER_SCHEMA_NAME = "NavigationChooserResult";
export const NAVIGATION_CHOOSER_SCHEMA_VERSION = 1;

export const NavigationChooserVariablesSchema = z
  .object({
    operatingMode: QOperatingModeSchema,
    communicationProfile: QCommunicationProfileSchema,
    communicationGuidance: z.string().max(4_000),
    environmentNotes: z.string().max(2_000),
    /** The person's latest words. Untrusted. */
    utterance: z.string().max(400),
    /** One line per candidate: "key: label" (labels untrusted). */
    candidates: z.string().max(1_200),
  })
  .strict();
export type NavigationChooserVariables = z.infer<
  typeof NavigationChooserVariablesSchema
>;

export const NAVIGATION_CHOOSER_UNTRUSTED = [
  "utterance",
  "candidates",
] as const;

export const NavigationChooserResultSchema = z
  .object({
    /** One listed key, exactly as listed; null when none clearly fits. */
    key: z.string().trim().min(1).max(64).nullable(),
  })
  .strict();
export type NavigationChooserResult = z.infer<
  typeof NavigationChooserResultSchema
>;
