import { z } from "zod";

import {
  QCommunicationProfileSchema,
  QOperatingModeSchema,
} from "@capital-q/contracts";

/**
 * APP_ACTION_ARGUMENTS -- the inputs of ONE declared app action, read from
 * the person's own words against that tool's own input schema (HARDEN,
 * ADR 0040 parity eval, 2026-10-02: the turn reader named pass_company but
 * left appAction empty, and nothing was done). Records are named exactly
 * as said; the tool resolves names and validates everything again.
 */
export const APP_ACTION_ARGUMENTS_SCHEMA_NAME = "AppActionArgumentsResult";
export const APP_ACTION_ARGUMENTS_SCHEMA_VERSION = 1;

export const AppActionArgumentsVariablesSchema = z
  .object({
    operatingMode: QOperatingModeSchema,
    communicationProfile: QCommunicationProfileSchema,
    communicationGuidance: z.string().max(4_000),
    environmentNotes: z.string().max(2_000),
    /** The person's latest words. Untrusted. */
    utterance: z.string().max(2_000),
    /** The tool's name, what it does, and its input schema (trusted, from the registry). */
    toolName: z.string().max(80),
    toolDoes: z.string().max(600),
    inputSchema: z.string().max(4_000),
  })
  .strict();
export type AppActionArgumentsVariables = z.infer<
  typeof AppActionArgumentsVariablesSchema
>;

export const APP_ACTION_ARGUMENTS_UNTRUSTED = ["utterance"] as const;

export const AppActionArgumentsResultSchema = z
  .object({
    /** The tool's inputs; null when their words do not give what it needs. */
    arguments: z.record(z.string(), z.unknown()).nullable(),
  })
  .strict();
export type AppActionArgumentsResult = z.infer<
  typeof AppActionArgumentsResultSchema
>;
