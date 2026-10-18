import {
  QArtifactContentSchema,
  type QArtifactContent,
  type QArtifactDetail,
  type QArtifactStatus,
  type QArtifactSummary,
  type QArtifactVersion,
} from "@capital-q/contracts";

/**
 * What an artifact is, in this context's own terms (QX-003C).
 *
 * The record shapes below are the stored ones: they carry the tenant, the
 * owning organisation and who asked, none of which belongs in anything a
 * browser receives. The public projections are the contract's, and
 * `toSummary`/`toDetail` are the only way across — so a field added to
 * storage does not silently become a field on the wire.
 */

export type StoredArtifact = {
  readonly id: string;
  readonly tenantId: string;
  readonly organisationId: string;
  readonly type: string;
  readonly companyId: string | null;
  readonly investorOrganisationId: string | null;
  readonly status: QArtifactStatus;
  readonly currentVersion: number;
  readonly visibilityScope: string;
  readonly createdByUserId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archivedAt: string | null;
};

export type StoredArtifactVersion = {
  readonly artifactId: string;
  readonly version: number;
  readonly title: string;
  readonly summary: string;
  readonly content: QArtifactContent;
  readonly instruction: string | null;
  readonly composedByRunId: string | null;
  readonly createdByUserId: string;
  readonly createdAt: string;
};

/** One row of the history list: what changed and when, never the content. */
export type ArtifactHistoryEntry = {
  readonly version: number;
  readonly title: string;
  readonly instruction: string | null;
  readonly createdAt: string;
};

/**
 * The version a revision would become.
 *
 * Deliberately not "read the current number and add one" spread across
 * call sites. Two people asking Q to revise the same brief at the same
 * moment both compute 2; the unique constraint on (artifact_id, version)
 * is what decides, and the loser retries against a number that has moved.
 * This function exists so that rule has one home.
 */
export function nextVersion(current: number): number {
  if (!Number.isInteger(current) || current < 0) {
    throw new RangeError("an artifact's current version is a count from zero");
  }
  return current + 1;
}

/**
 * Whether an artifact can be revised at all.
 *
 * There must be something to revise. A revision of a composition that has
 * not landed yet, or that failed, is a first version wearing the wrong
 * name — and would silently discard whatever the person asked for.
 */
export function canRevise(artifact: {
  readonly status: QArtifactStatus;
  readonly currentVersion: number;
  readonly archivedAt: string | null;
}): boolean {
  return (
    artifact.archivedAt === null &&
    artifact.status === "READY" &&
    artifact.currentVersion >= 1
  );
}

/**
 * The content, checked against the public contract.
 *
 * Called on the way in and on the way out. On the way in because what
 * cannot be expressed in the contract must not be stored; on the way out
 * because a payload whose shape has drifted is not something to render at
 * somebody, and failing is better than showing them half a document.
 */
export function parseContent(value: unknown): QArtifactContent {
  return QArtifactContentSchema.parse(value);
}

export function toSummary(
  artifact: StoredArtifact,
  current: StoredArtifactVersion | null,
): QArtifactSummary {
  return {
    artifactId: artifact.id,
    type: artifact.type,
    status: artifact.status,
    // Before the first version lands there is no composed title, so the
    // card says what is being prepared rather than nothing at all.
    title: current?.title ?? preparingTitle(artifact.type),
    ...(current === null ? {} : { summary: current.summary }),
    ...(artifact.companyId === null
      ? artifact.investorOrganisationId === null
        ? {}
        : {
            subject: {
              kind: "INVESTOR_ORGANISATION" as const,
              investorOrganisationId: artifact.investorOrganisationId,
            },
          }
      : {
          subject: {
            kind: "COMPANY" as const,
            companyId: artifact.companyId,
          },
        }),
    currentVersion: artifact.currentVersion,
    createdAt: artifact.createdAt,
    updatedAt: artifact.updatedAt,
  } as QArtifactSummary;
}

/**
 * What to call something that is still being composed.
 *
 * From the type code rather than from a model: a placeholder title is the
 * one piece of text that must exist before Q has written anything, and a
 * card reading "undefined" while Q works is worse than a plain label.
 */
function preparingTitle(type: string): string {
  const words = type
    .toLowerCase()
    .split("_")
    .filter((part) => part.length > 0);
  if (words.length === 0) {
    return "Preparing";
  }
  const [first, ...rest] = words;
  return [
    `${(first ?? "").charAt(0).toUpperCase()}${(first ?? "").slice(1)}`,
    ...rest,
  ].join(" ");
}

export function toVersion(stored: StoredArtifactVersion): QArtifactVersion {
  return {
    artifactId: stored.artifactId,
    version: stored.version,
    title: stored.title,
    summary: stored.summary,
    content: stored.content,
    ...(stored.instruction === null ? {} : { instruction: stored.instruction }),
    ...(stored.composedByRunId === null
      ? {}
      : { composedByRunId: stored.composedByRunId }),
    createdAt: stored.createdAt,
  } as QArtifactVersion;
}

export function toDetail(
  artifact: StoredArtifact,
  current: StoredArtifactVersion | null,
  history: readonly ArtifactHistoryEntry[],
): QArtifactDetail {
  return {
    artifact: toSummary(artifact, current),
    ...(current === null ? {} : { current: toVersion(current) }),
    history: history.map((entry) => ({
      version: entry.version,
      title: entry.title,
      ...(entry.instruction === null ? {} : { instruction: entry.instruction }),
      createdAt: entry.createdAt,
    })),
  };
}
