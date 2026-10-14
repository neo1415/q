import { z } from "zod";
import { RelationshipPipelineQuerySchema } from "@capital-q/contracts";

export {
  PipelineColumnsSchema,
  PipelineSavedViewSchema,
} from "@capital-q/contracts";
export type { PipelineColumn, PipelineSavedView } from "@capital-q/contracts";
import {
  PipelineColumnsSchema,
  PipelineSavedViewSchema,
} from "@capital-q/contracts";
const PreferencesSchema = z
  .object({
    views: z.array(PipelineSavedViewSchema).max(20),
    columns: PipelineColumnsSchema,
    layout: z.enum(["table", "board"]),
  })
  .strict();
export type PipelinePreferences = z.infer<typeof PreferencesSchema>;
export const DEFAULT_PIPELINE_PREFERENCES: PipelinePreferences = {
  views: [],
  columns: ["state", "since", "next"],
  layout: "table",
};
export function pipelineStorageKey(
  verifiedUserId: string,
  side: "INVESTOR" | "COMPANY",
  subjectId: string,
) {
  return `cq.hub.views.v1:${verifiedUserId}:${side}:${subjectId}`;
}
export function readPipelinePreferences(
  key: string,
  storage: Pick<Storage, "getItem"> | null,
): PipelinePreferences {
  try {
    const raw = storage?.getItem(key);
    if (raw === undefined || raw === null) return DEFAULT_PIPELINE_PREFERENCES;
    const parsed = PreferencesSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_PIPELINE_PREFERENCES;
  } catch {
    return DEFAULT_PIPELINE_PREFERENCES;
  }
}
export function writePipelinePreferences(
  key: string,
  value: PipelinePreferences,
  storage: Pick<Storage, "setItem"> | null,
): boolean {
  try {
    storage?.setItem(key, JSON.stringify(PreferencesSchema.parse(value)));
    return storage !== null;
  } catch {
    return false;
  }
}
export function pipelineHref(
  query: z.infer<typeof RelationshipPipelineQuerySchema>,
  layout: "table" | "board",
) {
  const params = new URLSearchParams({ view: "pipeline", layout });
  for (const [key, value] of Object.entries(query))
    if (value !== undefined && value !== "") params.set(key, String(value));
  return `/relationships?${params.toString()}`;
}
