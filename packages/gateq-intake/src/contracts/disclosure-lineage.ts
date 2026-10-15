import { z } from "zod";

/** Server-owned Evidence identity; never inferred from model citations. */
export const DisclosureDocumentIdentitySchema = z
  .object({
    documentId: z.string().uuid(),
    versionId: z.string().uuid(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type DisclosureDocumentIdentity = z.infer<
  typeof DisclosureDocumentIdentitySchema
>;

/** COMPLETE records every document and prior turn consulted, including Q context. */
export const DisclosureLineageSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("UNKNOWN") }).strict(),
  z
    .object({
      state: z.literal("COMPLETE"),
      documents: z.array(DisclosureDocumentIdentitySchema).max(20),
      turnSeqs: z.array(z.number().int().positive()).max(1000),
    })
    .strict(),
]);
export type DisclosureLineage = z.infer<typeof DisclosureLineageSchema>;
