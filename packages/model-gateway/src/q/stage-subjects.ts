import {
  Q_STAGE_SUBJECTS_MAX,
  type QStageAbout,
  type QVisibleStage,
} from "@capital-q/contracts";

/**
 * Round 4 (owner 2026-10-21): the names a stage is about, so the one live
 * line can say "Looking at Nixo" or "Comparing Nixo and Halyard".
 *
 * Names come only from what this run has already read under its plan (the
 * run's reads by id), matched to the ids the tool call names; a comparison
 * with no id of its own is about the companies read so far. A name never
 * comes from a model's words or from what a person typed, and a stage
 * that reaches the public web is about nothing (R38: "Looking into it").
 */

/** The run's reads by id, as card-subjects RunRead keeps them. */
export type StageReads = {
  readonly companyNames: ReadonlyMap<string, string>;
  readonly profiles: ReadonlyMap<string, string>;
  readonly investors: ReadonlyMap<string, { readonly name: string }>;
};

const ID_KEYS = [
  "companyId",
  "companyIds",
  "investorOrganisationId",
  "investorOrganisationIds",
  "subjectId",
] as const;

function idsIn(args: Readonly<Record<string, unknown>>): readonly string[] {
  const ids: string[] = [];
  for (const key of ID_KEYS) {
    const value = args[key];
    if (typeof value === "string") ids.push(value);
    if (Array.isArray(value)) {
      for (const one of value) if (typeof one === "string") ids.push(one);
    }
  }
  return ids;
}

function nameOf(read: StageReads, id: string): string | null {
  return (
    read.profiles.get(id) ??
    read.companyNames.get(id) ??
    read.investors.get(id)?.name ??
    null
  );
}

/** What a tool call's stage is about, or undefined when nothing is known. */
export function stageAbout(input: {
  readonly stage: QVisibleStage;
  readonly args: Readonly<Record<string, unknown>>;
  readonly read: StageReads;
}): QStageAbout | undefined {
  if (input.stage === "SEARCHING_PUBLIC_SOURCES") return undefined;
  const named = [
    ...new Set(
      idsIn(input.args)
        .map((id) => nameOf(input.read, id))
        .filter((name): name is string => name !== null),
    ),
  ];
  const subjects =
    named.length > 0
      ? named
      : input.stage === "COMPARING_OPPORTUNITIES"
        ? [...new Set(input.read.companyNames.values())]
        : [];
  const kept = subjects
    .map((name) => name.trim().slice(0, 80))
    .filter((name) => name.length > 0)
    .slice(0, Q_STAGE_SUBJECTS_MAX);
  return kept.length === 0 ? undefined : { subjects: kept };
}

/** A stable key, so the same stage about the same names is written once. */
export function stageKey(
  stage: QVisibleStage,
  about: QStageAbout | undefined,
): string {
  return `${stage}:${about?.subjects?.join("\u0000") ?? ""}`;
}
