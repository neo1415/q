import { z } from "zod";

/** Source data is distinct from the short action acknowledgement. */
export const AppSourceReadingSchema = z
  .object({
    kind: z.literal("GATEQ_SUBMITTED_APPLICATION"),
    gatewayId: z.uuid(),
    applicationId: z.uuid(),
    reference: z.string().min(1).max(64),
    submittedAt: z.string().min(1).max(40),
    dossierSchemaVersion: z.literal("gateq-dossier.v1"),
    generatedAt: z.string().min(1).max(40),
    statement: z.string().min(1).max(7000),
    omittedLines: z.number().int().min(0),
  })
  .strict();
export type AppSourceReading = z.infer<typeof AppSourceReadingSchema>;
