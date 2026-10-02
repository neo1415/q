import type { ReapproachEvidencePort } from "../eligibility/ports.js";

type TimesByCompany = (
  companyIds: readonly string[],
) => Promise<ReadonlyMap<string, string>>;

/**
 * Re-approach evidence (doc 19 §67) from the contexts that own it: the
 * media context's newest publishable pitch time and the capital context's
 * newest capital objective time, per company. Either read failing leaves
 * that evidence unknown, and unknown never reopens a pass.
 */
export function createReapproachEvidence(sources: {
  readonly pitchReadyAt?: TimesByCompany | undefined;
  readonly capitalObjectiveAt?: TimesByCompany | undefined;
}): ReapproachEvidencePort {
  const none: TimesByCompany = () => Promise.resolve(new Map());
  return {
    latest: async (companyIds) => {
      const [pitches, objectives] = await Promise.all([
        (sources.pitchReadyAt ?? none)(companyIds).catch(
          () => new Map<string, string>(),
        ),
        (sources.capitalObjectiveAt ?? none)(companyIds).catch(
          () => new Map<string, string>(),
        ),
      ]);
      return new Map(
        companyIds.map((companyId) => [
          companyId,
          {
            latestPitchReadyAt: pitches.get(companyId) ?? null,
            latestCapitalObjectiveAt: objectives.get(companyId) ?? null,
          },
        ]),
      );
    },
  };
}
