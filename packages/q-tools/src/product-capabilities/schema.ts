import { z } from "zod";

export const ProductRevisionSchema = z.string().regex(/^[0-9a-f]{40}$/u);
export const ProductStatusSchema = z.enum(["LIVE", "PARTIAL", "PLANNED", "UNVERIFIED"]);
export const ProductCapabilityEntrySchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(120),
  statusAtVerifiedRevision: ProductStatusSchema,
  evidenceRevision: ProductRevisionSchema,
  verifiedOn: z.iso.date(),
  proof: z.object({
    kind: z.enum(["LIVE_BROWSER", "LIVE_API", "CODE_REVIEW", "NOT_VERIFIED"]),
    summary: z.string().min(1).max(600),
  }).strict(),
  limits: z.array(z.string().min(1).max(300)).min(1).max(8),
}).strict().superRefine((entry, ctx) => {
  if (entry.statusAtVerifiedRevision === "LIVE" && !["LIVE_BROWSER", "LIVE_API"].includes(entry.proof.kind)) {
    ctx.addIssue({ code: "custom", message: "LIVE requires recorded live acceptance.", path: ["statusAtVerifiedRevision"] });
  }
});
export const ProductCapabilitySnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  version: z.string().min(1).max(40),
  publishedOn: z.iso.date(),
  coverage: z.literal("BOUNDED"),
  entries: z.array(ProductCapabilityEntrySchema).max(24),
}).strict();
