import {
  FounderSectionAnswerDtoSchema,
  type FounderSectionAnswerDto,
} from "@capital-q/contracts";
import { decodeJsonbString, type DatabaseExecutor } from "@capital-q/database";
import { FOUNDER_PROFILE_SECTIONS } from "@capital-q/founder-onboarding/profile-sections";
import { holdsNoValue } from "@capital-q/onboarding/response-values";

/**
 * The company Overview's sections in the founder's own words (owner
 * decision 2026-11-07: deck, then pitch video, then the F9 answers, with
 * the provenance "Founder's words").
 *
 * Founder definition v6+ holds each profile section without a step of its
 * own elsewhere in one long-text step of phase F9. Those steps write
 * nothing to the company record (`writesTo: []`), so the answer exists
 * only as the onboarding response. This is the one read of it for the
 * Overview, and it is deliberately narrow:
 *
 * - only the F9 section steps, by an allowlist built from the profile
 *   list; no other step of the journey (raw journey state stays private);
 * - only sessions bound to this company in its own tenant, never a
 *   cancelled one;
 * - only the current answer (not superseded, not withdrawn);
 * - "I don't know" and "None" are not content: unknown stays unknown.
 *
 * The caller decides who may read it (the owner, and an investor the pitch
 * rule admits, as for the team: ADR 0041); this function reads a
 * server-only table with the server's own connection, like the pitch
 * section readings.
 */

/** F9 step key -> the section key the Overview files it under. */
export const FOUNDER_SECTION_STEPS: ReadonlyMap<string, string> = new Map(
  FOUNDER_PROFILE_SECTIONS.flatMap((section) =>
    section.stepKeys
      .filter((stepKey) => stepKey.startsWith("F9."))
      // The key pitch readings use too (`factKey`, else the key), so one
      // section is matched the same way from every source.
      .map((stepKey) => [stepKey, section.factKey ?? section.key] as const),
  ),
);

export type StoredFounderSection = {
  readonly stepKey: string;
  readonly value: unknown;
  readonly answeredAt: Date | string;
};

export async function storedFounderSections(
  sql: DatabaseExecutor,
  company: { readonly tenantId: string; readonly id: string },
): Promise<readonly StoredFounderSection[]> {
  const steps = [...FOUNDER_SECTION_STEPS.keys()];
  if (steps.length === 0) return [];
  // Newest current answer per step across the company's founder sessions
  // (a co-founder's later answer is the company's latest word).
  return sql<{ stepKey: string; value: unknown; answeredAt: Date }[]>`
    select distinct on (r.step_key)
           r.step_key      as "stepKey",
           r.response_jsonb as "value",
           r.created_at    as "answeredAt"
      from onboarding.responses r
      join onboarding.sessions s on s.id = r.session_id
     where s.subject_type = 'COMPANY'
       and s.subject_id = ${company.id}
       and s.tenant_id = ${company.tenantId}
       and s.journey_type = 'founder'
       and s.status in ('ACTIVE', 'COMPLETED')
       and r.step_key = any(${steps}::text[])
       and r.superseded_by_response_id is null
       and r.withdrawn_at is null
     order by r.step_key, r.created_at desc`;
}

/** The stored answers as the contract sends them; anything else is dropped. */
export function founderSectionsFor(
  rows: readonly StoredFounderSection[],
): FounderSectionAnswerDto[] {
  const out: FounderSectionAnswerDto[] = [];
  for (const row of rows) {
    const sectionKey = FOUNDER_SECTION_STEPS.get(row.stepKey);
    if (sectionKey === undefined) continue;
    const value = decoded(row.value);
    if (value === null || holdsNoValue(value)) continue;
    const answeredAt =
      row.answeredAt instanceof Date
        ? row.answeredAt.toISOString()
        : new Date(row.answeredAt).toISOString();
    const parsed = FounderSectionAnswerDtoSchema.safeParse({
      sectionKey,
      text: value.text.trim(),
      answeredAt,
      truthClass: "USER_CLAIM",
      evidenceStatus: "SELF_REPORTED",
      source: "FOUNDER_ANSWER",
    });
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

/** A TEXT response value, or null. External data starts as unknown. */
function decoded(
  raw: unknown,
): { readonly type: "TEXT"; readonly text: string } | null {
  const value = decodeJsonbString(raw);
  if (typeof value !== "object" || value === null) return null;
  const { type, text } = value as { type?: unknown; text?: unknown };
  return type === "TEXT" && typeof text === "string"
    ? { type: "TEXT", text }
    : null;
}
