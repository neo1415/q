import {
  COMPANY_TEAM_BIO_MAX,
  type CompanyProfileTeamMember,
} from "@capital-q/contracts";

/**
 * The team as an investor who can find the company sees it (ADR 0041;
 * founder decision 2026-10-02).
 *
 * An allow-list, built field by field: whatever a source row carries
 * besides these (an email, a user id, the background summary, the
 * profile's visibility label, a Q note) cannot reach the result, because
 * nothing here reads it. The short bio is the founder's own declared
 * professional summary, bounded; unknown stays null, never blank.
 */

export type TeamProjectionSource = {
  readonly displayName: string | null;
  readonly givenName: string | null;
  readonly familyName: string | null;
  readonly relationshipType: CompanyProfileTeamMember["relationshipType"];
  readonly businessTitle: string | null;
  readonly isFounder: boolean;
  readonly professionalSummary: string | null;
};

function nameOf(source: TeamProjectionSource): string {
  const display = source.displayName?.trim() ?? "";
  if (display !== "") return display.slice(0, 200);
  const parts = [source.givenName, source.familyName]
    .map((part) => part?.trim() ?? "")
    .filter((part) => part !== "");
  return parts.length === 0 ? "Team member" : parts.join(" ").slice(0, 200);
}

function bioOf(summary: string | null): string | null {
  const text = summary?.trim() ?? "";
  if (text === "") return null;
  if (text.length <= COMPANY_TEAM_BIO_MAX) return text;
  return `${text.slice(0, COMPANY_TEAM_BIO_MAX - 1).trimEnd()}…`;
}

function titleOf(title: string | null): string | null {
  const text = title?.trim() ?? "";
  return text === "" ? null : text.slice(0, 120);
}

export function projectTeamForNetwork(
  sources: readonly TeamProjectionSource[],
): CompanyProfileTeamMember[] {
  return sources.slice(0, 50).map((source) => ({
    name: nameOf(source),
    relationshipType: source.relationshipType,
    businessTitle: titleOf(source.businessTitle),
    isFounder: source.isFounder,
    shortBio: bioOf(source.professionalSummary),
  }));
}
