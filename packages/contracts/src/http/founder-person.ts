import { z } from "zod";

import { UuidSchema } from "../common/ids.js";

/**
 * A founder as a person (overnight plan A7, 2026-10-06): Person ≠
 * Organisation. Read from a company profile by an investor the pitch rule
 * admits (ADR 0041), the same rule as the team, and by the owner.
 *
 * Nothing here is shown by default beyond the team projection: age only
 * where the founder shared it with investors who can find the company
 * (never used in matching or ranking; research pitch-deck.md §7.7), and
 * each background line only where the founder shared it. Every line says
 * what it rests on: the founder's own claim (USER_CLAIM, SELF_REPORTED) or
 * a document the reader may open that matches it (DOCUMENT_SUPPORTED).
 *
 * A founder is addressed by position among the company's founders, never
 * by a person id (ADR 0041: the team projection carries no ids).
 */

export const COMPANY_FOUNDER_SEGMENT = "/founders/:position" as const;

export const FounderBackgroundLineSchema = z
  .object({
    /** "2015", "2021"; the end null while current. */
    from: z.string().max(10).nullable(),
    to: z.string().max(10).nullable(),
    current: z.boolean(),
    title: z.string().min(1).max(160),
    detail: z.string().max(300).nullable(),
    evidence: z.enum(["FOUNDERS_CLAIM", "MATCHES_SHARED_DOCUMENT"]),
  })
  .strict();
export type FounderBackgroundLine = z.infer<typeof FounderBackgroundLineSchema>;

export const FounderPersonDtoSchema = z
  .object({
    companyId: UuidSchema,
    companyName: z.string().min(1).max(200),
    position: z.number().int().min(1).max(20),
    name: z.string().min(1).max(200),
    roleLine: z.string().max(200),
    location: z.string().max(200).nullable(),
    identityVerified: z.boolean(),
    /** Only where the founder shared it; null otherwise (never guessed). */
    age: z.number().int().min(16).max(110).nullable(),
    buildingSince: z.number().int().min(1950).max(2100).nullable(),
    companiesFounded: z.number().int().min(0).max(50).nullable(),
    exits: z.string().max(80).nullable(),
    inTheirWords: z.string().max(600).nullable(),
    lookingFor: z.string().max(300).nullable(),
    background: z.array(FounderBackgroundLineSchema).max(20),
  })
  .strict();
export type FounderPersonDto = z.infer<typeof FounderPersonDtoSchema>;
