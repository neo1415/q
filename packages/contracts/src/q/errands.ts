import { z } from "zod";

import { UuidSchema } from "../common/ids.js";
import { UtcTimestampSchema } from "../common/time.js";

/**
 * Errands (founder direction 2026-09-29): a multi-step plan the person
 * approved once for Q to carry out on one relationship. The person reads
 * their own errands on a relationship and may stop one; starting one is
 * the approved `q.errand.start` action, never this API.
 */

export const Q_RELATIONSHIP_ERRANDS_PATH =
  "/v1/q/relationships/:relationshipId/errands" as const;
export const Q_ERRAND_PATH = "/v1/q/errands/:errandId" as const;

export const qRelationshipErrandsPath = (relationshipId: string) =>
  Q_RELATIONSHIP_ERRANDS_PATH.replace(
    ":relationshipId",
    encodeURIComponent(relationshipId),
  );
export const qErrandPath = (errandId: string) =>
  Q_ERRAND_PATH.replace(":errandId", encodeURIComponent(errandId));

export const Q_ERRAND_STATUSES = [
  "ACTIVE",
  "DONE",
  "STOPPED",
  "FAILED",
  "EXPIRED",
] as const;

export const QErrandDtoSchema = z
  .object({
    id: UuidSchema,
    counterpartName: z.string().max(200),
    status: z.enum(Q_ERRAND_STATUSES),
    /** What Q did last, in plain words. */
    lastStep: z.string().max(300).nullable(),
    failure: z.string().max(200).nullable(),
    createdAt: UtcTimestampSchema,
  })
  .strict();
export type QErrandDto = z.infer<typeof QErrandDtoSchema>;

export const QErrandListDtoSchema = z
  .object({ errands: z.array(QErrandDtoSchema).max(5) })
  .strict();
export type QErrandListDto = z.infer<typeof QErrandListDtoSchema>;

export const QErrandStoppedDtoSchema = z
  .object({ stopped: z.literal(true) })
  .strict();
export type QErrandStoppedDto = z.infer<typeof QErrandStoppedDtoSchema>;
