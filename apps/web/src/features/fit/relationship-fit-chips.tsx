import {
  FIT_BAND_LABELS,
  FIT_CONFIDENCE_LABELS,
  FIT_PARAMETER_LABELS,
  type FitProfileDto,
} from "@capital-q/contracts";

import { FitGlyph } from "./fit-glyph";
import { chipParameters } from "./fit-words";

/**
 * Fit on a relationship card (brief B3; match.html "relationships"): the
 * band and confidence in words, up to three strong parameters, and the
 * first unknown, each chip a glyph and a word. `null` (no mandate) says
 * so quietly rather than showing nothing at all.
 */
export function RelationshipFitChips({
  profile,
}: {
  readonly profile: FitProfileDto | null;
}) {
  const chip =
    "inline-flex items-center gap-[5px] whitespace-nowrap rounded-full border border-(--cq-border-subtle) px-2 py-[3px] text-[12.5px] text-(--cq-text-secondary)";
  if (profile === null) {
    return (
      <span
        className="flex flex-wrap items-center gap-1.5"
        data-fit-chips="none"
      >
        <span className={chip}>
          <FitGlyph kind="UNKNOWN" size={13} />
          Fit not set up
        </span>
      </span>
    );
  }
  const { strong, unknown } = chipParameters(profile);
  return (
    <span
      className="flex flex-wrap items-center gap-1.5"
      data-fit-chips={profile.band}
    >
      <span className={`${chip} font-medium text-(--cq-text-primary)`}>
        {FIT_BAND_LABELS[profile.band]} ·{" "}
        {FIT_CONFIDENCE_LABELS[profile.confidence].toLowerCase()}
      </span>
      {strong.map((p) => (
        <span key={p.parameter} className={chip}>
          <FitGlyph kind="STRONG" size={13} />
          {FIT_PARAMETER_LABELS[p.parameter]}
        </span>
      ))}
      {unknown === null ? null : (
        <span className={chip}>
          <FitGlyph kind="UNKNOWN" size={13} />
          {FIT_PARAMETER_LABELS[unknown.parameter]} unknown
        </span>
      )}
    </span>
  );
}
