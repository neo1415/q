import { z } from "zod";

import { PIPELINE_IMPORT_FIELDS } from "@capital-q/contracts";

import { TaskFrameSchema } from "./common.js";

/**
 * PIPELINE_COLUMN_MAPPING -- which column of an imported pipeline file
 * (decision 106, a CRM or spreadsheet export) holds which of Capital Q's
 * pipeline fields. Q sees only the headers and a few short example values
 * per column; it maps, it never reads or writes a row. Code checks every
 * answer against the file's own headers, and anything unusable falls back
 * to the deterministic header-synonym mapping.
 */
export const PIPELINE_COLUMN_MAPPING_SCHEMA_NAME =
  "PipelineColumnMappingResult";
export const PIPELINE_COLUMN_MAPPING_SCHEMA_VERSION = 1;

export const PipelineColumnMappingVariablesSchema = z
  .object({
    ...TaskFrameSchema,
    /** INVESTOR: rows are companies; COMPANY: rows are investors. Trusted. */
    side: z.enum(["INVESTOR", "COMPANY"]),
    /** One line per column: "header | example; example". UNTRUSTED. */
    columns: z.string().max(12_000),
  })
  .strict();
export type PipelineColumnMappingVariables = z.infer<
  typeof PipelineColumnMappingVariablesSchema
>;

export const PIPELINE_COLUMN_MAPPING_UNTRUSTED = ["columns"] as const;

export const PipelineColumnMappingResultSchema = z
  .object({
    mappings: z
      .array(
        z
          .object({
            field: z.enum(PIPELINE_IMPORT_FIELDS),
            /** The header exactly as given. */
            header: z.string().min(1).max(200),
          })
          .strict(),
      )
      .max(64),
  })
  .strict();
export type PipelineColumnMappingResult = z.infer<
  typeof PipelineColumnMappingResultSchema
>;
