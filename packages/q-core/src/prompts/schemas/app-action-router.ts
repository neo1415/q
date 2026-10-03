import { z } from "zod";

import {
  QCommunicationProfileSchema,
  QOperatingModeSchema,
} from "@capital-q/contracts";

/**
 * APP_ACTION_ROUTER -- which ONE declared app action a request to act is,
 * or none (lead 2026-10-03, runs 9b4ef8d1, 7dd0bc2c, 31d085ac). The turn
 * reader's long prompt kept missing the name; this small call sees only
 * the person's words and the actions they may take, each with its area and
 * a few words. Code checks the answer against that list; a name not in it
 * is NONE.
 */
export const APP_ACTION_ROUTER_SCHEMA_NAME = "AppActionRouterResult";
export const APP_ACTION_ROUTER_SCHEMA_VERSION = 1;

export const AppActionRouterVariablesSchema = z
  .object({
    operatingMode: QOperatingModeSchema,
    communicationProfile: QCommunicationProfileSchema,
    communicationGuidance: z.string().max(4_000),
    environmentNotes: z.string().max(2_000),
    /** The person's latest words. Untrusted. */
    utterance: z.string().max(2_000),
    /** One line per action: "name -- area: what it does" (trusted, from the registry). */
    actions: z.string().max(12_000),
  })
  .strict();
export type AppActionRouterVariables = z.infer<
  typeof AppActionRouterVariablesSchema
>;

export const APP_ACTION_ROUTER_UNTRUSTED = ["utterance"] as const;

export const AppActionRouterResultSchema = z
  .object({
    /** One listed action's name, exactly as listed; null for none. */
    action: z.string().trim().min(1).max(80).nullable(),
  })
  .strict();
export type AppActionRouterResult = z.infer<typeof AppActionRouterResultSchema>;
